"""Unit tests for the free most-shorted basket. No network: FINRA and SEC
fetches are monkeypatched, the cache lives in tmp_path, and prices come from a
tiny duckdb built per test."""

import datetime as dt

import duckdb
import pandas as pd
import pytest

from src.backend import most_shorted as m


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(m, "CACHE_DIR", tmp_path / "most_shorted")
    m._state.update(checked_at=0.0, live=None)
    m._index_cache = None
    yield
    m._state.update(checked_at=0.0, live=None)
    m._index_cache = None


def test_month_end_dates_keep_the_last_settlement_of_each_month():
    dates = ["2025-10-31", "2025-11-14", "2025-11-28", "2025-12-15", "2025-12-31", "2026-01-15"]
    assert m.month_end_dates(dates, start="2025-11-01") == ["2025-11-28", "2025-12-31", "2026-01-15"]


def test_quarter_frames_start_one_quarter_early_and_stop_at_ended_quarters():
    frames = m.quarter_frames("2025-11-01", dt.date(2026, 10, 24))
    assert frames[0] == ("CY2025Q3I", dt.date(2025, 9, 30))
    assert frames[-1] == ("CY2026Q3I", dt.date(2026, 9, 30))
    assert [f for f, _ in frames] == ["CY2025Q3I", "CY2025Q4I", "CY2026Q1I", "CY2026Q2I", "CY2026Q3I"]


def test_shares_as_of_never_uses_a_later_period():
    frames = pd.DataFrame({"cik": [1, 1, 2], "end": ["2026-03-31", "2026-06-30", "2026-06-30"], "shares": [100, 120, 50]})
    s = m._shares_as_of(frames, "2026-05-29")
    assert s.to_dict() == {1: 100}


def _make_db(path):
    con = duckdb.connect(str(path))
    con.execute("""CREATE TABLE tickers_reference (ticker VARCHAR, cik VARCHAR, type VARCHAR, primary_exchange VARCHAR,
                   active BOOLEAN, last_seen_utc TIMESTAMP)""")
    con.executemany("INSERT INTO tickers_reference VALUES (?, ?, 'CS', ?, ?, '2026-10-24')", [
        ("AAA", "0000000001", "XNAS", True), ("BBB", "0000000002", "XNYS", True),
        ("CCC", "0000000003", "XNAS", True), ("OTC", "0000000004", "OTC", True),
        ("GONE", "0000000005", "XNYS", False),  # delisted since, still eligible in the past
    ])
    con.execute("CREATE TABLE daily_bars_adjusted (ticker VARCHAR, date TIMESTAMP, close DOUBLE, close_adjusted DOUBLE)")
    days = [dt.datetime(2026, 9, 30), dt.datetime(2026, 10, 12), dt.datetime(2026, 10, 13), dt.datetime(2026, 10, 14)]
    rows = []
    for d, px in zip(days, [(20, 30, 4, 50, 40), (20, 30, 4, 50, 40), (22, 30, 4, 50, 40), (22, 27, 4, 50, 40)]):
        for t, p in zip(["AAA", "BBB", "CCC", "OTC", "GONE"], px):
            rows.append((t, d, p, p))
        rows.append(("SPY", d, 700.0, 700.0))
    con.executemany("INSERT INTO daily_bars_adjusted VALUES (?, ?, ?, ?)", rows)
    con.close()


def test_basket_filters_ranks_and_compounds_equal_weight(tmp_path, monkeypatch):
    monkeypatch.setattr(m, "BASKET_SIZE", 2)
    m.CACHE_DIR.mkdir(parents=True)
    # short shares; shares outstanding are 100M each, so 40M short = 40%
    pd.DataFrame({"ticker": ["AAA", "BBB", "CCC", "OTC", "GONE"],
                  "short_qty": [40e6, 30e6, 90e6, 90e6, 10e6]}).to_csv(m._si_path("2026-09-30"), index=False)
    frames = pd.DataFrame({"cik": [1, 2, 3, 4, 5], "end": ["2026-06-30"] * 5, "shares": [100e6] * 5})
    db = tmp_path / "stocks.duckdb"
    _make_db(db)
    con = duckdb.connect(str(db), read_only=True)
    out = m.build_index(con, ["2026-09-30"], frames)
    con.close()
    # CCC fails the $5 price floor, OTC is not on a listed exchange: AAA (40%) and BBB (30%) remain
    assert [x["ticker"] for x in out["members"]] == ["AAA", "BBB"]
    assert out["members"][0]["short_pct"] == 40.0
    assert out["effective"] == "2026-10-12"
    # Oct 13: AAA +10%, BBB flat -> +5%; Oct 14: AAA flat, BBB -10% -> -5%
    assert out["dates"] == ["2026-10-12", "2026-10-13", "2026-10-14"]
    assert out["values"] == [100.0, 105.0, 99.75]


def test_sync_reports_failure_but_keeps_stored_data(monkeypatch):
    def down(*a, **k):
        raise OSError("FINRA down")

    monkeypatch.setattr(m, "_finra", down)
    monkeypatch.setattr(m, "_fetch_frame", down)
    m.CACHE_DIR.mkdir(parents=True)
    for frame, _ in m.quarter_frames(m.START, dt.date(2026, 10, 24)):
        m._sec_path(frame).write_text("cik,end,shares\n")
    assert m._sync(dt.date(2026, 10, 24)) is False
    assert all(m._sec_path(f).exists() for f, _ in m.quarter_frames(m.START, dt.date(2026, 10, 24)))


def test_unpublished_recent_quarter_is_not_a_failure(monkeypatch):
    monkeypatch.setattr(m, "_finra", lambda *a, **k: [])

    def frame(name):
        if name == "CY2026Q3I":
            raise OSError("404: not published yet")
        m._sec_path(name).write_text("cik,end,shares\n")

    monkeypatch.setattr(m, "_fetch_frame", frame)
    assert m._sync(dt.date(2026, 10, 24)) is True
