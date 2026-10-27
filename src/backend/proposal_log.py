"""Log a signal-digest run's proposed watch items / premise evidence via
stock_picker's ``/portfolio-brief`` skill, from the General tab's button.

Each run directory may hold a ``proposed_log.json`` (written by the news
project's signal-digest). Everything about that file — its labels, the note each
proposal lands under, and the headless prompt that applies a selection — is
stock_picker's ``digest_proposals``, and what the session does with the prompt is
the skill's step 5f, so changes there need no edit here. This module only lists
the proposals for the checkboxes (``proposals``) and runs the job: ``start``
launches a headless ``claude -p`` (Opus, high effort) in the stock_picker repo
through the agents project's ``run_background`` (a separate process that
outlives the request and a backend restart), whose result files live under
``tmp/proposal_logs/``; ``latest_job`` reads them back with ``detached_status``.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from agents import coding_agents_cli
from stock_picker.src.attention_layer import digest_proposals

STOCK_PICKER_DIR = Path.home() / "projects/stock_picker"
JOBS_DIR = Path(__file__).resolve().parents[2] / "tmp/proposal_logs"
MODEL = "opus"
EFFORT = "high"
JOB_TIMEOUT_SECONDS = 45 * 60
# digest_proposals gives each proposal's note vault-relative; the notes-search web UI renders
# it with one id per heading (the heading text, spaces → "-").
NOTES_VAULT = Path.home() / "notes"
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


def note_link(note: str, heading: str | None) -> str:
    """notes-search URL of a vault note, scrolled to ``heading`` when given."""
    url = f"{NOTES_SEARCH_URL}/note?{urlencode({'path': note}, quote_via=quote)}"
    return f"{url}#{quote('-'.join(heading.split()), safe=',')}" if heading else url


def proposals(run_dir: Path, report_labels: dict[int, str], vault: Path = NOTES_VAULT) -> list[dict]:
    """One ``{"n", "label", "note_label", "note_url"}`` per proposal. A run written before
    proposals carried a label falls back to the report's numbered line; the note link is the
    section the skill logs it under."""
    out = []
    for n, p in enumerate(digest_proposals.load(run_dir), 1):
        where = digest_proposals.target(p, vault)
        out.append({"n": n, "label": digest_proposals.label(p, report_labels.get(n)),
                    "note_label": where["label"] if where else None,
                    "note_url": note_link(where["note"], where["heading"]) if where else None})
    return out


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
    total = len(digest_proposals.load(run_dir))
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
    prompt = digest_proposals.apply_prompt(run_dir, only, instructions)
    jobs_dir.mkdir(parents=True, exist_ok=True)
    (jobs_dir / f"{job_id}.json").write_text(json.dumps({
        "run_id": run_dir.name, "only": only, "instructions": instructions,
        "started": started.isoformat(timespec="seconds"), "model": MODEL, "effort": EFFORT,
    }))
    coding_agents_cli.run_background(prompt, agent_config(), jobs_dir / job_id,
                                     timeout=JOB_TIMEOUT_SECONDS)
    return job_status(job_id, jobs_dir)
