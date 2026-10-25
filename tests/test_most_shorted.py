"""Unit tests for reading the most-shorted basket from the investment duckdb."""

import datetime as dt
import json

import duckdb
import pytest

from src.backend import most_shorted as m


@pytest.fixture(autouse=True)
def reset_cache():
    m._cache = m._overlay_cache = None
    yield
    m._cache = m._overlay_cache = None


def test_reads_the_index_and_the_latest_basket_most_shorted_first(tmp_path, monkeypatch):
    db = tmp_path / "stocks.duckdb"
    con = duckdb.connect(str(db))
    con.execute("CREATE TABLE most_shorted_basket_daily (date DATE, value DOUBLE)")
    con.executemany("INSERT INTO most_shorted_basket_daily VALUES (?, ?)",
                    [(dt.date(2026, 10, 23), 162.6), (dt.date(2026, 10, 22), 164.1)])
    con.execute("""CREATE TABLE most_shorted_basket_members (rank BIGINT, settlement_date DATE, effective_date DATE,
                   ticker VARCHAR, short_pct DOUBLE)""")
    con.executemany("INSERT INTO most_shorted_basket_members VALUES (?, ?, ?, ?, ?)", [
        (1, dt.date(2026, 8, 31), dt.date(2026, 9, 14), "OLD", 0.6),
        (2, dt.date(2026, 9, 30), dt.date(2026, 10, 12), "ONDS", 0.401),
        (1, dt.date(2026, 9, 30), dt.date(2026, 10, 12), "WOLF", 0.507),
    ])
    con.close()
    monkeypatch.setattr(m, "INVESTMENT_DB", db)

    out = m.get_most_shorted()
    assert out["dates"] == ["2026-10-22", "2026-10-23"]
    assert out["values"] == [164.1, 162.6]
    assert (out["settlement"], out["effective"]) == ("2026-09-30", "2026-10-12")
    assert out["members"] == [{"ticker": "WOLF", "short_pct": 50.7}, {"ticker": "ONDS", "short_pct": 40.1}]


def test_overlay_page_inlines_basket_and_etf_closes_on_basket_sessions(tmp_path, monkeypatch):
    db = tmp_path / "stocks.duckdb"
    con = duckdb.connect(str(db))
    con.execute("CREATE TABLE most_shorted_basket_daily (date DATE, value DOUBLE)")
    con.executemany("INSERT INTO most_shorted_basket_daily VALUES (?, ?)",
                    [(dt.date(2026, 10, 22), 164.1), (dt.date(2026, 10, 23), 162.6)])
    con.execute("CREATE TABLE daily_bars_adjusted (ticker VARCHAR, date TIMESTAMP, close_adjusted DOUBLE)")
    con.executemany("INSERT INTO daily_bars_adjusted VALUES (?, ?, ?)", [
        ("QQQ", dt.datetime(2026, 10, 21), 690.0),  # before the basket's first session: dropped
        ("QQQ", dt.datetime(2026, 10, 22), 700.0), ("QQQ", dt.datetime(2026, 10, 23), 704.4),
        ("SPY", dt.datetime(2026, 10, 23), 759.97),
        ("AAPL", dt.datetime(2026, 10, 23), 250.0),  # not an overlay ETF
    ])
    con.close()
    monkeypatch.setattr(m, "INVESTMENT_DB", db)

    html = m.overlay_page()
    assert "__DATA__" not in html
    data = json.loads(html.split("const DATA = ", 1)[1].split(";\n", 1)[0])
    assert data["dates"] == ["2026-10-22", "2026-10-23"]
    assert data["series"] == {"BASKET": [164.1, 162.6], "QQQ": [700.0, 704.4], "SPY": [None, 759.97],
                              "SMH": [None, None], "SOXX": [None, None]}
