"""Unit tests for the Credit tab payload (``/api/market/credit``).

No network: FRED fetches are monkeypatched, the history file lives in
tmp_path, and the price block reads a tiny duckdb built per test.
"""

import datetime as dt

import duckdb
import pytest

from src.backend import credit


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(credit, "FRED_HISTORY", tmp_path / "credit/fred_history.csv")
    monkeypatch.setattr(credit, "TV_HISTORY", tmp_path / "credit/tradingview_history.csv")
    for state in (credit._fred_state, credit._tv_state):
        state.update(fetched_at=0.0, ok=None)
    credit._prices_cache = None
    yield
    for state in (credit._fred_state, credit._tv_state):
        state.update(fetched_at=0.0, ok=None)
    credit._prices_cache = None


def test_merge_keeps_dates_fred_dropped_and_takes_revisions():
    stored = {"BAMLH0A0HYM2": {"2023-10-23": 4.40, "2026-10-21": 3.27}}
    fetched = {"BAMLH0A0HYM2": {"2026-10-21": 3.29, "2026-10-22": 3.40}, "NFCI": {"2026-10-16": -0.5}}
    merged = credit.merge(stored, fetched)
    assert merged["BAMLH0A0HYM2"] == {"2023-10-23": 4.40, "2026-10-21": 3.29, "2026-10-22": 3.40}
    assert merged["NFCI"] == {"2026-10-16": -0.5}
    assert stored["BAMLH0A0HYM2"]["2026-10-21"] == 3.27  # input not mutated


def test_history_round_trips_through_the_file():
    data = {"SOFR": {"2026-10-22": 3.9, "2026-10-21": 3.88}, "IORB": {"2026-10-22": 3.9}}
    credit._write_history(data)
    assert credit._read_history() == data


def test_failed_fetch_serves_stored_history_and_flags_it(monkeypatch):
    credit._write_history({"BAMLH0A0HYM2": {"2026-10-22": 3.40}})
    monkeypatch.setattr(credit, "_fetch_series", lambda sid: None)
    history = credit._refresh_fred()
    assert history == {"BAMLH0A0HYM2": {"2026-10-22": 3.40}}
    assert credit._fred_state["ok"] is False


def test_fetch_is_merged_into_the_file_once_per_ttl(monkeypatch):
    credit._write_history({"BAMLH0A0HYM2": {"2023-10-23": 4.40}})
    calls = []

    def fake(sid):
        calls.append(sid)
        return {"2026-10-22": 3.40} if sid == "BAMLH0A0HYM2" else None

    monkeypatch.setattr(credit, "_fetch_series", fake)
    credit._refresh_fred()
    credit._refresh_fred()
    assert len(calls) == len(credit.FRED_SERIES)  # second call is inside the TTL
    assert credit._read_history()["BAMLH0A0HYM2"] == {"2023-10-23": 4.40, "2026-10-22": 3.40}


def test_columnar_fred_block_converts_spreads_and_derives_funding():
    history = {
        "BAMLH0A0HYM2": {"2026-10-21": 3.29, "2026-10-22": 3.40},
        "STLFSI4": {"2026-10-16": -0.6328},
        "SOFR": {"2026-10-21": 3.88, "2026-10-22": 3.90},
        "IORB": {"2026-10-21": 3.90, "2026-10-22": 3.90},
    }
    block = credit._fred_columnar(history)
    assert block["dates"] == ["2026-10-16", "2026-10-21", "2026-10-22"]
    s = block["series"]
    assert s["hy"] == [None, 329, 340]  # basis points
    assert s["stlfsi"] == [-0.6328, None, None]
    assert s["funding"] == [None, -2, 0]
    assert s["ccc"] == [None, None, None]
    assert block["last"]["hy"] == "2026-10-22" and block["last"]["ccc"] is None


def test_prices_block_aligns_on_spy_days_and_adds_ratios(tmp_path, monkeypatch):
    db = tmp_path / "stocks.duckdb"
    con = duckdb.connect(str(db))
    con.execute("CREATE TABLE daily_bars_adjusted (ticker VARCHAR, date TIMESTAMP, close_adjusted DOUBLE)")
    con.execute("CREATE TABLE macro_series_daily (series_key VARCHAR, date TIMESTAMP, value DOUBLE)")
    d1, d2 = dt.datetime(2026, 10, 22), dt.datetime(2026, 10, 23)
    con.executemany("INSERT INTO daily_bars_adjusted VALUES (?, ?, ?)", [
        ("SPY", d1, 760.0), ("SPY", d2, 759.97), ("HYG", d1, 77.0), ("HYG", d2, 77.05),
        ("IEI", d1, 114.0), ("IEI", d2, 114.67), ("CRWV", d2, 54.23),
    ])
    con.execute("ALTER TABLE daily_bars_adjusted ADD COLUMN close_split_adjusted DOUBLE")
    con.execute("UPDATE daily_bars_adjusted SET close_split_adjusted = close_adjusted")
    con.execute("INSERT INTO daily_bars_adjusted VALUES ('BKLN', ?, 19.9, 20.26)", [d2])
    con.executemany("INSERT INTO macro_series_daily VALUES (?, ?, ?)", [
        ("vix", d2, 19.45), ("vix", dt.datetime(2026, 10, 24), 20.0),
    ])
    con.close()
    monkeypatch.setattr(credit, "INVESTMENT_DB", db)

    block = credit._prices()
    assert block["dates"] == ["2026-10-22", "2026-10-23"]  # VIX's extra day dropped
    s = block["series"]
    assert s["CRWV"] == [None, 54.23]
    assert s["vix"] == [None, 19.45]
    assert s["HYG/IEI"] == [round(77.0 / 114.0, 5), round(77.05 / 114.67, 5)]
    assert s["LQD"] == [None, None]
    assert s["BKLN"] == [None, 20.26]  # split-adjusted price, not the total-return close


def test_history_defaults_follow_the_patched_path(tmp_path):
    credit._write_history({"NFCI": {"2026-10-16": -0.5}})
    assert (tmp_path / "credit/fred_history.csv").exists()  # never the real file


def test_tradingview_fetch_takes_full_history_only_for_unstored_symbols(monkeypatch):
    asked = {}

    def fake(symbol, bars):
        asked[symbol] = bars
        return None if symbol == "TVC:ES10Y" else {"2026-10-23": 3.35}

    monkeypatch.setattr(credit, "_fetch_tv_series", fake)
    out = credit._fetch_tradingview({"TVC:DE10Y": {"2026-10-22": 3.33}})
    assert asked["TVC:DE10Y"] == credit.TV_BARS_TOPUP
    assert asked["TVC:FR10Y"] == credit.TV_BARS_FULL
    assert set(out) == {"TVC:DE10Y", "TVC:FR10Y", "TVC:IT10Y", "TVC:MOVE"}  # failed symbol skipped


def test_tradingview_block_has_bp_spreads_over_bund_and_move():
    history = {
        "TVC:DE10Y": {"2026-10-22": 3.3311, "2026-10-23": 3.3545},
        "TVC:FR10Y": {"2026-10-22": 5.0795, "2026-10-23": 5.019, "2026-10-24": 5.0},
        "TVC:IT10Y": {"2026-10-23": 4.5867},
        "TVC:MOVE": {"2014-12-31": 80.0, "2026-10-23": 103.3223},
    }
    block = credit._tv_columnar(history)
    assert block["dates"] == ["2026-10-22", "2026-10-23"]  # FR's Bund-less day and pre-TV_START MOVE dropped
    assert block["series"]["fr"] == [174.8, 166.5]
    assert block["series"]["it"] == [None, 123.2]
    assert block["series"]["es"] == [None, None]
    assert block["series"]["move"] == [None, 103.3]
    assert block["last"] == {"fr": "2026-10-23", "it": "2026-10-23", "es": None, "move": "2026-10-23"}
