"""TradingView session cookies for the scanner quote API.

The anonymous scanner endpoint (``scanner.tradingview.com/global/scan``) serves
**delayed** quotes for US equities — verified empirically: on a fast mover like
AMD it lags the real-time tape by ~$2-4 and its volume trails by hundreds of
thousands of shares. The same endpoint serves **real-time** data when called
with the logged-in TradingView session (``sessionid`` + ``sessionid_sign``
cookies, matching what the website shows).

Those cookies live in the crawl4ai persistent browser profile
(``~/.crawl4ai/tradingview-profile``), which is already logged into
TradingView. We read them with playwright (a short headless launch of that
profile) so the browser itself performs the platform cookie decryption — no
manual cookie-DB forensics needed.

Cookies are cached in memory for ``COOKIE_TTL``: the TV session is long-lived
and launching the browser costs ~2s. On any failure (profile locked by a
concurrent crawl4ai scrape, browser launch error, not logged in) we return
None and the caller falls back to the anonymous endpoint, which still works —
just delayed. A short failure backoff stops repeated browser launches from
hammering a locked profile.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

PROFILE_DIR = Path.home() / ".crawl4ai" / "tradingview-profile"
TV_ORIGIN = "https://www.tradingview.com"
LAUNCH_TIMEOUT_MS = 20_000

# TradingView sessions are long-lived; refresh the cached cookies every 6h.
COOKIE_TTL = 6 * 3600
# Don't retry a failed browser launch more often than this (e.g. the profile
# may be locked while watchlist_scraper is mid-scrape).
FAILURE_BACKOFF = 60

REQUIRED_COOKIES = ("sessionid", "sessionid_sign")

_lock = threading.Lock()
_cache: dict = {"cookies": None, "fetched_at": 0.0, "last_fail": 0.0}


def _fetch_cookies_from_profile() -> dict[str, str] | None:
    """Launch the logged-in profile and read the TV session cookies.

    The browser decrypts the cookie store in memory, so this works regardless
    of platform cookie-encryption changes. Returns None on any failure.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None
    try:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                str(PROFILE_DIR), headless=True, timeout=LAUNCH_TIMEOUT_MS
            )
            try:
                cookies = ctx.cookies(TV_ORIGIN)
            finally:
                ctx.close()
    except Exception:
        return None
    wanted = {
        c["name"]: c["value"]
        for c in cookies
        if c["name"] in REQUIRED_COOKIES and c.get("value")
    }
    return wanted if all(k in wanted for k in REQUIRED_COOKIES) else None


def get_tv_cookies() -> dict[str, str] | None:
    """Return cached TV session cookies (``{name: value}``), refreshing when
    stale. None means "anonymous fallback" — either never fetched yet or the
    profile/browser is unavailable.
    """
    now = time.time()
    cached = _cache["cookies"]
    if cached is not None and now - _cache["fetched_at"] < COOKIE_TTL:
        return cached
    if now - _cache["last_fail"] < FAILURE_BACKOFF:
        return cached  # may be None (fully anonymous) or stale-but-usable
    with _lock:
        # Re-check under the lock: another request may have refreshed already.
        if _cache["cookies"] is not None and time.time() - _cache["fetched_at"] < COOKIE_TTL:
            return _cache["cookies"]
        cookies = _fetch_cookies_from_profile()
        if cookies:
            _cache.update(cookies=cookies, fetched_at=time.time())
        else:
            _cache["last_fail"] = time.time()
        return cookies or _cache["cookies"]


def cookie_header() -> str:
    """HTTP ``Cookie`` header value for the scanner endpoint, or empty."""
    cookies = get_tv_cookies()
    if not cookies:
        return ""
    return "; ".join(f"{k}={v}" for k, v in cookies.items())
