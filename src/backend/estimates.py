"""Analyst estimates for the Overview "Estimates" tab.

stock_picker's ``scripts/fetch_estimates.py`` writes one JSON file per ticker
to ``~/projects/stock_picker/data/estimates/<TICKER>.json``: consensus EPS and
revenue by fiscal year (Seeking Alpha, cross-checked against
stockanalysis.com) plus price, mean target and the rating-change log (finviz).
A weekly launchd job refreshes the portfolio holdings; any other ticker is
there only because someone ran the script for it.

Listing is a plain per-request read of that folder, like ``portfolio.py``:
no network, no cache. The files are passed through unchanged with one added
field, ``in_portfolio``; holdings come first in watchlist order, then
everything else alphabetically.

The tab's search box can also ask for a ticker that is not cached yet
(``get_or_fetch``), which runs stock_picker's fetcher in-process: three
outbound requests, about two seconds. The app is reachable through the tunnel
without auth, so that path is bounded: the ticker must be in the chart
universe, a cache file younger than ``REFETCH_AFTER`` is returned as is, and
at most ``MAX_FETCHES_PER_HOUR`` fetches run in any hour, one at a time.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from stock_picker.scripts import fetch_estimates

from src.backend import portfolio
from src.backend.tickers import charts

ESTIMATES_DIR = Path.home() / "projects/stock_picker/data/estimates"

# What the tab cannot render a row without.
_REQUIRED = ("ticker", "fetched_at", "years", "ratings")

# Consensus moves over days, not minutes: a younger cache file is good enough,
# and returning it makes a repeated request free.
REFETCH_AFTER = timedelta(hours=1)
MAX_FETCHES_PER_HOUR = 30

_fetch_lock = threading.Lock()
_fetch_times: list[float] = []


class UnknownTicker(LookupError):
    """The symbol is not in the chart ticker universe."""


class RateLimited(RuntimeError):
    """The hourly fetch budget is spent."""


class FetchFailed(RuntimeError):
    """A source refused the request or has no estimates for this ticker."""


def _read(path: Path) -> dict | None:
    """One cache file, or None when it is missing, invalid or lacks a required field."""
    try:
        with open(path) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or any(key not in data for key in _REQUIRED):
        return None
    return data


def load_estimates() -> dict:
    """Every cached ticker as ``{"tickers": [...], "unreadable": [...]}``.

    A file that is not valid JSON, or lacks the fields the tab needs, is named
    in ``unreadable`` rather than failing the whole response. A missing folder
    yields an empty list.
    """
    cached: dict[str, dict] = {}
    unreadable: list[str] = []
    for path in sorted(ESTIMATES_DIR.glob("*.json")):
        data = _read(path)
        if data is None:
            unreadable.append(path.name)
            continue
        cached[data["ticker"]] = data

    holdings = [s for s in portfolio.load_symbols() if s in cached]
    others = sorted(t for t in cached if t not in holdings)
    return {
        "tickers": [
            {**cached[t], "in_portfolio": t in holdings} for t in holdings + others
        ],
        "unreadable": unreadable,
    }


def get_or_fetch(ticker: str) -> dict:
    """One ticker's estimates: the cache when it is fresh, otherwise a live fetch.

    Raises ``UnknownTicker`` for a symbol outside the chart universe (checked
    first, so an arbitrary string never reaches a source or the filesystem),
    ``RateLimited`` when the hourly budget is spent, and ``FetchFailed`` when
    the fetcher could not read a source; a failed fetch leaves any existing
    cache file untouched.
    """
    ticker = ticker.strip().upper()
    if ticker not in {t["symbol"] for t in charts.list_tickers()}:
        raise UnknownTicker(ticker)

    def fresh() -> dict | None:
        data = _read(ESTIMATES_DIR / f"{ticker}.json")
        if data is None:
            return None
        age = datetime.now().astimezone() - datetime.fromisoformat(data["fetched_at"])
        return data if age < REFETCH_AFTER else None

    with _fetch_lock:
        # Re-checked under the lock: a second request for the same ticker that
        # queued behind the first reads its result instead of fetching again.
        data = fresh()
        if data is None:
            now = time.monotonic()
            _fetch_times[:] = [t for t in _fetch_times if now - t < 3600]
            if len(_fetch_times) >= MAX_FETCHES_PER_HOUR:
                raise RateLimited(f"more than {MAX_FETCHES_PER_HOUR} fetches in the last hour")
            _fetch_times.append(now)
            try:
                data = fetch_estimates.fetch_ticker(ticker, ESTIMATES_DIR)
            except fetch_estimates.EstimatesError as exc:
                raise FetchFailed(str(exc)) from exc
    return {**data, "in_portfolio": ticker in portfolio.load_symbols()}
