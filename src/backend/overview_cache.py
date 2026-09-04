"""Background-refreshed snapshot of the market overview.

The overview is assembled from network calls that take ~1-1.5s no matter how
they are sliced (measured: splitting the 176-symbol TradingView scanner POST
into four parallel chunks is no faster — the cost is round-trip latency, not
payload size). Paying that on every page load is what made the Overview tab
feel slow, so the fetch is moved off the request path entirely: a daemon thread
keeps a fresh snapshot in memory and ``get_overview`` hands it over with no I/O.

Freshness is bounded from both ends:

* The refresher runs every ``REFRESH_ACTIVE`` seconds while someone is actually
  looking (a request within ``ACTIVE_WINDOW``) and backs off to
  ``REFRESH_IDLE`` when nobody is, so an idle server doesn't hammer TradingView.
* A request that finds a snapshot older than ``MAX_SERVE_AGE`` fetches
  synchronously instead of serving it, so a stale snapshot is never displayed —
  the worst case degrades to the old behaviour rather than to stale numbers.

``force=1`` (the UI's refresh button) always fetches synchronously.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from src.backend import market_overview, portfolio, quotes

# Cadence of the background refresher, in seconds.
REFRESH_ACTIVE = 5.0
REFRESH_IDLE = 30.0
# A request this recent means someone has the dashboard open.
ACTIVE_WINDOW = 120.0
# Older than this and a request refuses to serve the snapshot, fetching instead.
# Must exceed REFRESH_IDLE, or an idle server would fetch synchronously on
# every first page load — the exact latency this module exists to remove.
MAX_SERVE_AGE = 35.0
# Granularity of the refresher's sleep; also how fast it notices new activity.
TICK = 1.0

_lock = threading.Lock()
_state: dict = {
    "payload": None,     # last successfully built response body
    "fetched_at": 0.0,   # monotonic time of that build
    "last_request": 0.0, # monotonic time of the last get_overview call
}
_stop = threading.Event()
_thread: threading.Thread | None = None


def _now_la() -> str:
    return datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%H:%M (%b %d, %Y)")


def _build() -> dict:
    holdings = portfolio.load_holdings()
    quote_data = quotes.fetch_all_quotes(extra=dict(holdings))
    sections = market_overview.build_overview(
        quote_data, [symbol for symbol, _ in holdings]
    )
    return {"sections": sections, "updated_at": _now_la()}


def refresh(min_age: float = 0.0) -> dict | None:
    """Rebuild the snapshot. Returns the new payload, or None if the fetch
    failed and an earlier snapshot (if any) was left in place.

    ``min_age`` skips the rebuild when the snapshot is already younger than
    that — a request waiting on the lock behind a refresh in flight gets the
    result of that refresh instead of immediately triggering another one.
    """
    with _lock:
        if min_age and _state["payload"] is not None:
            if time.monotonic() - _state["fetched_at"] < min_age:
                return _state["payload"]
        try:
            payload = _build()
        except Exception:
            return None
        _state["payload"] = payload
        _state["fetched_at"] = time.monotonic()
        return payload


def get_overview(force: bool = False, max_age: float = MAX_SERVE_AGE) -> dict:
    """The overview body, from the snapshot when it is fresh enough.

    Marks the server as active, so the refresher speeds up while the dashboard
    is open. Raises only if there is no snapshot *and* the fetch fails.
    """
    now = time.monotonic()
    _state["last_request"] = now
    payload = _state["payload"]
    if not force and payload is not None and now - _state["fetched_at"] <= max_age:
        return _with_age(payload)
    fresh = refresh(min_age=0.0 if force else max_age)
    if fresh is not None:
        return _with_age(fresh)
    if payload is not None:
        # Fetch failed; last-known data beats an error page.
        return _with_age(payload)
    return _with_age(_build(), age=0.0)


def _with_age(payload: dict, age: float | None = None) -> dict:
    if age is None:
        age = time.monotonic() - _state["fetched_at"]
    return {**payload, "age_seconds": round(age, 1)}


def _loop() -> None:
    while not _stop.is_set():
        now = time.monotonic()
        active = now - _state["last_request"] < ACTIVE_WINDOW
        interval = REFRESH_ACTIVE if active else REFRESH_IDLE
        if now - _state["fetched_at"] >= interval:
            refresh()
        _stop.wait(TICK)


def start() -> None:
    """Start the refresher (idempotent). Called from the FastAPI lifespan."""
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="overview-refresher", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
