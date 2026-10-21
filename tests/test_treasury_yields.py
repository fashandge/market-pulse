"""DFII10/T10YIE from Treasury's yield curves, and the FRED -> Treasury fallback."""

import io
from datetime import date

import pytest

from src.backend import quotes, treasury_yields


@pytest.fixture(autouse=True)
def clear_caches():
    treasury_yields._cache.update(data={}, timestamp=0.0)
    quotes._fred_cache.update(data={}, timestamp=0.0, ids=())
    yield
    treasury_yields._cache.update(data={}, timestamp=0.0)
    quotes._fred_cache.update(data={}, timestamp=0.0, ids=())


REAL = {date(2026, 10, 19): 2.80, date(2026, 10, 20): 2.77}
NOMINAL = {date(2026, 10, 16): 5.09, date(2026, 10, 19): 5.15, date(2026, 10, 20): 5.10}


def fake_series(curve):
    return REAL if curve == treasury_yields.REAL_CURVE else NOMINAL


def test_parses_ten_year_column_of_either_spelling(monkeypatch):
    csv_text = 'Date,"5 Yr","10 Yr"\n10/20/2026,4.94,5.12\n10/19/2026,4.94,\n'
    monkeypatch.setattr(
        treasury_yields.urllib.request, "urlopen",
        lambda req, timeout: io.BytesIO(csv_text.encode()),
    )
    series = treasury_yields._ten_year_by_date(treasury_yields.NOMINAL_CURVE, 2026)
    assert series == {date(2026, 10, 20): 5.12}  # blank cell skipped


def test_breakeven_is_nominal_minus_real_on_shared_dates(monkeypatch):
    monkeypatch.setattr(treasury_yields, "_ten_year_series", fake_series)
    q = treasury_yields.fetch_quotes(["DFII10", "T10YIE", "US10Y"])
    assert set(q) == {"DFII10", "T10YIE"}
    assert q["DFII10"]["price"] == "2.77%"
    assert q["DFII10"]["change_abs"] == "-0.03"
    # 5.10-2.77 vs 5.15-2.80; 10/16 has no real print, so it's ignored.
    assert q["T10YIE"]["price"] == "2.33%"
    assert q["T10YIE"]["change_abs"] == "-0.02"
    assert q["T10YIE"]["formal_symbol"] == "FRED:T10YIE"
    assert q["T10YIE"]["delay"] == "EOD"


def test_failure_keeps_last_known_value(monkeypatch):
    monkeypatch.setattr(treasury_yields, "_ten_year_series", fake_series)
    first = treasury_yields.fetch_quotes(["DFII10"])
    treasury_yields._cache["timestamp"] = 0.0  # expire

    def boom(curve):
        raise TimeoutError

    monkeypatch.setattr(treasury_yields, "_ten_year_series", boom)
    assert treasury_yields.fetch_quotes(["DFII10"]) == first


def test_fred_maintenance_page_falls_back_to_treasury(monkeypatch):
    # FRED's maintenance page: HTTP 200, HTML, no series columns.
    html = b"<!doctype html><html><title>Site Maintenance</title></html>"
    monkeypatch.setattr(
        quotes.urllib.request, "urlopen", lambda url, timeout: io.BytesIO(html)
    )
    monkeypatch.setattr(treasury_yields, "_ten_year_series", fake_series)
    q = quotes._fetch_fred_quotes(["DFII10", "T10YIE"])
    assert q["DFII10"]["price"] == "2.77%"
    assert q["T10YIE"]["price"] == "2.33%"


def test_fred_csv_used_when_up(monkeypatch):
    csv_text = (
        "observation_date,DFII10,T10YIE\n"
        "2026-10-16,2.74,2.35\n2026-10-19,2.81,\n"
    )
    monkeypatch.setattr(
        quotes.urllib.request, "urlopen",
        lambda url, timeout: io.BytesIO(csv_text.encode()),
    )
    called = []
    monkeypatch.setattr(treasury_yields, "fetch_quotes", lambda s: called.append(s) or {})
    q = quotes._fetch_fred_quotes(["DFII10", "T10YIE"])
    assert q["DFII10"]["price"] == "2.81%"
    assert q["T10YIE"]["price"] == "2.35%"  # newest blank row skipped per series
    assert called == []
