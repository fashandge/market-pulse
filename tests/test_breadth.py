"""Unit tests for the breadth payload (``/api/market/breadth``).

DB-backed but self-contained: each test builds a tiny duckdb file in tmp_path
and points ``breadth.INVESTMENT_DB`` at it.
"""

import datetime as dt

import duckdb
import pytest

from src.backend import breadth

_DAYS = [dt.datetime(2026, 9, 24), dt.datetime(2026, 9, 25), dt.datetime(2026, 9, 28)]


def _make_db(path, with_dist_days=True):
    con = duckdb.connect(str(path))
    try:
        con.execute(
            "CREATE TABLE daily_bars_adjusted (ticker VARCHAR, date TIMESTAMP, close_adjusted DOUBLE)"
        )
        spx = ", ".join(
            f"{p}_{c} DOUBLE"
            for p in ("spx", "ndx")
            for c in (
                "pct_above_sma_20", "pct_above_sma_50", "pct_above_sma_200",
                "new_high_252_pct", "new_low_252_pct", "adv_minus_decl_pct",
            )
        )
        con.execute(f"CREATE TABLE market_breadth_daily (date TIMESTAMP, {spx})")
        con.execute(
            "CREATE TABLE index_distribution_days (date TIMESTAMP, "
            "spy_distribution_days_5wk BIGINT, qqq_distribution_days_5wk BIGINT)"
        )
        for i, day in enumerate(_DAYS):
            con.execute("INSERT INTO daily_bars_adjusted VALUES ('SPY', ?, ?)", [day, 700.123 + i])
            # QQQ has no bar on the last day: that row must be dropped.
            if i < 2:
                con.execute("INSERT INTO daily_bars_adjusted VALUES ('QQQ', ?, ?)", [day, 600.0 + i])
            con.execute("INSERT INTO daily_bars_adjusted VALUES ('RSP', ?, ?)", [day, 200.0])
            vals = [0.5, None if i == 0 else 0.4, 0.6, 0.03, 0.01, 0.2] * 2
            con.execute(
                f"INSERT INTO market_breadth_daily VALUES (?, {', '.join('?' * 12)})", [day] + vals
            )
            if with_dist_days and i > 0:
                con.execute("INSERT INTO index_distribution_days VALUES (?, ?, ?)", [day, 9, 3])
    finally:
        con.close()


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "stocks.duckdb"
    _make_db(path)
    monkeypatch.setattr(breadth, "INVESTMENT_DB", path)
    monkeypatch.setattr(breadth, "_cache", None)
    return path


def test_rows_need_both_etf_closes(db):
    out = breadth.get_breadth()
    assert out["dates"] == ["2026-09-24", "2026-09-25"]
    assert out["as_of"] == "2026-09-25"
    assert all(len(v) == 2 for v in out["series"].values())


def test_series_values_and_rounding(db):
    s = breadth.get_breadth()["series"]
    assert list(s) == list(breadth._SERIES)
    assert s["spy"] == [700.12, 701.12]
    assert s["snh"] == [pytest.approx(0.02), pytest.approx(0.02)]  # highs minus lows
    assert s["s50"] == [None, 0.4]  # warmup NULL survives as None
    # Distribution days missing on the first day (LEFT JOIN) -> None, ints after.
    assert s["sdd"] == [None, 9] and isinstance(s["sdd"][1], int)


def test_cache_follows_db_mtime(db):
    first = breadth.get_breadth()
    assert breadth.get_breadth() is first
    db.unlink()
    _make_db(db, with_dist_days=False)
    assert breadth.get_breadth()["series"]["sdd"] == [None, None]
