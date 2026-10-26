"""Unit tests for the Credit tab payload (``/api/market/credit``).

DB-backed but self-contained: each test builds a tiny duckdb in tmp_path with
the investment project's ``credit_series_daily``, ``daily_bars_adjusted`` and
``macro_series_daily`` shapes and points ``credit.INVESTMENT_DB`` at it.
"""

import datetime as dt

import duckdb
import pytest

from src.backend import credit


@pytest.fixture(autouse=True)
def reset_cache():
    credit._cache = None
    yield
    credit._cache = None


def test_fred_block_converts_spreads_and_derives_funding():
    history = {
        "oas_hy": {"2026-10-21": 3.29, "2026-10-22": 3.40},
        "stlfsi4": {"2026-10-16": -0.6328},
        "sofr": {"2026-10-21": 3.88, "2026-10-22": 3.90},
        "iorb": {"2026-10-21": 3.90, "2026-10-22": 3.90, "2026-10-26": 3.90},  # posted ahead
    }
    block = credit.fred_block(history)
    assert block["dates"] == ["2026-10-16", "2026-10-21", "2026-10-22"]
    s = block["series"]
    assert s["hy"] == [None, 329, 340]  # basis points
    assert s["stlfsi"] == [-0.6328, None, None]
    assert s["funding"] == [None, -2, 0]
    assert s["ccc"] == [None, None, None]
    assert block["last"]["hy"] == "2026-10-22" and block["last"]["ccc"] is None


def test_tv_block_has_bp_spreads_over_bund_and_move():
    history = {
        "de10y": {"2026-10-22": 3.3311, "2026-10-23": 3.3545},
        "fr10y": {"2026-10-22": 5.0795, "2026-10-23": 5.019, "2026-10-24": 5.0},
        "it10y": {"2026-10-23": 4.5867},
        "move": {"2014-12-31": 80.0, "2026-10-23": 103.3223},
    }
    block = credit.tv_block(history)
    assert block["dates"] == ["2026-10-22", "2026-10-23"]  # FR's Bund-less day and pre-2015 MOVE dropped
    assert block["series"]["fr"] == [174.8, 166.5]
    assert block["series"]["it"] == [None, 123.2]
    assert block["series"]["move"] == [None, 103.3]
    assert block["last"] == {"fr": "2026-10-23", "it": "2026-10-23", "es": None, "move": "2026-10-23"}


def test_get_credit_reads_all_three_blocks_from_the_db(tmp_path, monkeypatch):
    db = tmp_path / "stocks.duckdb"
    con = duckdb.connect(str(db))
    con.execute("CREATE TABLE credit_series_daily (series_key VARCHAR, date DATE, value DOUBLE)")
    con.executemany("INSERT INTO credit_series_daily VALUES (?, ?, ?)", [
        ("oas_ccc", dt.date(2026, 10, 22), 13.40), ("de10y", dt.date(2026, 10, 23), 3.35),
        ("fr10y", dt.date(2026, 10, 23), 5.02), ("move", dt.date(2026, 10, 23), 103.3),
    ])
    con.execute("""CREATE TABLE daily_bars_adjusted (ticker VARCHAR, date TIMESTAMP, close_adjusted DOUBLE,
                   close_split_adjusted DOUBLE)""")
    d1, d2 = dt.datetime(2026, 10, 22), dt.datetime(2026, 10, 23)
    con.executemany("INSERT INTO daily_bars_adjusted VALUES (?, ?, ?, ?)", [
        ("SPY", d1, 760.0, 760.0), ("SPY", d2, 759.97, 759.97), ("HYG", d1, 77.0, 77.0), ("HYG", d2, 77.05, 77.05),
        ("IEI", d1, 114.0, 114.0), ("IEI", d2, 114.67, 114.67), ("CRWV", d2, 54.23, 54.23),
        ("BKLN", d2, 20.26, 19.9),
    ])
    con.execute("CREATE TABLE macro_series_daily (series_key VARCHAR, date TIMESTAMP, value DOUBLE)")
    con.executemany("INSERT INTO macro_series_daily VALUES (?, ?, ?)", [("vix", d2, 19.45), ("vix", dt.datetime(2026, 10, 24), 20.0)])
    con.close()
    monkeypatch.setattr(credit, "INVESTMENT_DB", db)

    out = credit.get_credit()
    assert out["fred"]["series"]["ccc"] == [1340]
    assert out["tv"]["series"]["fr"] == [167.0]
    p = out["prices"]
    assert p["dates"] == ["2026-10-22", "2026-10-23"]  # VIX's extra day dropped
    assert p["series"]["CRWV"] == [None, 54.23]
    assert p["series"]["vix"] == [None, 19.45]
    assert p["series"]["HYG/IEI"] == [round(77.0 / 114.0, 5), round(77.05 / 114.67, 5)]
    assert p["series"]["BKLN"] == [None, 19.9]  # split-adjusted price, not the total-return close
    assert out["cds"] is None  # a DB pulled before the CDS stage existed
    assert credit.get_credit() is out  # cached on the DB file's mtime


def test_cds_block_is_columnar_per_name_and_skips_outlier_days(tmp_path):
    con = duckdb.connect(str(tmp_path / "stocks.duckdb"))
    con.execute("CREATE TABLE cds_spreads_daily (name_key VARCHAR, name VARCHAR, date DATE, spread_bp DOUBLE)")
    con.executemany("INSERT INTO cds_spreads_daily VALUES (?, ?, ?, ?)", [
        ("ORCL", "Oracle", dt.date(2026, 10, 22), 301.4), ("ORCL", "Oracle", dt.date(2026, 10, 23), 315.36),
        ("MSFT", "Microsoft", dt.date(2026, 10, 23), 56.0), ("MSFT", "Microsoft", dt.date(2026, 10, 21), None),
    ])
    block = credit._cds(con)
    assert block["dates"] == ["2026-10-22", "2026-10-23"]  # MSFT's outlier day (NULL spread) dropped
    assert block["series"] == {"ORCL": [301, 315], "MSFT": [None, 56]}
    assert block["names"] == {"ORCL": "Oracle", "MSFT": "Microsoft"}
    assert block["last"] == {"ORCL": "2026-10-23", "MSFT": "2026-10-23"}
