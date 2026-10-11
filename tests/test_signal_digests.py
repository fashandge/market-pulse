from datetime import date

from src.backend import main


def _run(root, name, text="# report"):
    d = root / name
    d.mkdir()
    if text is not None:
        (d / "report.md").write_text(text)


def test_all_runs_per_day_within_window(tmp_path):
    _run(tmp_path, "20261010_0845", "old")
    _run(tmp_path, "20261010_2101", "new")
    _run(tmp_path, "20261010_2101_2", "collision")
    _run(tmp_path, "20261010_2200_jev", "experiment")
    _run(tmp_path, "20261010_2300", None)  # no report yet
    _run(tmp_path, "20261008_0845", "two days ago")
    _run(tmp_path, "20261006_0845", "outside window")

    out = main.load_signal_digests(tmp_path, date(2026, 10, 10))

    assert [s["date"] for s in out] == ["October 10, 2026", "October 08, 2026"]
    assert [r["run_id"] for r in out[0]["runs"]] == ["20261010_2101_2", "20261010_2101", "20261010_0845"]
    assert [r["time"] for r in out[0]["runs"]] == ["21:01", "21:01", "08:45"]
    assert out[0]["runs"][0]["content"] == "collision"
    assert out[1]["runs"][0]["content"] == "two days ago"


def test_report_title_stripped_and_verdict_extracted(tmp_path):
    report = ("> ⚠️ **Fallback notice**: x\n\n# Signal digest — 2026-10-10 (20261010_2107)\n\n"
              "Two things matter today.\n\n## Investing\n### A\n")
    _run(tmp_path, "20261010_2107", report)
    run = main.load_signal_digests(tmp_path, date(2026, 10, 10))[0]["runs"][0]
    assert run["verdict"] == "Two things matter today."
    assert run["content"].startswith("> ⚠️")


def test_missing_runs_dir(tmp_path):
    assert main.load_signal_digests(tmp_path / "nope", date(2026, 10, 10)) == []


def test_verdict_from_tldr_bullets(tmp_path):
    report = ("# Signal digest — x\n\n## TL;DR\n\n**Investing**\n"
              "- OpenAI's run rate is **$50B**, not $70B ([r/stocks](https://r.example/1)).\n")
    _run(tmp_path, "20261010_2107", report)
    run = main.load_signal_digests(tmp_path, date(2026, 10, 10))[0]["runs"][0]
    assert run["verdict"] == "OpenAI's run rate is $50B, not $70B (r/stocks)."
