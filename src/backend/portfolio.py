"""Portfolio holdings, read from the user's TradingView ``portfolio`` watchlist.

The holdings list is *not* hardcoded here. It is whatever the TradingView
watchlist named ``portfolio`` contains, fetched through stock_picker's
``tv_watchlist.py --list-symbols`` (which drives the logged-in Chrome session and
owns all TradingView watchlist logic).

The watchlist also carries benchmarks the user tracks alongside the holdings
(NDX / QQQ / SPX / SMH / SOXX). Those are dropped by *instrument type*, which
TradingView's scanner reports authoritatively (``index``, ``fund`` for ETFs,
``futures``, …) — resolved once per refresh and cached, so classification costs
nothing per request and does not depend on the symbol being in ``ticker.csv``.

The filter is a drop-list, not a keep-list, so anything unrecognized survives:
ADRs classify as ``dr`` rather than ``stock`` (TSM, ARM, SKHY), and a symbol the
scanner doesn't cover has no type at all. A holding is better shown as a dashed
tile than silently omitted. ``ticker.csv``'s ``ticker_type`` is the fallback
when the scanner has nothing.

Fetching costs a headless-Chrome launch (~10s), so the resolved list is cached
on disk at ``data/portfolio.json``:

* a cached list is served immediately, however old it is;
* a stale cache triggers a background refresh, so no request ever blocks on
  Chrome after the first one;
* the file is rewritten only when the contents actually change (its mtime is
  touched either way), so a refresh that finds nothing new costs no write;
* if TradingView is unreachable the last known list keeps serving; with no cache
  at all the Portfolio section is omitted rather than falling back to a guess.
"""

from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from src.backend import quotes

TV_WATCHLIST_CLI = (
    Path.home()
    / "projects/stock_picker/skills/manage-tradingview-watchlist/tv_watchlist.py"
)
WATCHLIST_NAME = "portfolio"
TICKER_CSV = Path.home() / "projects/stock_picker/data/ticker.csv"
CACHE_FILE = Path(__file__).resolve().parents[2] / "data" / "portfolio.json"
CACHE_TTL = 6 * 3600
FETCH_TIMEOUT = 180

# Instrument types that are benchmarks/instruments rather than holdings. Covers
# both TradingView's vocabulary ("fund" = ETF) and ticker.csv's ("etf").
NON_HOLDING_TYPES = {
    "index", "fund", "etf", "futures", "spot", "crypto",
    "commodity", "forex", "bond", "economic",
}

_refresh_lock = threading.Lock()
_refreshing = False


def _ticker_types() -> dict[str, str]:
    """Bare symbol -> ticker_type from the ticker CSV (first occurrence wins)."""
    out: dict[str, str] = {}
    try:
        with open(TICKER_CSV) as f:
            for row in csv.DictReader(f):
                out.setdefault(row["ticker"], row["ticker_type"])
    except OSError:
        pass
    return out


def _holdings(formal_symbols: list[str], types: dict[str, str]) -> list[tuple[str, str]]:
    """Filter watchlist ``EXCHANGE:SYMBOL`` entries down to (symbol, exchange)
    holdings, dropping the benchmark indices/ETFs and preserving order.

    ``types`` maps formal symbol -> TradingView instrument type (from the cache);
    ``ticker.csv`` covers anything missing from it.
    """
    csv_types = _ticker_types()
    out: list[tuple[str, str]] = []
    for formal in formal_symbols:
        exchange, _, symbol = formal.rpartition(":")
        if not symbol:
            continue
        kind = types.get(formal) or csv_types.get(symbol)
        if kind in NON_HOLDING_TYPES:
            continue
        out.append((symbol, exchange or symbol))
    return out


def _fetch_formal_symbols() -> list[str]:
    """Run the stock_picker CLI and return the watchlist's ordered symbols."""
    from agents.env import build_env

    proc = subprocess.run(
        [sys.executable, str(TV_WATCHLIST_CLI),
         "--list-symbols", "--watchlist", WATCHLIST_NAME],
        capture_output=True, text=True, timeout=FETCH_TIMEOUT, env=build_env(),
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"tv_watchlist.py failed ({proc.returncode}): {proc.stderr.strip()[-500:]}"
        )
    # The CLI prints one JSON line to stdout; Chrome/node chatter may precede it.
    for line in reversed(proc.stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            payload = json.loads(line)
            if "error" in payload:
                raise RuntimeError(f"tv_watchlist.py: {payload['error']}")
            return payload["symbols"]
    raise RuntimeError(f"tv_watchlist.py produced no JSON: {proc.stdout[-500:]!r}")


def _read_cache() -> tuple[list[str], dict[str, str]] | None:
    """Cached ``(formal symbols, formal symbol -> instrument type)``."""
    try:
        payload = json.loads(CACHE_FILE.read_text())
        return payload["symbols"], payload.get("types", {})
    except (OSError, ValueError, KeyError):
        return None


def _write_cache(symbols: list[str], types: dict[str, str]) -> None:
    """Persist the symbols and their types, rewriting the file only if something
    changed. The mtime is always touched so a no-change refresh resets the TTL."""
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"watchlist": WATCHLIST_NAME, "symbols": symbols, "types": types}
    if CACHE_FILE.exists() and _read_cache() == (symbols, types):
        os.utime(CACHE_FILE)
        return
    CACHE_FILE.write_text(json.dumps(payload, indent=2) + "\n")


def _cache_age() -> float:
    try:
        return time.time() - CACHE_FILE.stat().st_mtime
    except OSError:
        return float("inf")


def _refresh() -> tuple[list[str], dict[str, str]]:
    symbols = _fetch_formal_symbols()
    try:
        types = quotes.fetch_types(symbols)
    except Exception as e:
        # Classification degrades to ticker.csv rather than failing the refresh.
        print(f"[portfolio] type lookup failed: {e}", flush=True)
        types = {}
    _write_cache(symbols, types)
    return symbols, types


def _refresh_in_background() -> None:
    global _refreshing
    with _refresh_lock:
        if _refreshing:
            return
        _refreshing = True

    def run() -> None:
        global _refreshing
        try:
            _refresh()
        except Exception as e:  # a stale cache keeps serving; never break a request
            print(f"[portfolio] background refresh failed: {e}", flush=True)
        finally:
            with _refresh_lock:
                _refreshing = False

    threading.Thread(target=run, daemon=True).start()


def load_holdings(force: bool = False) -> list[tuple[str, str]]:
    """Portfolio holdings as ordered ``(symbol, exchange)`` pairs.

    Serves the disk cache and refreshes it in the background once stale, so only
    the very first call (cold cache) can block on the browser. ``force`` makes
    the refresh synchronous.
    """
    cached = _read_cache()
    if force or cached is None:
        try:
            cached = _refresh()
        except Exception as e:
            print(f"[portfolio] refresh failed: {e}", flush=True)
            if cached is None:
                return []
    elif _cache_age() > CACHE_TTL:
        _refresh_in_background()
    return _holdings(*cached)


def load_symbols(force: bool = False) -> list[str]:
    """Portfolio holdings as bare symbols, in watchlist order."""
    return [symbol for symbol, _ in load_holdings(force)]
