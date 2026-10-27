from datetime import date

from news.src.catalyst_calendar import calendar_note
from src.backend import main

ROWS = [
    {"category": "earnings", "when": "2026-10-14", "catalyst": "ASML Q3 earnings", "why_it_matters": "Chip demand",
     "first_seen": "2026-10-12 09:00", "sources": "ndx:20261012_0900"},
    {"category": "macro", "importance": "critical", "when": "2026-10-14 08:30 ET", "catalyst": "September CPI release", "why_it_matters": "Rates",
     "first_seen": "2026-10-09 09:00", "sources": "ndx:20261009_0900"},
    {"category": "macro", "when": "2026-10-12", "catalyst": "Past event", "first_seen": "2026-10-01 09:00"},
    {"category": "weird", "when": "2026-11-03", "catalyst": "Unknown category", "first_seen": "2026-10-08 17:00"},
    {"category": "special", "when": "not-a-date", "catalyst": "Bad row"},
]


def test_load_catalyst_events_filters_sorts_and_splits_when(tmp_path):
    path = tmp_path / "Catalyst Calendar.md"
    calendar_note.write_rows(ROWS, path)
    events = main.load_catalyst_events(path, date(2026, 10, 13))

    assert [e["catalyst"] for e in events] == ["September CPI release", "ASML Q3 earnings", "Unknown category"]
    cpi = events[0]
    assert (cpi["date"], cpi["time"], cpi["days_away"]) == ("2026-10-14", "05:30 PT", 1)
    assert cpi["critical"] and not events[1]["critical"]  # rows without importance read as normal
    assert events[2]["category"] == "special"  # unknown categories fall into the catch-all


def test_load_catalyst_events_missing_file(tmp_path):
    assert main.load_catalyst_events(tmp_path / "none.md", date(2026, 10, 13)) == []


def test_eastern_to_la_converts_et_times():
    assert main.eastern_to_la(date(2026, 10, 14), "14:00 ET") == (date(2026, 10, 14), "11:00 PT")
    assert main.eastern_to_la(date(2026, 10, 14), "01:30 ET") == (date(2026, 10, 13), "22:30 PT")  # crosses midnight
    assert main.eastern_to_la(date(2026, 11, 1), "01:30 ET") == (date(2026, 10, 31), "22:30 PT")  # DST-end day
    assert main.eastern_to_la(date(2026, 10, 14), "after close") == (date(2026, 10, 14), "after close")
