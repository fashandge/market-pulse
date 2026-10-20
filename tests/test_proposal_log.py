import json
import time
from datetime import date

import pytest

from agents import coding_agents_cli
from src.backend import main, proposal_log

# run_background's child with a fake agent: it replies with its config and the prompt,
# fails when the prompt selects proposal 2, and sleeps on 3, so no claude runs.
FAKE_CHILD = (
    "import sys, time; from agents import coding_agents_cli as c\n"
    "def fake(p, cfg, timeout=None, **kw):\n"
    "    if 'numbers 3 ' in p: time.sleep(2)\n"
    "    failed = 'numbers 2 ' in p\n"
    "    return c.AgentResult(output=f'{cfg.model} {cfg.claude_effort} {cfg.claude_working_dir}\\n' + p,\n"
    "                         returncode=3 if failed else 0, stderr='boom' if failed else '', agent=cfg.agent)\n"
    "c.run_with_config = fake\n"
    "sys.exit(c.run_background_job(sys.argv[1]))"
)

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


@pytest.fixture(autouse=True)
def fake_agent(monkeypatch):
    monkeypatch.setattr(coding_agents_cli, "_BACKGROUND_CHILD_CODE", FAKE_CHILD)


def test_invalid_selection(tmp_path):
    run = _run(tmp_path)
    for only in ([], [0], [4]):
        with pytest.raises(proposal_log.InvalidSelection):
            proposal_log.start(run, only, tmp_path / "jobs")


def test_start_runs_portfolio_brief_in_stock_picker(tmp_path):
    run = _run(tmp_path)
    jobs = tmp_path / "jobs"
    status = proposal_log.start(run, [3, 1], jobs)
    assert status["only"] == [1, 3]
    done = _wait(status["job_id"], jobs)
    assert done["state"] == "done"
    config_line, prompt = done["output"].split("\n", 1)
    assert config_line == f"opus high {proposal_log.STOCK_PICKER_DIR}"
    assert prompt.startswith("/portfolio-brief ")
    assert "numbers 1,3" in prompt and str(run / "proposed_log.json") in prompt
    assert proposal_log.latest_job(run.name, jobs)["job_id"] == status["job_id"]


def test_failed_job_reports_stderr(tmp_path):
    run = _run(tmp_path)
    jobs = tmp_path / "jobs"
    status = proposal_log.start(run, [2], jobs)
    done = _wait(status["job_id"], jobs)
    assert done["state"] == "failed" and done["error"] == "boom"


def test_second_start_while_running_is_refused(tmp_path):
    run = _run(tmp_path)
    jobs = tmp_path / "jobs"
    status = proposal_log.start(run, [3], jobs)
    assert status["state"] == "running"
    with pytest.raises(proposal_log.AlreadyRunning):
        proposal_log.start(run, [1], jobs)
    _wait(status["job_id"], jobs)


def test_note_links_point_at_the_logged_section(tmp_path):
    vault = tmp_path / "vault"
    register = vault / proposal_log.PREMISE_REGISTER_NOTE
    register.parent.mkdir(parents=True)
    register.write_text("# Register\n\n## P1 — Capex grows\n\n## P2 — Supply stays tight, so pricing holds\n")
    run = _run(tmp_path)
    out = proposal_log.proposals(run, {}, vault)
    watch_items = "http://127.0.0.1:8765/note?path=wiki%2FInvestment%2FInvestment%20system%2FWatch%20Items.md"
    assert out[0]["note_label"] == "Watch Items · NVDA" and out[0]["note_url"] == f"{watch_items}#NVDA"
    assert out[1]["note_label"] == "Premise Register · P2"
    assert out[1]["note_url"].endswith("Register.md#P2-%E2%80%94-Supply-stays-tight,-so-pricing-holds")
    register.unlink()  # heading not found: link to the note without an anchor
    assert proposal_log.proposals(run, {}, vault)[1]["note_url"].endswith("Portfolio%20Premise%20Register.md")
