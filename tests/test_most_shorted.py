"""Unit tests for reading the most-shorted basket from the investment duckdb."""

import datetime as dt

import duckdb
import pytest

from src.backend import most_shorted as m


@pytest.fixture(autouse=True)
def reset_cache():
    m._cache = None
    yield
    m._cache = None


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
