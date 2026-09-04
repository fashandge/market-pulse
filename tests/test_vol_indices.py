"""Vol-index quotes (CBOE + Deribit) — parsing, previous-close choice, caching."""

import pytest

from src.backend import vol_indices


@pytest.fixture(autouse=True)
def clear_caches():
    vol_indices._cache.update(data={}, timestamp=0.0)
    vol_indices._prev_close_cache.clear()
    yield
    vol_indices._cache.update(data={}, timestamp=0.0)
    vol_indices._prev_close_cache.clear()


CBOE_QUOTE = {
    "data": {
        "current_price": 26.63,
        "prev_day_close": 26.63,  # the stale value GVZ/VXSLV actually report
        "last_trade_time": "2026-09-04T15:02:01.322000-05:00",
    }
}
CBOE_HISTORY = {
    "data": [
        {"date": "2026-09-02", "close": "26.140000"},
        {"date": "2026-09-03", "close": "27.180000"},
        {"date": "2026-09-04", "close": "26.630000"},
    ]
}


def test_cboe_prefers_history_over_stale_prev_day_close(monkeypatch):
    def fake_get(url):
        return CBOE_HISTORY if "historical" in url else CBOE_QUOTE

    monkeypatch.setattr(vol_indices, "_get_json", fake_get)
    q = vol_indices._fetch_cboe("GVZ")
    # 26.63 vs the 2026-09-03 close of 27.18 — not the flat 0.00% the quote
    # endpoint's own prev_day_close would have produced.
    assert q["price"] == "26.63"
    assert q["change_abs"] == "-0.55"
    assert q["change_pct"] == "-2.02%"
    assert q["change_pct_float"] == -2.02
    assert q["formal_symbol"] == "CBOE:GVZ"


def test_cboe_history_cached_per_session_date(monkeypatch):
    calls = []

    def fake_get(url):
        calls.append(url)
        return CBOE_HISTORY if "historical" in url else CBOE_QUOTE

    monkeypatch.setattr(vol_indices, "_get_json", fake_get)
    vol_indices._fetch_cboe("GVZ")
    vol_indices._fetch_cboe("GVZ")
    assert sum("historical" in u for u in calls) == 1


def test_cboe_falls_back_to_prev_day_close_when_history_fails(monkeypatch):
    quote = {"data": {**CBOE_QUOTE["data"], "prev_day_close": 17.42,
                      "current_price": 17.61}}

    def fake_get(url):
        if "historical" in url:
            raise OSError("cdn down")
        return quote

    monkeypatch.setattr(vol_indices, "_get_json", fake_get)
    q = vol_indices._fetch_cboe("VIX3M")
    assert q["change_pct"] == "+1.09%"


def test_deribit_uses_last_two_daily_closes(monkeypatch):
    body = {"result": {"data": [
        [1788393600000, 37.19, 40.87, 36.30, 39.78],
        [1788480000000, 39.78, 39.79, 37.36, 37.83],
    ]}}
    monkeypatch.setattr(vol_indices, "_get_json", lambda url: body)
    q = vol_indices._fetch_deribit("DVOL")
    assert q["price"] == "37.83"
    assert q["change_abs"] == "-1.95"
    assert q["change_pct"] == "-4.90%"
    assert q["formal_symbol"] == "DERIBIT:DVOL"


def test_failed_symbol_keeps_its_last_known_value(monkeypatch):
    monkeypatch.setattr(vol_indices, "_fetch_one", lambda s: {"price": "1", "sym": s})
    first = vol_indices.fetch_vol_quotes()
    assert set(first) == set(vol_indices.SYMBOLS)

    def boom(symbol):
        raise OSError("network")

    monkeypatch.setattr(vol_indices, "_fetch_one", boom)
    vol_indices._cache["timestamp"] = 0.0
    assert vol_indices.fetch_vol_quotes() == first


def test_ttl_cache_skips_refetch(monkeypatch):
    calls = []
    monkeypatch.setattr(
        vol_indices, "_fetch_one", lambda s: calls.append(s) or {"price": "1"}
    )
    vol_indices.fetch_vol_quotes()
    vol_indices.fetch_vol_quotes()
    assert len(calls) == len(vol_indices.SYMBOLS)
