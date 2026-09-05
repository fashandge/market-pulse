"""The `delay` field: TradingView update_mode -> label, and its pass-through."""

import pytest

from src.backend import market_overview, quote_format, vol_indices


@pytest.mark.parametrize("update_mode,expected", [
    ("streaming", ""),
    (None, ""),
    ("", ""),
    ("delayed_streaming_900", "15m"),
    ("delayed_streaming_600", "10m"),
    ("delayed_streaming_1200", "20m"),
    ("endofday", "EOD"),
    ("something_new", "delayed"),
])
def test_delay_label(update_mode, expected):
    assert quote_format.delay_label(update_mode) == expected


def test_build_quote_defaults_to_real_time():
    assert quote_format.build_quote("NVDA", "NASDAQ", 230.36)["delay"] == ""


def test_cboe_quotes_are_labelled_delayed(monkeypatch):
    monkeypatch.setattr(vol_indices, "_get_json", lambda url: (
        {"data": [{"date": "2026-09-03", "close": "27.18"}]} if "historical" in url
        else {"data": {"current_price": 26.63,
                       "last_trade_time": "2026-09-04T15:02:01-05:00"}}
    ))
    vol_indices._prev_close_cache.clear()
    assert vol_indices._fetch_cboe("GVZ")["delay"] == "15m"


def test_deribit_quotes_are_real_time(monkeypatch):
    monkeypatch.setattr(vol_indices, "_get_json", lambda url: {"result": {"data": [
        [1788393600000, 37.19, 40.87, 36.30, 39.78],
        [1788480000000, 39.78, 39.79, 37.36, 37.83],
    ]}})
    assert vol_indices._fetch_deribit("DVOL")["delay"] == ""


def test_build_overview_passes_delay_through(monkeypatch):
    monkeypatch.setattr(market_overview, "_load_all_groups",
                        lambda: {"Major Indices": ["SPX", "SPY"]})
    quotes = {
        "SPX": {"price": "7718.6", "change_pct": "-0.38%", "change_pct_float": -0.38,
                "change_abs": "-29.4", "volume": "", "avg_volume": "",
                "formal_symbol": "CBOE:SPX", "delay": "15m"},
        "SPY": {"price": "770.19", "change_pct": "-0.39%", "change_pct_float": -0.39,
                "change_abs": "-3.0", "volume": "", "avg_volume": "",
                "formal_symbol": "AMEX:SPY", "delay": ""},
    }
    tickers = market_overview.build_overview(quotes, [])[0]["groups"][0]["tickers"]
    assert {t["symbol"]: t["delay"] for t in tickers} == {"SPX": "15m", "SPY": ""}


def test_missing_symbol_is_not_labelled_delayed(monkeypatch):
    monkeypatch.setattr(market_overview, "_load_all_groups",
                        lambda: {"Major Indices": ["NOPE"]})
    ticker = market_overview.build_overview({}, [])[0]["groups"][0]["tickers"][0]
    assert ticker["price"] == "—" and ticker["delay"] == ""
