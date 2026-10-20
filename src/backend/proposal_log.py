"""Log a signal-digest run's proposed watch items / premise evidence via
stock_picker's ``/portfolio-brief`` skill, from the General tab's button.

Each run directory may hold a ``proposed_log.json`` (written by the news
project's signal-digest). ``proposals`` lists them one line each for the
checkboxes; ``start`` spawns a headless ``claude -p`` (Opus, high effort) in the
stock_picker repo that applies the selected 1-based numbers with the skill's
``apply-proposals --only``. The job is a detached ``sh`` wrapper writing
``.out`` / ``.err`` and, last, ``.exitcode`` under ``tmp/proposal_logs/``, so its
result survives a backend restart; ``latest_job`` reads those files back.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from agents import coding_agents_cli, env

STOCK_PICKER_DIR = Path.home() / "projects/stock_picker"
JOBS_DIR = Path(__file__).resolve().parents[2] / "tmp/proposal_logs"
MODEL = "opus"
EFFORT = "high"
# A numbered line of the report's "## Proposed log" section: "1. watch NVDA · against — …".
_REPORT_LINE_RE = re.compile(r"^(\d+)\.\s+(.+)$")
# Runs `"$@"` with the prompt on stdin and records its exit code last, so the
# `.exitcode` file's existence means the job finished.
_WRAPPER = 'p=$1 o=$2 e=$3 x=$4; shift 4; "$@" <"$p" >"$o" 2>"$e"; echo $? >"$x"'

_procs: dict[str, subprocess.Popen] = {}  # job_id -> wrapper process, polled to reap it
_lock = threading.Lock()


class InvalidSelection(ValueError):
    """The run has no proposals, or a number is outside 1..len(proposals)."""


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


def proposals(run_dir: Path, report_labels: dict[int, str]) -> list[dict]:
    """One ``{"n", "label"}`` per proposal; labels come from the report's numbered
    list when it has that number, else are built from the proposal's args."""
    return [{"n": n, "label": report_labels.get(n) or _fallback_label(p)}
            for n, p in enumerate(load_proposals(run_dir), 1)]


def build_prompt(run_id: str, path: Path, only: list[int], total: int) -> str:
    numbers = ",".join(map(str, only))
    return (
        f"/portfolio-brief Log the digest proposals of signal-digest run {run_id}: {path}\n\n"
        f"The user reviewed this run's {total} proposals in the market-pulse dashboard and selected "
        f"numbers {numbers} (1-based, as numbered in the file). That selection is the go-ahead to "
        f"apply them; the rest are declined. This is a headless session, so do not ask for "
        f"confirmation. Run the skill's checks against the vault as it is now, drop or reword any "
        f"selected proposal an earlier approval already covers or that is wrong, then apply the "
        f"survivors with `apply-proposals {path} --only <numbers>` (`--dry-run` first if you "
        f"edited any). Finish with one line per selected proposal: applied, reworded (how) or "
        f"dropped (why)."
    )


def _claude_command() -> list[str]:
    return [coding_agents_cli.find_claude_bin(), "-p", "--model", MODEL,
            *coding_agents_cli.build_claude_flag_args(effort=EFFORT, auto_approve=True, disable_mcp=True)]


def _job_files(job_id: str, jobs_dir: Path) -> dict[str, Path]:
    return {ext: jobs_dir / f"{job_id}.{ext}" for ext in ("json", "prompt", "out", "err", "exitcode")}


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def job_status(job_id: str, jobs_dir: Path = JOBS_DIR) -> dict | None:
    """``state`` is ``running``, ``done``, ``failed`` or ``lost`` (the process
    is gone without an exit code); ``output`` is the agent's final reply."""
    files = _job_files(job_id, jobs_dir)
    try:
        meta = json.loads(files["json"].read_text())
    except (OSError, ValueError):
        return None
    with _lock:
        proc = _procs.get(job_id)
        if proc is not None and proc.poll() is not None:
            _procs.pop(job_id)
    if files["exitcode"].exists():
        code = int(files["exitcode"].read_text().strip() or 1)
        state = "done" if code == 0 else "failed"
    elif _pid_alive(meta["pid"]):
        state = "running"
    else:
        state = "lost"
    status = {**meta, "job_id": job_id, "state": state, "output": "", "error": ""}
    if state != "running":
        status["output"] = files["out"].read_text().strip() if files["out"].exists() else ""
        if state != "done" and files["err"].exists():
            status["error"] = files["err"].read_text().strip()[-2000:]
    return status


def latest_job(run_id: str, jobs_dir: Path = JOBS_DIR) -> dict | None:
    """The newest log job for ``run_id`` (job ids sort by start time), or None."""
    if not jobs_dir.exists():
        return None
    ids = sorted(p.stem for p in jobs_dir.glob(f"{run_id}__*.json"))
    return job_status(ids[-1], jobs_dir) if ids else None


def start(run_dir: Path, only: list[int], jobs_dir: Path = JOBS_DIR,
          command: list[str] | None = None) -> dict:
    """Spawn the headless session for ``only`` and return its status."""
    total = len(load_proposals(run_dir))
    if not total:
        raise InvalidSelection(f"run {run_dir.name} has no proposed_log.json proposals")
    bad = [n for n in only if not 1 <= n <= total]
    if not only or bad:
        raise InvalidSelection(f"select proposal numbers from 1 to {total}, got {only}")
    current = latest_job(run_dir.name, jobs_dir)
    if current and current["state"] == "running":
        raise AlreadyRunning(f"a log job for run {run_dir.name} is still running")

    started = datetime.now(ZoneInfo("America/Los_Angeles"))
    job_id = f"{run_dir.name}__{started:%Y%m%d_%H%M%S}"
    files = _job_files(job_id, jobs_dir)
    jobs_dir.mkdir(parents=True, exist_ok=True)
    only = sorted(set(only))
    files["prompt"].write_text(build_prompt(run_dir.name, run_dir / "proposed_log.json", only, total))
    proc = subprocess.Popen(
        ["/bin/sh", "-c", _WRAPPER, "sh", *(str(files[k]) for k in ("prompt", "out", "err", "exitcode")),
         *(command or _claude_command())],
        cwd=STOCK_PICKER_DIR, env=env.build_env(), start_new_session=True,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    with _lock:
        _procs[job_id] = proc
    files["json"].write_text(json.dumps({
        "run_id": run_dir.name, "only": only, "pid": proc.pid,
        "started": started.isoformat(timespec="seconds"), "model": MODEL, "effort": EFFORT,
    }))
    return job_status(job_id, jobs_dir)
