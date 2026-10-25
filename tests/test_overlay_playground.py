"""Unit tests for the shared smoothing playground pages."""

import datetime as dt
import json

import duckdb
import pytest

from src.backend import overlay_playground as op


@pytest.fixture(autouse=True)
def reset_cache():
    op._cache.clear()
    yield
    op._cache.clear()


def test_closes_on_aligns_each_etf_to_the_given_days():
    con = duckdb.connect()
    con.execute("CREATE TABLE daily_bars_adjusted (ticker VARCHAR, date TIMESTAMP, close_split_adjusted DOUBLE)")
    con.executemany("INSERT INTO daily_bars_adjusted VALUES (?, ?, ?)", [
        ("QQQ", dt.datetime(2026, 10, 21), 690.0),  # before the first day: dropped
        ("QQQ", dt.datetime(2026, 10, 22), 700.0), ("SMH", dt.datetime(2026, 10, 23), 527.2),
        ("AAPL", dt.datetime(2026, 10, 23), 250.0),  # not an overlay ETF
    ])
    out = op.closes_on(con, ["2026-10-22", "2026-10-23"], "close_split_adjusted")
    assert out == {"QQQ": [700.0, None], "SPY": [None, None], "SMH": [None, 527.2], "SOXX": [None, None]}
    assert op.closes_on(con, [], "close_split_adjusted") == {t: [] for t in op.ETFS}


def test_render_inlines_the_page_config():
    page = {"title": "T", "dates": ["2026-10-23"], "lines": [op.line("X", "Ünïcode", [1.0], op.INDEX_COLOR, True)]}
    html = op.render(page)
    assert "__CONFIG__" not in html
    assert json.loads(html.split("const CONFIG = ", 1)[1].split(";\n", 1)[0]) == page


def test_cached_rebuilds_only_when_a_data_mtime_changes():
    calls = []
    build = lambda: calls.append(1) or f"page {len(calls)}"
    assert op.cached("x", (1.0,), build) == "page 1"
    assert op.cached("x", (1.0,), build) == "page 1"
    assert op.cached("x", (2.0,), build) == "page 2"
