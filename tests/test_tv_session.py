"""Unit tests for tv_session's pure cache/backoff logic.

Browser-free: ``_fetch_cookies_from_profile`` is monkeypatched everywhere, so
no profile access and no playwright launch happens in these tests.
"""

import threading
import time

import pytest

from src.backend import tv_session


@pytest.fixture(autouse=True)
def reset_cache():
    """Fresh module cache (and a short backoff so tests can exercise it)."""
    tv_session._cache = {"cookies": None, "fetched_at": 0.0, "last_fail": 0.0}
    tv_session.FAILURE_BACKOFF = 60
    tv_session.COOKIE_TTL = 6 * 3600
    yield


def test_returns_cached_without_refetch(monkeypatch):
    cookies = {"sessionid": "a", "sessionid_sign": "b"}
    tv_session._cache["cookies"] = dict(cookies)
    tv_session._cache["fetched_at"] = time.time()

    def boom(*a, **k):
        raise AssertionError("fetch must not be called while cache is fresh")

    monkeypatch.setattr(tv_session, "_fetch_cookies_from_profile", boom)
    assert tv_session.get_tv_cookies() == cookies


def test_refetches_after_ttl_expiry(monkeypatch):
    old = {"sessionid": "old", "sessionid_sign": "old"}
    new = {"sessionid": "new", "sessionid_sign": "new"}
    tv_session._cache["cookies"] = dict(old)
    tv_session._cache["fetched_at"] = time.time() - tv_session.COOKIE_TTL - 1
    calls = []

    def fetch(*a, **k):
        calls.append(1)
        return dict(new)

    monkeypatch.setattr(tv_session, "_fetch_cookies_from_profile", fetch)
    assert tv_session.get_tv_cookies() == new
    assert len(calls) == 1


def test_failure_backoff_skips_refetch(monkeypatch):
    tv_session._cache["last_fail"] = time.time() - 1  # within backoff
    calls = []

    def fetch(*a, **k):
        calls.append(1)
        return None

    monkeypatch.setattr(tv_session, "_fetch_cookies_from_profile", fetch)
    assert tv_session.get_tv_cookies() is None
    assert calls == []  # backoff respected, no browser launch


def test_failure_records_backoff_then_recovers(monkeypatch):
    calls = []

    def fetch(*a, **k):
        calls.append(1)
        return None if len(calls) == 1 else {"sessionid": "s", "sessionid_sign": "t"}

    monkeypatch.setattr(tv_session, "_fetch_cookies_from_profile", fetch)
    assert tv_session.get_tv_cookies() is None
    assert tv_session._cache["last_fail"] > 0
    # Second call within backoff: still no fetch.
    assert tv_session.get_tv_cookies() is None
    assert len(calls) == 1
    # Backoff lapses -> fetch again, now succeeds.
    tv_session._cache["last_fail"] = 0.0
    assert tv_session.get_tv_cookies() == {"sessionid": "s", "sessionid_sign": "t"}
    assert len(calls) == 2


def test_concurrent_burst_launches_browser_once(monkeypatch):
    """A burst of requests around a failed launch must not each launch a
    browser: queued threads re-check the backoff under the lock."""
    gate = threading.Event()
    calls = []

    def fetch(*a, **k):
        calls.append(1)
        gate.wait(timeout=10)  # hold the lock so the burst queues up
        return None

    monkeypatch.setattr(tv_session, "_fetch_cookies_from_profile", fetch)
    results = []

    def worker():
        results.append(tv_session.get_tv_cookies())

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    time.sleep(0.3)  # let all threads pass the pre-lock checks and queue
    gate.set()
    for t in threads:
        t.join(timeout=10)

    assert all(r is None for r in results)
    assert len(calls) == 1


def test_cookie_header_empty_without_cookies(monkeypatch):
    monkeypatch.setattr(tv_session, "_fetch_cookies_from_profile", lambda *a, **k: None)
    assert tv_session.cookie_header() == ""


def test_cookie_header_joins_name_value(monkeypatch):
    tv_session._cache["cookies"] = {"sessionid": "a", "sessionid_sign": "b"}
    tv_session._cache["fetched_at"] = time.time()
    assert tv_session.cookie_header() == "sessionid=a; sessionid_sign=b"
