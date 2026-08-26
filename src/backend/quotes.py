"""Fast quote fetching via TradingView's scanner JSON API.

Replaces the headless-browser watchlist scrape for the vast majority of symbols.
One batched POST to ``scanner.tradingview.com`` returns close / change% /
change_abs / volume / avg-volume for every requested ``EXCHANGE:SYMBOL`` in a
fraction of a second (vs. ~8s for the browser scrape).

The scanner symbol is just ``{exchange}:{ticker}`` built straight from the
ticker CSV, so the CSV's ``exchange`` column is the single source of truth (it
already uses TradingView's exchange names for non-stock rows, e.g. ``TVC`` for
yields/gold, ``CRYPTO`` for BTC/ETH, ``CME_MINI`` for E-mini futures).

**Real-time vs delayed:** anonymously the scanner endpoint serves *delayed*
quotes for US equities (minutes old on fast movers). Calling it with the
logged-in TradingView session cookies (from the crawl4ai profile, via
``tv_session``) returns real-time data matching the website. If the session is
unavailable we silently fall back to the anonymous endpoint — same shape,
just delayed.

A small set of licensed real-time feeds (CBOE volatility indices + DERIBIT
crypto-vol) return no data from the free scanner at any spelling; those are
listed in ``SCANNER_UNAVAILABLE`` and sourced from the watchlist scrape instead
(see ``main.get_overview_gaps``). CSV rows with exchange ``FRED`` (economic
series like DFII10/T10YIE) also have no scanner data, but TradingView merely
republishes FRED, so they are fetched straight from FRED's keyless CSV endpoint
(one request for all series, TTL-cached — the data is end-of-day with a 1-2
business-day lag, matching what TradingView shows). The output dict is shaped
identically to ``watchlist_scraper.scrape_watchlist`` so
``market_overview.build_overview`` can consume either interchangeably.
"""

from __future__ import annotations

import csv
import io
import json
import time
import urllib.request
from pathlib import Path

from src.backend import tv_session

TICKER_CSV = Path.home() / "projects/stock_picker/data/ticker.csv"
SCANNER_URL = "https://scanner.tradingview.com/global/scan"
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={ids}"
FRED_CACHE_TTL = 900  # seconds; the series only update once per business day
COLUMNS = ["close", "change", "change_abs", "volume", "average_volume_10d_calc"]

# Licensed feeds with no free scanner data (CBOE vol indices + DERIBIT crypto
# vol). These are fetched from the watchlist scrape instead.
SCANNER_UNAVAILABLE = {"VIX3M", "GVZ", "VXSLV", "DVOL", "ETHDVOL"}

# Treasury-yield symbols display their price with a trailing "%".
YIELD_SYMBOLS = {"US10Y", "US20Y", "US30Y", "DFII10", "T10YIE"}


def _formal_symbol(ticker: str, exchange: str) -> str:
    return f"{exchange}:{ticker}"


def _num_str(x: float) -> str:
    """Compact numeric string (up to 4 decimals, trailing zeros stripped)."""
    s = f"{x:.4f}".rstrip("0").rstrip(".")
    return s or "0"


def _fmt_price(close: float | None, is_yield: bool) -> str:
    if close is None:
        return "—"
    s = _num_str(close)
    return f"{s}%" if is_yield else s


def _fmt_pct(change: float | None) -> str:
    if change is None:
        return ""
    return f"{change:+.2f}%"


def _fmt_change_abs(change_abs: float | None) -> str:
    if change_abs is None:
        return ""
    if abs(change_abs) >= 1000:
        return f"{change_abs:+,.0f}"
    return f"{change_abs:+.2f}"


def _fmt_volume(v: float | None) -> str:
    if not v or v <= 0:
        return ""
    for suffix, mult in (("T", 1e12), ("B", 1e9), ("M", 1e6), ("K", 1e3)):
        if v >= mult:
            return f"{v / mult:.2f}{suffix}"
    return f"{v:.0f}"


def _load_symbol_exchanges() -> dict[str, str]:
    """Bare symbol -> exchange from the ticker CSV (first occurrence wins)."""
    out: dict[str, str] = {}
    with open(TICKER_CSV) as f:
        for row in csv.DictReader(f):
            out.setdefault(row["ticker"], row["exchange"])
    return out


_fred_cache: dict = {"data": {}, "timestamp": 0.0, "ids": ()}


def _fetch_fred_quotes(symbols: list[str]) -> dict[str, dict]:
    """Latest value + daily change for FRED series, via fredgraph.csv.

    One keyless request covers all series. The change is computed from the last
    two published observations (per series — publication lags differ, so a
    series' newest row can be blank while another's has printed). Failures
    return the last cached data, or {} so the rest of the overview still loads.
    """
    ids = tuple(sorted(symbols))
    if not ids:
        return {}
    now = time.time()
    if ids == _fred_cache["ids"] and now - _fred_cache["timestamp"] < FRED_CACHE_TTL:
        return _fred_cache["data"]

    try:
        url = FRED_CSV_URL.format(ids=",".join(ids))
        with urllib.request.urlopen(url, timeout=10) as resp:
            rows = list(csv.DictReader(io.TextIOWrapper(resp, encoding="utf-8")))
    except Exception:
        return _fred_cache["data"] if ids == _fred_cache["ids"] else {}

    result: dict[str, dict] = {}
    for symbol in ids:
        values = [
            float(row[symbol]) for row in rows
            if row.get(symbol) not in (None, "", ".")
        ]
        if not values:
            continue
        close = values[-1]
        change_abs = close - values[-2] if len(values) >= 2 else None
        change = (
            change_abs / values[-2] * 100
            if change_abs is not None and values[-2] else None
        )
        result[symbol] = {
            "price": _fmt_price(close, symbol in YIELD_SYMBOLS),
            "change_pct": _fmt_pct(change),
            "change_pct_float": round(change, 2) if change is not None else None,
            "change_abs": _fmt_change_abs(change_abs),
            "volume": "",
            "avg_volume": "",
            "formal_symbol": _formal_symbol(symbol, "FRED"),
        }
    _fred_cache.update({"data": result, "timestamp": now, "ids": ids})
    return result


def fetch_covered_quotes(extra: dict[str, str] | None = None) -> dict[str, dict]:
    """Fetch every scanner-covered CSV symbol in one batched request.

    Returns a dict keyed by bare symbol with the same fields
    ``scrape_watchlist`` produces (minus the unused ``section``). Symbols in
    ``SCANNER_UNAVAILABLE`` are skipped — they come from the scrape instead —
    and ``FRED`` rows are fetched from fredgraph.csv and merged in.

    ``extra`` adds symbol -> exchange pairs sourced outside the CSV (portfolio
    holdings not mirrored into it yet); the CSV still wins on conflicts.
    """
    exchanges = {**(extra or {}), **_load_symbol_exchanges()}
    # formal "EXCHANGE:SYMBOL" -> bare symbol, for mapping the response back.
    formal_to_symbol: dict[str, str] = {}
    fred_symbols: list[str] = []
    for symbol, exchange in exchanges.items():
        if symbol in SCANNER_UNAVAILABLE:
            continue
        if exchange == "FRED":
            fred_symbols.append(symbol)
            continue
        formal_to_symbol[_formal_symbol(symbol, exchange)] = symbol

    payload = json.dumps({
        "symbols": {"tickers": list(formal_to_symbol), "query": {"types": []}},
        "columns": COLUMNS,
    }).encode()
    headers = {"Content-Type": "application/json"}
    cookie = tv_session.cookie_header()
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(SCANNER_URL, data=payload, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = json.load(resp)

    result: dict[str, dict] = _fetch_fred_quotes(fred_symbols)
    for row in body.get("data", []):
        formal = row["s"]
        symbol = formal_to_symbol.get(formal)
        if symbol is None:
            continue
        close, change, change_abs, volume, avg_volume = (row["d"] + [None] * 5)[:5]
        result[symbol] = {
            "price": _fmt_price(close, symbol in YIELD_SYMBOLS),
            "change_pct": _fmt_pct(change),
            "change_pct_float": round(change, 2) if change is not None else None,
            "change_abs": _fmt_change_abs(change_abs),
            "volume": _fmt_volume(volume),
            "avg_volume": _fmt_volume(avg_volume),
            "formal_symbol": formal,
        }
    return result
