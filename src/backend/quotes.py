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

Two groups of CSV symbols have no scanner data at any spelling and are sourced
from the publishers directly, then merged in by ``fetch_all_quotes``:

* CBOE volatility indices + DERIBIT crypto-vol (``vol_indices.SYMBOLS``), from
  the CBOE and Deribit JSON APIs (``vol_indices``).
* Rows with exchange ``FRED`` (economic series like DFII10/T10YIE), from FRED's
  keyless fredgraph.csv endpoint — TradingView merely republishes FRED, and the
  data is end-of-day with a 1-2 business-day lag, matching what TV shows. When
  FRED is down, DFII10/T10YIE come from Treasury's yield curves
  (``treasury_yields``), the data FRED itself republishes.

Every producer emits the ``quote_format``-shaped dict that
``market_overview.build_overview`` consumes.
"""

from __future__ import annotations

import csv
import io
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from src.backend import quote_format, treasury_yields, tv_session, vol_indices
from src.backend.quote_format import build_quote
from stock_picker.src.watchlist import ticker_csv

SCANNER_URL = "https://scanner.tradingview.com/global/scan"
US_SCANNER_URL = "https://scanner.tradingview.com/america/scan"
# Listing venues for ``fetch_us_prices``: a bare symbol can also match an OTC
# line, which is never the one the dashboard means.
US_EXCHANGES = ["NASDAQ", "NYSE", "AMEX", "CBOE"]
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={ids}"
FRED_CACHE_TTL = 900  # seconds; the series only update once per business day
# ``update_mode`` rides along free in the same batch request and says whether
# the exchange serves this account real-time or delayed data (see
# ``quote_format.delay_label``).
COLUMNS = [
    "close", "change", "change_abs", "volume", "average_volume_10d_calc",
    "update_mode",
]

# Licensed feeds with no free scanner data; see ``vol_indices``.
SCANNER_UNAVAILABLE = set(vol_indices.SYMBOLS)


def _load_symbol_exchanges() -> dict[str, str]:
    """Bare symbol -> exchange from the ticker CSV (first occurrence wins)."""
    out: dict[str, str] = {}
    for row in ticker_csv.rows():
        out.setdefault(row["ticker"], row["exchange"])
    return out


_fred_cache: dict = {"data": {}, "timestamp": 0.0, "ids": ()}


def _fetch_fredgraph(ids: tuple[str, ...]) -> dict[str, dict]:
    """Quotes for ``ids`` from one fredgraph.csv request; {} on any failure.

    During FRED's site maintenance the endpoint answers HTTP 200 with an HTML
    page, which parses as a "CSV" with none of the series columns — that counts
    as a failure too.
    """
    percent = ticker_csv.percent_symbols()
    try:
        url = FRED_CSV_URL.format(ids=",".join(ids))
        with urllib.request.urlopen(url, timeout=10) as resp:
            reader = csv.DictReader(io.TextIOWrapper(resp, encoding="utf-8"))
            rows = list(reader)
            columns = set(reader.fieldnames or ())
    except Exception:
        return {}

    result: dict[str, dict] = {}
    for symbol in ids:
        if symbol not in columns:
            continue
        values = [
            float(row[symbol]) for row in rows
            if row.get(symbol) not in (None, "", ".")
        ]
        if not values:
            continue
        change_abs, change = quote_format.pct_change(
            values[-1], values[-2] if len(values) >= 2 else None
        )
        result[symbol] = build_quote(
            symbol, "FRED", values[-1], change=change, change_abs=change_abs,
            # FRED publishes end-of-day with a 1-2 business-day lag.
            delay="EOD", percent=symbol in percent,
        )
    return result


def _fetch_fred_quotes(symbols: list[str]) -> dict[str, dict]:
    """Latest value + daily change for FRED series, via fredgraph.csv.

    One keyless request covers all series. The change is computed from the last
    two published observations (per series — publication lags differ, so a
    series' newest row can be blank while another's has printed). Series FRED
    doesn't return (e.g. during its site maintenance) fall back to Treasury's
    own yield curves (``treasury_yields``), then to the last cached quote, so
    the rest of the overview still loads.
    """
    ids = tuple(sorted(symbols))
    if not ids:
        return {}
    now = time.time()
    same_ids = ids == _fred_cache["ids"]
    if same_ids and now - _fred_cache["timestamp"] < FRED_CACHE_TTL:
        return _fred_cache["data"]

    result = _fetch_fredgraph(ids)
    missing = [s for s in ids if s not in result]
    if missing:
        result.update(treasury_yields.fetch_quotes(missing))
    if len(result) < len(ids):
        # Don't re-cache a partial result as fresh; keep trying next refresh.
        stale = _fred_cache["data"] if same_ids else {}
        return {**stale, **result}
    _fred_cache.update({"data": result, "timestamp": now, "ids": ids})
    return result


def fetch_covered_quotes(extra: dict[str, str] | None = None) -> dict[str, dict]:
    """Fetch every scanner-covered CSV symbol in one batched request.

    Returns a dict keyed by bare symbol. Symbols in ``SCANNER_UNAVAILABLE`` are
    skipped (see ``fetch_all_quotes``) and ``FRED`` rows are fetched from
    fredgraph.csv and merged in.

    ``extra`` adds symbol -> exchange pairs sourced outside the CSV (portfolio
    holdings not mirrored into it yet); the CSV still wins on conflicts.
    """
    exchanges = {**(extra or {}), **_load_symbol_exchanges()}
    percent = ticker_csv.percent_symbols()
    # formal "EXCHANGE:SYMBOL" -> bare symbol, for mapping the response back.
    formal_to_symbol: dict[str, str] = {}
    fred_symbols: list[str] = []
    for symbol, exchange in exchanges.items():
        if symbol in SCANNER_UNAVAILABLE:
            continue
        if exchange == "FRED":
            fred_symbols.append(symbol)
            continue
        formal_to_symbol[quote_format.formal_symbol(symbol, exchange)] = symbol

    body = _scan(SCANNER_URL, {
        "symbols": {"tickers": list(formal_to_symbol), "query": {"types": []}},
        "columns": COLUMNS,
    })

    result: dict[str, dict] = _fetch_fred_quotes(fred_symbols)
    for row in body.get("data", []):
        formal = row["s"]
        symbol = formal_to_symbol.get(formal)
        if symbol is None:
            continue
        close, change, change_abs, volume, avg_volume, update_mode = (
            row["d"] + [None] * 6
        )[:6]
        quote = build_quote(
            symbol, "", close, change=change, change_abs=change_abs,
            volume=volume, avg_volume=avg_volume,
            delay=quote_format.delay_label(update_mode), percent=symbol in percent,
        )
        # The scanner echoes the symbol it matched, which is authoritative for
        # the chart link (it can differ from the CSV spelling).
        quote["formal_symbol"] = formal
        result[symbol] = quote
    return result


def _scan(url: str, payload: dict) -> dict:
    """POST one scanner query, with the logged-in session when there is one."""
    headers = {"Content-Type": "application/json"}
    cookie = tv_session.cookie_header()
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.load(resp)


def fetch_us_prices(symbols: list[str]) -> dict[str, dict]:
    """Last price for bare US-listed symbols whose exchange is not known.

    One ``america/scan`` request filtered on the ``name`` column resolves the
    listing itself, so a ticker outside the CSV (any Estimates-tab ticker)
    needs no exchange lookup. Returns ``{symbol: {"price", "delay",
    "formal_symbol"}}``; a symbol the scanner does not list is simply absent.
    """
    if not symbols:
        return {}
    body = _scan(US_SCANNER_URL, {
        "filter": [
            {"left": "name", "operation": "in_range", "right": symbols},
            {"left": "exchange", "operation": "in_range", "right": US_EXCHANGES},
        ],
        "columns": ["name", "close", "update_mode"],
        "range": [0, 2 * len(symbols)],
    })
    result: dict[str, dict] = {}
    for row in body.get("data", []):
        name, close, update_mode = (row["d"] + [None] * 3)[:3]
        if name in result or close is None:
            continue
        result[name] = {
            "price": close,
            "delay": quote_format.delay_label(update_mode),
            "formal_symbol": row["s"],
        }
    return result


def fetch_all_quotes(extra: dict[str, str] | None = None) -> dict[str, dict]:
    """Every overview symbol: the scanner batch plus the vol indices.

    The two fetches are independent network calls, so they run concurrently —
    the whole set lands in about as long as the slower one. A vol-index failure
    is contained inside ``vol_indices`` and never fails the scanner path.
    """
    with ThreadPoolExecutor(max_workers=2) as pool:
        covered = pool.submit(fetch_covered_quotes, extra)
        vol = pool.submit(vol_indices.fetch_vol_quotes)
        return {**covered.result(), **vol.result()}
