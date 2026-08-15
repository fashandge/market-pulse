"""Unit tests for the daily chart's optional-indicator-column handling.

The investment project's ``classifier_features`` gains columns over time (the
nightly DB pull brings them in). The daily endpoint must keep working against a
snapshot that does not have an optional column yet, serving it as ``None``.

DB-backed but self-contained: each test builds a tiny duckdb file in tmp_path
and points ``charts.INVESTMENT_DB`` at it.
"""

import datetime as dt

import duckdb
import pytest

from src.backend.tickers import charts

_ALL_IND_COLS = charts._DAILY_IND_COLS


def _make_db(path, ind_cols):
    """Two-bar duckdb with ``classifier_features`` carrying only ``ind_cols``."""
    con = duckdb.connect(str(path))
    try:
        con.execute(
            """
            CREATE TABLE daily_bars_adjusted (
                ticker VARCHAR, date TIMESTAMP,
                open_adjusted DOUBLE, high_adjusted DOUBLE,
                low_adjusted DOUBLE, close_adjusted DOUBLE,
                volume_split_adjusted DOUBLE
            )
            """
        )
        cols = ", ".join(f"{c} DOUBLE" for c in ind_cols)
        con.execute(
            f"CREATE TABLE classifier_features (ticker VARCHAR, date TIMESTAMP, {cols})"
        )
        for i, day in enumerate((dt.datetime(2026, 8, 12), dt.datetime(2026, 8, 13))):
            con.execute(
                "INSERT INTO daily_bars_adjusted VALUES (?, ?, ?, ?, ?, ?, ?)",
                ["NVDA", day, 10.0 + i, 12.0 + i, 9.0 + i, 11.0 + i, 1000.0 + i],
            )
            con.execute(
                "INSERT INTO classifier_features VALUES (?, ?"
                + ", ?" * len(ind_cols)
                + ")",
                ["NVDA", day] + [float(i + 1)] * len(ind_cols),
            )
    finally:
        con.close()


@pytest.fixture
def db_factory(tmp_path, monkeypatch):
    def build(ind_cols):
        path = tmp_path / "stocks.duckdb"
        _make_db(path, ind_cols)
        monkeypatch.setattr(charts, "INVESTMENT_DB", path)
        return path

    return build


def test_missing_optional_column_served_as_null(db_factory):
    """vwma_50 absent from classifier_features: endpoint works, series is NULL."""
    db_factory([c for c in _ALL_IND_COLS if c != "vwma_50"])

    out = charts.get_daily_chart("NVDA")

    assert [r["date"] for r in out["data"]] == ["2026-08-12", "2026-08-13"]
    assert all("vwma_50" in r for r in out["data"])
    assert all(r["vwma_50"] is None for r in out["data"])
    # The other indicators are unaffected.
    assert [r["ema_8"] for r in out["data"]] == [1.0, 2.0]


def test_present_optional_column_served_from_db(db_factory):
    """Once vwma_50 lands in the DB, its values flow through unchanged."""
    db_factory(_ALL_IND_COLS)

    out = charts.get_daily_chart("NVDA")

    assert [r["vwma_50"] for r in out["data"]] == [1.0, 2.0]


def test_missing_required_column_still_raises(db_factory):
    """Only the optional columns are papered over -- a real schema break errors."""
    db_factory([c for c in _ALL_IND_COLS if c != "ema_8"])

    with pytest.raises(duckdb.Error):
        charts.get_daily_chart("NVDA")
