"""Unit tests for the estimates payload (``/api/market/estimates``).

Self-contained: each test writes cache files into tmp_path and points
``estimates.ESTIMATES_DIR`` and the portfolio CSV at it.
"""

import json
from datetime import datetime, timedelta

import pytest

from src.backend import estimates, portfolio


def _write(folder, ticker, **extra):
    data = {
        "ticker": ticker,
        "fetched_at": "2026-10-01T19:00:00-07:00",
        "years": [{"fiscal_year": 2027, "reported": False, "eps": 1.0}],
        "ratings": [],
        **extra,
    }
    (folder / f"{ticker}.json").write_text(json.dumps(data))


@pytest.fixture
def cache(tmp_path, monkeypatch):
    folder = tmp_path / "estimates"
    folder.mkdir()
    csv_path = tmp_path / "portfolio.csv"
    csv_path.write_text("ticker,exchange,ticker_type\nMU,NASDAQ,stock\nAMD,NASDAQ,stock\n")
    monkeypatch.setattr(estimates, "ESTIMATES_DIR", folder)
    monkeypatch.setattr(portfolio, "PORTFOLIO_CSV", csv_path)
    return folder


def test_holdings_come_first_in_watchlist_order_then_the_rest_alphabetically(cache):
    for ticker in ("SNDK", "AMD", "CIEN", "MU"):
        _write(cache, ticker)

    payload = estimates.load_estimates()

    assert [t["ticker"] for t in payload["tickers"]] == ["MU", "AMD", "CIEN", "SNDK"]
    assert [t["in_portfolio"] for t in payload["tickers"]] == [True, True, False, False]
    assert payload["unreadable"] == []


def test_a_holding_without_a_cache_file_is_simply_absent(cache):
    _write(cache, "AMD")

    payload = estimates.load_estimates()

    assert [t["ticker"] for t in payload["tickers"]] == ["AMD"]


def test_the_cached_fields_pass_through_unchanged(cache):
    _write(cache, "MU", price=1097.39, target_gap_pct=45.5)

    ticker = estimates.load_estimates()["tickers"][0]

    assert ticker["price"] == 1097.39
    assert ticker["target_gap_pct"] == 45.5
    assert ticker["years"][0]["fiscal_year"] == 2027


def test_a_broken_file_is_reported_not_fatal(cache):
    _write(cache, "MU")
    (cache / "BAD.json").write_text("{not json")
    (cache / "OLD.json").write_text(json.dumps({"ticker": "OLD"}))   # predates the schema

    payload = estimates.load_estimates()

    assert [t["ticker"] for t in payload["tickers"]] == ["MU"]
    assert payload["unreadable"] == ["BAD.json", "OLD.json"]


def test_a_missing_folder_is_an_empty_tab(tmp_path, monkeypatch):
    monkeypatch.setattr(estimates, "ESTIMATES_DIR", tmp_path / "nowhere")

    assert estimates.load_estimates() == {"tickers": [], "unreadable": []}


# --- fetch on demand (POST /api/market/estimates/{ticker}) -------------------


@pytest.fixture
def fetcher(cache, monkeypatch):
    """Stand-in for stock_picker's fetch_ticker: records calls, writes the cache."""
    calls = []

    def fake_fetch(ticker, data_dir):
        calls.append(ticker)
        now = datetime.now().astimezone().isoformat(timespec="seconds")
        _write(data_dir, ticker, fetched_at=now, price=1.0)
        return json.loads((data_dir / f"{ticker}.json").read_text())

    monkeypatch.setattr(estimates.fetch_estimates, "fetch_ticker", fake_fetch)
    monkeypatch.setattr(
        estimates.charts, "list_tickers",
        lambda: [{"symbol": s, "name": None} for s in ("MU", "AMD", "SNDK", "QQQ")],
    )
    monkeypatch.setattr(estimates, "_fetch_times", [])
    return calls


def test_an_uncached_ticker_is_fetched_cached_and_returned(cache, fetcher):
    result = estimates.get_or_fetch("sndk")

    assert fetcher == ["SNDK"]
    assert result["ticker"] == "SNDK" and result["in_portfolio"] is False
    assert (cache / "SNDK.json").exists()
    assert "SNDK" in [t["ticker"] for t in estimates.load_estimates()["tickers"]]


def test_a_fresh_cache_is_returned_without_fetching(cache, fetcher):
    recent = (datetime.now().astimezone() - timedelta(minutes=10)).isoformat(timespec="seconds")
    _write(cache, "MU", fetched_at=recent, price=1097.39)

    result = estimates.get_or_fetch("MU")

    assert fetcher == []
    assert result["price"] == 1097.39 and result["in_portfolio"] is True


def test_a_cache_older_than_the_window_is_refetched(cache, fetcher):
    old = (datetime.now().astimezone() - timedelta(hours=2)).isoformat(timespec="seconds")
    _write(cache, "MU", fetched_at=old, price=1097.39)

    result = estimates.get_or_fetch("MU")

    assert fetcher == ["MU"]
    assert result["price"] == 1.0


def test_a_symbol_outside_the_universe_never_reaches_the_fetcher(cache, fetcher):
    for symbol in ("ZZZZ", "../../etc/passwd", ""):
        with pytest.raises(estimates.UnknownTicker):
            estimates.get_or_fetch(symbol)

    assert fetcher == []


def test_the_hourly_fetch_budget_is_enforced(cache, fetcher, monkeypatch):
    monkeypatch.setattr(estimates, "MAX_FETCHES_PER_HOUR", 2)
    estimates.get_or_fetch("AMD")
    estimates.get_or_fetch("SNDK")

    with pytest.raises(estimates.RateLimited):
        estimates.get_or_fetch("QQQ")

    assert fetcher == ["AMD", "SNDK"]
    assert estimates.get_or_fetch("AMD")["ticker"] == "AMD"     # cached answers stay free


def test_a_source_failure_surfaces_as_fetch_failed_and_keeps_the_old_cache(cache, fetcher, monkeypatch):
    old = (datetime.now().astimezone() - timedelta(days=3)).isoformat(timespec="seconds")
    _write(cache, "QQQ", fetched_at=old, price=5.0)

    def refuse(ticker, data_dir):
        raise estimates.fetch_estimates.EstimatesError("Seeking Alpha has no forward EPS consensus")

    monkeypatch.setattr(estimates.fetch_estimates, "fetch_ticker", refuse)

    with pytest.raises(estimates.FetchFailed, match="no forward EPS"):
        estimates.get_or_fetch("QQQ")

    assert json.loads((cache / "QQQ.json").read_text())["price"] == 5.0


# --- live prices (GET /api/market/estimates/prices) --------------------------


def test_live_prices_look_up_every_cached_ticker_and_leave_the_cache_alone(cache, monkeypatch):
    for ticker in ("MU", "AMD"):
        _write(cache, ticker, price=1.0)
    (cache / "BAD.json").write_text("{not json")
    asked = []

    def fake_prices(symbols):
        asked.append(symbols)
        return {"MU": {"price": 2.0, "delay": "", "formal_symbol": "NASDAQ:MU"}}

    monkeypatch.setattr(estimates.quotes, "fetch_us_prices", fake_prices)

    result = estimates.live_prices()

    assert asked == [["AMD", "MU"]]
    assert result == {"prices": {"MU": {"price": 2.0, "delay": "", "formal_symbol": "NASDAQ:MU"}}, "error": None}
    assert json.loads((cache / "MU.json").read_text())["price"] == 1.0


def test_a_scanner_failure_is_reported_not_fatal(cache, monkeypatch):
    _write(cache, "MU")

    def boom(symbols):
        raise OSError("timed out")

    monkeypatch.setattr(estimates.quotes, "fetch_us_prices", boom)

    result = estimates.live_prices()

    assert result["prices"] == {} and "timed out" in result["error"]
