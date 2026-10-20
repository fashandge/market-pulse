"""Log a signal-digest run's proposed watch items / premise evidence via
stock_picker's ``/portfolio-brief`` skill, from the General tab's button.

Each run directory may hold a ``proposed_log.json`` (written by the news
project's signal-digest). ``proposals`` lists them one line each for the
checkboxes; ``start`` launches a headless ``claude -p`` (Opus, high effort) in the
stock_picker repo that applies the selected 1-based numbers with the skill's
``apply-proposals --only``. It runs through the agents project's
``run_background`` (a separate process that outlives the request and a backend
restart), whose result files live under ``tmp/proposal_logs/``; ``latest_job``
reads them back with ``detached_status``.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from agents import coding_agents_cli

STOCK_PICKER_DIR = Path.home() / "projects/stock_picker"
JOBS_DIR = Path(__file__).resolve().parents[2] / "tmp/proposal_logs"
MODEL = "opus"
EFFORT = "high"
JOB_TIMEOUT_SECONDS = 45 * 60
# The notes the skill writes to, as vault-relative paths (portfolio_brief.py's
# DEFAULT_SYSTEM_DIR + WATCH_LOG_NAME / REGISTER_NAME), and the notes-search web
# UI that renders them with one id per heading (the heading text, spaces → "-").
NOTES_VAULT = Path.home() / "notes"
WATCH_ITEMS_NOTE = "wiki/Investment/Investment system/Watch Items.md"
PREMISE_REGISTER_NOTE = "wiki/Investment/Investment system/Portfolio Premise Register.md"
NOTES_SEARCH_URL = "http://127.0.0.1:8765"
# A numbered line of the report's "## Proposed log" section: "1. watch NVDA · against — …".
_REPORT_LINE_RE = re.compile(r"^(\d+)\.\s+(.+)$")

class InvalidSelection(ValueError):
    """The run has no proposals, a number is outside 1..len(proposals), or
    neither proposals nor instructions were given."""


class AlreadyRunning(RuntimeError):
    """A log job for this run has not finished yet."""


def split_proposed_log_section(body: str) -> tuple[str, dict[int, str]]:
    """Return (body without the ``## Proposed log`` section, its numbered lines by number)."""
    lines = body.split("\n")
    start = next((i for i, line in enumerate(lines) if line.strip().lower() == "## proposed log"), None)
    if start is None:
        return body, {}
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    labels = {}
    for line in lines[start + 1:end]:
        m = _REPORT_LINE_RE.match(line.strip())
        if m:
            labels[int(m.group(1))] = m.group(2).strip()
    rest = "\n".join(lines[:start] + lines[end:]).strip()
    return rest, labels


def _fallback_label(proposal: dict) -> str:
    args = proposal.get("args", {})
    kind = proposal.get("kind", "")
    if kind == "watch":
        return f"watch {args.get('ticker', '?')} · {args.get('direction', '?')} — {args.get('title', '')}"
    if kind == "premise_evidence":
        return f"premise {args.get('premise', '?')} · {args.get('direction', '?')} — {args.get('claim', '')}"
    return kind or "unknown proposal"


def load_proposals(run_dir: Path) -> list[dict]:
    """The run's proposals as raw dicts; [] when the file is missing or unreadable."""
    path = run_dir / "proposed_log.json"
    try:
        return json.loads(path.read_text()).get("proposals", [])
    except (OSError, ValueError, AttributeError):
        return []


def note_link(note: str, heading: str | None) -> str:
    """notes-search URL of a vault note, scrolled to ``heading`` when given."""
    url = f"{NOTES_SEARCH_URL}/note?{urlencode({'path': note}, quote_via=quote)}"
    return f"{url}#{quote('-'.join(heading.split()), safe=',')}" if heading else url


def _premise_heading(premise: str, vault: Path) -> str | None:
    """The register's full ``## P2 — …`` heading text for ``premise``, if found."""
    try:
        text = (vault / PREMISE_REGISTER_NOTE).read_text()
    except OSError:
        return None
    m = re.search(rf"^## ({re.escape(premise)}\b.*)$", text, re.MULTILINE)
    return m.group(1).strip() if m else None


def _note_target(proposal: dict, vault: Path) -> dict | None:
    """Where a logged proposal lands: ``{"note_label", "note_url"}``, or None for an unknown kind."""
    args = proposal.get("args", {})
    if proposal.get("kind") == "watch":
        ticker = args.get("ticker")
        return {"note_label": f"Watch Items · {ticker}", "note_url": note_link(WATCH_ITEMS_NOTE, ticker)}
    if proposal.get("kind") == "premise_evidence":
        premise = args.get("premise", "")
        return {"note_label": f"Premise Register · {premise}",
                "note_url": note_link(PREMISE_REGISTER_NOTE, _premise_heading(premise, vault))}
    return None


def proposals(run_dir: Path, report_labels: dict[int, str], vault: Path = NOTES_VAULT) -> list[dict]:
    """One ``{"n", "label", "note_label", "note_url"}`` per proposal. Labels come
    from the report's numbered list when it has that number, else are built from
    the proposal's args; the note link is the section the skill logs it under."""
    return [{"n": n, "label": report_labels.get(n) or _fallback_label(p),
             **(_note_target(p, vault) or {"note_label": None, "note_url": None})}
            for n, p in enumerate(load_proposals(run_dir), 1)]


def build_prompt(run_id: str, path: Path, only: list[int], total: int, instructions: str = "") -> str:
    """The ``/portfolio-brief`` prompt; ``instructions`` is the user's free text
    (extra guidance and sources) from the dashboard, quoted verbatim when given.
    With no proposals selected, the instructions alone say what to log."""
    instructions = instructions.strip()
    run_dir = path.parent
    extra = (
        f"The user added these instructions and sources for this logging; follow them and "
        f"read every source they name (URLs, files, notes) before deciding what to log. They "
        f"wrote them while reading this run's digest report, {run_dir / 'report.md'}, so read "
        f"it to resolve any item, story or claim they refer to; for items the report left out, "
        f"search {run_dir / 'shortlist.md'} (every candidate) and {run_dir / 'discarded.md'}. "
        f"A bare number in them (\"for 2, …\") is a proposal number as the dashboard showed it, "
        f"the same as in the file and the report's `## Proposed log` list, not a premise id "
        f"such as P2.\n\n"
        f"<user_instructions>\n{instructions}\n</user_instructions>\n\n"
        if instructions else ""
    )
    head = (
        f"/portfolio-brief Log the digest proposals of signal-digest run {run_id}: {path}\n\n"
        f"The user reviewed this run's {total} proposals in the market-pulse dashboard and "
    )
    if not only:
        return (
            f"{head}selected none of them; they are all declined, so do not apply any. This is a "
            f"headless session, so do not ask for confirmation. Log only what the user's "
            f"instructions below ask for, through the skill's own workflow and checks against the "
            f"vault as it is now.\n\n"
            f"{extra}"
            f"Finish with one line per entry you logged, or why you logged nothing."
        )
    numbers = ",".join(map(str, only))
    return (
        f"{head}selected numbers {numbers} (1-based, as numbered in the file). That selection is "
        f"the go-ahead to apply them; the rest are declined. This is a headless session, so do "
        f"not ask for confirmation. Run the skill's checks against the vault as it is now, drop "
        f"or reword any selected proposal an earlier approval already covers or that is wrong, "
        f"then apply the survivors with `apply-proposals {path} --only <numbers>` (`--dry-run` "
        f"first if you edited any).\n\n"
        f"{extra}"
        f"Finish with one line per selected proposal: applied, reworded (how) or dropped (why)."
    )


def agent_config() -> coding_agents_cli.AgentConfig:
    """Headless ``claude -p`` in stock_picker, so its ``.claude/skills`` resolve,
    in auto mode: a classifier reviews each action instead of bypassing permissions."""
    return coding_agents_cli.AgentConfig(
        agent="claude", model=MODEL, claude_effort=EFFORT, auto_mode=True,
        claude_disable_mcp=True, claude_working_dir=STOCK_PICKER_DIR,
    )


def job_status(job_id: str, jobs_dir: Path = JOBS_DIR) -> dict | None:
    """The job's metadata plus ``state`` (``running``, ``done``, ``failed`` or
    ``lost``), ``output`` (the agent's final reply) and ``error`` (stderr tail)."""
    try:
        meta = json.loads((jobs_dir / f"{job_id}.json").read_text())
        status = coding_agents_cli.detached_status(jobs_dir / job_id)
    except (OSError, ValueError):
        return None
    return {**meta, "job_id": job_id, "state": status["state"],
            "output": status["output"].strip(), "error": status["error"].strip()}


def latest_job(run_id: str, jobs_dir: Path = JOBS_DIR) -> dict | None:
    """The newest log job for ``run_id`` (job ids sort by start time), or None."""
    if not jobs_dir.exists():
        return None
    ids = sorted(p.stem for p in jobs_dir.glob(f"{run_id}__*.json"))
    return job_status(ids[-1], jobs_dir) if ids else None


def start(run_dir: Path, only: list[int], jobs_dir: Path = JOBS_DIR, instructions: str = "") -> dict:
    """Spawn the headless session for ``only`` (plus the user's free-text
    ``instructions``) and return its status."""
    total = len(load_proposals(run_dir))
    if not total:
        raise InvalidSelection(f"run {run_dir.name} has no proposed_log.json proposals")
    instructions = instructions.strip()
    bad = [n for n in only if not 1 <= n <= total]
    if bad or not (only or instructions):
        raise InvalidSelection(f"select proposal numbers from 1 to {total} or give instructions, got {only}")
    current = latest_job(run_dir.name, jobs_dir)
    if current and current["state"] == "running":
        raise AlreadyRunning(f"a log job for run {run_dir.name} is still running")

    started = datetime.now(ZoneInfo("America/Los_Angeles"))
    job_id = f"{run_dir.name}__{started:%Y%m%d_%H%M%S}"
    only = sorted(set(only))
    prompt = build_prompt(run_dir.name, run_dir / "proposed_log.json", only, total, instructions)
    jobs_dir.mkdir(parents=True, exist_ok=True)
    (jobs_dir / f"{job_id}.json").write_text(json.dumps({
        "run_id": run_dir.name, "only": only, "instructions": instructions,
        "started": started.isoformat(timespec="seconds"), "model": MODEL, "effort": EFFORT,
    }))
    coding_agents_cli.run_background(prompt, agent_config(), jobs_dir / job_id,
                                     timeout=JOB_TIMEOUT_SECONDS)
    return job_status(job_id, jobs_dir)
