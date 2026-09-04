"""Background overview snapshot: freshness gate, cadence, failure containment."""

import time

import pytest

from src.backend import overview_cache


@pytest.fixture(autouse=True)
def clean_state():
    overview_cache._state.update(payload=None, fetched_at=0.0, last_request=0.0)
    yield
    overview_cache.stop()
    overview_cache._state.update(payload=None, fetched_at=0.0, last_request=0.0)


def _stub(monkeypatch, calls=None, payload=None, fail=False):
    def build():
        if calls is not None:
            calls.append(time.monotonic())
        if fail:
            raise OSError("upstream down")
        return payload or {"sections": [], "updated_at": "09:30 (Sep 04, 2026)"}

    monkeypatch.setattr(overview_cache, "_build", build)


def test_fresh_snapshot_is_served_without_fetching(monkeypatch):
    calls = []
    _stub(monkeypatch, calls)
    overview_cache.refresh()
    assert len(calls) == 1
    body = overview_cache.get_overview()
    assert len(calls) == 1  # served from the snapshot, no second build
    assert body["updated_at"] == "09:30 (Sep 04, 2026)"
    assert body["age_seconds"] < 1


def test_stale_snapshot_is_refetched_rather_than_served(monkeypatch):
    calls = []
    _stub(monkeypatch, calls)
    overview_cache.refresh()
    overview_cache._state["fetched_at"] -= overview_cache.MAX_SERVE_AGE + 1
    overview_cache.get_overview()
    assert len(calls) == 2


def test_force_always_fetches(monkeypatch):
    calls = []
    _stub(monkeypatch, calls)
    overview_cache.refresh()
    overview_cache.get_overview(force=True)
    assert len(calls) == 2


def test_failed_refresh_keeps_serving_last_known_data(monkeypatch):
    _stub(monkeypatch, payload={"sections": ["old"], "updated_at": "09:30"})
    overview_cache.refresh()
    _stub(monkeypatch, fail=True)
    overview_cache._state["fetched_at"] -= overview_cache.MAX_SERVE_AGE + 1
    body = overview_cache.get_overview()
    assert body["sections"] == ["old"]
    assert body["age_seconds"] > overview_cache.MAX_SERVE_AGE


def test_refresh_min_age_skips_a_rebuild_another_thread_just_did(monkeypatch):
    calls = []
    _stub(monkeypatch, calls)
    overview_cache.refresh()
    overview_cache.refresh(min_age=overview_cache.MAX_SERVE_AGE)
    assert len(calls) == 1


def test_max_serve_age_exceeds_idle_cadence():
    # Otherwise the first page load on an idle server always fetches
    # synchronously, which is the latency this module exists to remove.
    assert overview_cache.MAX_SERVE_AGE > overview_cache.REFRESH_IDLE


def test_background_thread_refreshes_and_a_request_speeds_it_up(monkeypatch):
    calls = []
    _stub(monkeypatch, calls)
    monkeypatch.setattr(overview_cache, "TICK", 0.01)
    monkeypatch.setattr(overview_cache, "REFRESH_ACTIVE", 0.02)
    monkeypatch.setattr(overview_cache, "REFRESH_IDLE", 100.0)

    overview_cache.start()
    time.sleep(0.15)
    idle_calls = len(calls)
    assert idle_calls >= 1  # built once, then idled

    overview_cache.get_overview()  # marks the server active
    time.sleep(0.15)
    assert len(calls) > idle_calls + 1
