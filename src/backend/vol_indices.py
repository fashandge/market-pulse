"""Volatility-index quotes from CBOE's and Deribit's own JSON APIs.

TradingView's scanner serves no data for these five symbols at any spelling —
they are licensed real-time feeds, and the single-symbol endpoint returns
``null`` for them even with a logged-in session. They used to be filled in by a
headless crawl4ai scrape of the TradingView watchlist page, which cost ~18s per
refresh and (as of Sep 2026) had stopped matching any of them, so every tile
rendered "—".

Both vendors publish the numbers directly:

* **CBOE** (``VIX3M``, ``GVZ``, ``VXSLV``) — ``delayed_quotes/quotes/_SYM.json``
  carries the current level and the session date. Its ``prev_day_close`` is
  unreliable for the thinner indices (GVZ/VXSLV come off a different feed and
  report it equal to the current price, i.e. a flat 0.00% change), so the
  previous close comes from ``charts/historical/_SYM.json`` instead: the last
  daily bar before the live quote's session date. That series is ~500 KB, so it
  is cached per symbol per session date — one fetch per trading day.
* **Deribit** (``DVOL``, ``ETHDVOL``) — ``public/get_volatility_index_data`` at
  daily resolution; the last candle's close is the live level and the previous
  candle's close is the reference, matching how TradingView shows
  ``DERIBIT:DVOL``.

Output dicts are ``quote_format``-shaped, so they merge straight into the
scanner results in ``quotes.fetch_covered_quotes``. Every failure is contained:
a symbol that can't be fetched keeps its last known value, and an empty result
just renders "—" as before rather than failing the overview.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from src.backend import quote_format

CBOE_QUOTE_URL = "https://cdn.cboe.com/api/global/delayed_quotes/quotes/_{symbol}.json"
CBOE_HISTORY_URL = (
    "https://cdn.cboe.com/api/global/delayed_quotes/charts/historical/_{symbol}.json"
)
DERIBIT_URL = (
    "https://www.deribit.com/api/v2/public/get_volatility_index_data"
    "?currency={currency}&resolution=1D"
    "&start_timestamp={start}&end_timestamp={end}"
)

CBOE_SYMBOLS = ("VIX3M", "GVZ", "VXSLV")
DERIBIT_CURRENCIES = {"DVOL": "BTC", "ETHDVOL": "ETH"}
EXCHANGES = {
    **{s: "CBOE" for s in CBOE_SYMBOLS},
    **{s: "DERIBIT" for s in DERIBIT_CURRENCIES},
}
SYMBOLS = frozenset(EXCHANGES)

# The CBOE feed is 15-minute delayed and Deribit's DVOL is a daily-resolution
# candle, so re-fetching more often than this buys nothing.
CACHE_TTL = 60
TIMEOUT = 10
# Deribit needs an explicit window; a week of daily candles is ample for the
# last two closes even across a holiday gap.
DERIBIT_LOOKBACK = 7 * 86400
# CBOE serves these off its public *delayed* feed — the same 15-minute delay
# TradingView gives this account for CBOE indices, so nothing is lost by not
# going through TV. Deribit's API is real-time (TV reports DERIBIT:DVOL as
# "streaming" too).
CBOE_DELAY_LABEL = "15m"

_lock = threading.Lock()
_cache: dict = {"data": {}, "timestamp": 0.0}
# symbol -> (session_date, prev_close) from the CBOE daily history.
_prev_close_cache: dict[str, tuple[str, float]] = {}


def _get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "market-pulse/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.load(resp)


def _cboe_prev_close(symbol: str, session_date: str) -> float | None:
    """Close of the last CBOE daily bar before ``session_date`` (YYYY-MM-DD).

    Cached per session date: the answer only changes when a new session opens.
    """
    cached = _prev_close_cache.get(symbol)
    if cached and cached[0] == session_date:
        return cached[1]
    body = _get_json(CBOE_HISTORY_URL.format(symbol=symbol))
    prior = [
        row for row in body.get("data", [])
        if row.get("date", "") < session_date and row.get("close")
    ]
    if not prior:
        return None
    prev_close = float(prior[-1]["close"])
    _prev_close_cache[symbol] = (session_date, prev_close)
    return prev_close


def _fetch_cboe(symbol: str) -> dict:
    data = _get_json(CBOE_QUOTE_URL.format(symbol=symbol)).get("data") or {}
    close = data.get("current_price")
    if close is None:
        raise ValueError(f"no current_price for {symbol}")
    session_date = str(data.get("last_trade_time", ""))[:10]
    prev_close = None
    if session_date:
        try:
            prev_close = _cboe_prev_close(symbol, session_date)
        except Exception:
            prev_close = None
    if prev_close is None:
        # History unavailable: fall back to the quote's own previous close,
        # which is right for VIX3M and merely yields 0.00% for the others.
        prev_close = data.get("prev_day_close")
    change_abs, change = quote_format.pct_change(close, prev_close)
    return quote_format.build_quote(
        symbol, "CBOE", close, change=change, change_abs=change_abs,
        delay=CBOE_DELAY_LABEL,
    )


def _fetch_deribit(symbol: str) -> dict:
    now_ms = int(time.time() * 1000)
    body = _get_json(DERIBIT_URL.format(
        currency=DERIBIT_CURRENCIES[symbol],
        start=now_ms - DERIBIT_LOOKBACK * 1000,
        end=now_ms,
    ))
    candles = (body.get("result") or {}).get("data") or []
    if not candles:
        raise ValueError(f"no candles for {symbol}")
    close = candles[-1][4]
    prev_close = candles[-2][4] if len(candles) >= 2 else None
    change_abs, change = quote_format.pct_change(close, prev_close)
    return quote_format.build_quote(
        symbol, "DERIBIT", close, change=change, change_abs=change_abs
    )


def _fetch_one(symbol: str) -> dict:
    if symbol in DERIBIT_CURRENCIES:
        return _fetch_deribit(symbol)
    return _fetch_cboe(symbol)


def fetch_vol_quotes() -> dict[str, dict]:
    """All five vol-index quotes, fetched concurrently and TTL-cached.

    A symbol whose fetch fails keeps its previously cached value; if it never
    had one it is simply absent, which renders as "—".
    """
    now = time.time()
    if _cache["data"] and now - _cache["timestamp"] < CACHE_TTL:
        return _cache["data"]
    with _lock:
        if _cache["data"] and time.time() - _cache["timestamp"] < CACHE_TTL:
            return _cache["data"]
        symbols = sorted(SYMBOLS)
        with ThreadPoolExecutor(max_workers=len(symbols)) as pool:
            fetched = list(pool.map(_safe_fetch, symbols))
        result = dict(_cache["data"])
        for symbol, quote in zip(symbols, fetched):
            if quote is not None:
                result[symbol] = quote
        _cache.update(data=result, timestamp=time.time())
        return result


def _safe_fetch(symbol: str) -> dict | None:
    try:
        return _fetch_one(symbol)
    except Exception:
        return None
