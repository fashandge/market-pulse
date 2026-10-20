import json
import time
from datetime import date

import pytest

from src.backend import main, proposal_log

REPORT = ("# Signal digest\n\nOne thing.\n\n## Proposed log\n\n"
          "1. watch NVDA · against — TPU cost lead\n2. premise P2 · for — CEO quote\n\n## Discarded\n\nx\n")
PROPOSALS = {"proposals": [
    {"kind": "watch", "args": {"ticker": "NVDA", "direction": "against", "title": "TPU cost lead"}},
    {"kind": "premise_evidence", "args": {"premise": "P2", "direction": "for", "claim": "CEO quote"}},
    {"kind": "watch", "args": {"ticker": "INTC", "direction": "against", "title": "CoWoS backup"}},
]}


def _run(root, name="20261010_0900", report=REPORT, proposals=PROPOSALS):
    d = root / name
    d.mkdir()
    (d / "report.md").write_text(report)
    if proposals is not None:
        (d / "proposed_log.json").write_text(json.dumps(proposals))
    return d


def _wait(job_id, jobs_dir):
    for _ in range(100):
        status = proposal_log.job_status(job_id, jobs_dir)
        if status["state"] != "running":
            return status
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_section_split_and_labels(tmp_path):
    body, labels = proposal_log.split_proposed_log_section(REPORT)
    assert "Proposed log" not in body and body.endswith("## Discarded\n\nx")
    assert labels == {1: "watch NVDA · against — TPU cost lead", 2: "premise P2 · for — CEO quote"}
    run = _run(tmp_path)
    out = proposal_log.proposals(run, labels)
    assert [p["n"] for p in out] == [1, 2, 3]
    assert out[2]["label"] == "watch INTC · against — CoWoS backup"  # not in the report: built from args


def test_digest_payload_carries_proposals(tmp_path):
    (tmp_path / "runs").mkdir()
    _run(tmp_path / "runs")
    run = main.load_signal_digests(tmp_path / "runs", date(2026, 10, 10), jobs_dir=tmp_path / "jobs")[0]["runs"][0]
    assert len(run["proposals"]) == 3 and run["log_job"] is None
    assert "Proposed log" not in run["content"]


def test_run_without_proposal_file_keeps_report(tmp_path):
    (tmp_path / "runs").mkdir()
    _run(tmp_path / "runs", proposals=None)
    run = main.load_signal_digests(tmp_path / "runs", date(2026, 10, 10), jobs_dir=tmp_path / "jobs")[0]["runs"][0]
    assert run["proposals"] == [] and "## Proposed log" in run["content"]


def test_invalid_selection(tmp_path):
    run = _run(tmp_path)
    for only in ([], [0], [4]):
        with pytest.raises(proposal_log.InvalidSelection):
            proposal_log.start(run, only, tmp_path / "jobs", command=["cat"])


def test_start_runs_command_with_prompt_and_records_result(tmp_path):
    run = _run(tmp_path)
    jobs = tmp_path / "jobs"
    status = proposal_log.start(run, [3, 1], jobs, command=["cat"])
    assert status["only"] == [1, 3]
    done = _wait(status["job_id"], jobs)
    assert done["state"] == "done"
    assert done["output"].startswith("/portfolio-brief ")
    assert "numbers 1,3" in done["output"] and str(run / "proposed_log.json") in done["output"]
    assert proposal_log.latest_job(run.name, jobs)["job_id"] == status["job_id"]


def test_failed_job_reports_stderr(tmp_path):
    run = _run(tmp_path)
    jobs = tmp_path / "jobs"
    status = proposal_log.start(run, [1], jobs, command=["sh", "-c", "echo boom >&2; exit 3"])
    done = _wait(status["job_id"], jobs)
    assert done["state"] == "failed" and done["error"] == "boom"


def test_second_start_while_running_is_refused(tmp_path):
    run = _run(tmp_path)
    jobs = tmp_path / "jobs"
    status = proposal_log.start(run, [1], jobs, command=["sleep", "2"])
    with pytest.raises(proposal_log.AlreadyRunning):
        proposal_log.start(run, [2], jobs, command=["cat"])
    proposal_log._procs[status["job_id"]].kill()
