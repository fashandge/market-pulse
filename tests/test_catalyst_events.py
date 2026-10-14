from datetime import date

from src.backend import main

CSV = """category,when,catalyst,why_it_matters,first_seen,sources
earnings,2026-10-14,ASML Q3 earnings,Chip demand,2026-10-12 09:00,ndx:20261012_0900
macro,2026-10-14 08:30 ET,September CPI release,Rates,2026-10-09 09:00,ndx:20261009_0900
macro,2026-10-12,Past event,,2026-10-01 09:00,
weird,2026-11-03,Unknown category,,2026-10-08 17:00,
special,not-a-date,Bad row,,,
"""


def test_load_catalyst_events_filters_sorts_and_splits_when(tmp_path):
    path = tmp_path / "events.csv"
    path.write_text(CSV)
    events = main.load_catalyst_events(path, date(2026, 10, 13))

    assert [e["catalyst"] for e in events] == ["September CPI release", "ASML Q3 earnings", "Unknown category"]
    cpi = events[0]
    assert (cpi["date"], cpi["time"], cpi["days_away"]) == ("2026-10-14", "08:30 ET", 1)
    assert events[2]["category"] == "special"  # unknown categories fall into the catch-all


def test_load_catalyst_events_missing_file(tmp_path):
    assert main.load_catalyst_events(tmp_path / "none.csv", date(2026, 10, 13)) == []
