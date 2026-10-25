"""A free stand-in for Goldman's most-shorted basket, for the Credit tab.

Goldman's index (Bloomberg ``GSCBMSAL``) has no free feed. The investment
project's nightly pipeline rebuilds the idea from FINRA short interest and SEC
shares outstanding (``build_most_shorted_basket.py``; method and identity rules
in its ``docs/credit-data.md``): each month, the 50 listed common stocks with
the highest short interest as a share of shares outstanding (market value ≥ $1B,
price ≥ $5), equal-weighted from 12 days after FINRA's settlement date, as a
daily total-return index from 100 starting January 2018. It tracks Goldman's
turning points, not its level.

This module only reads ``most_shorted_basket_daily`` and the latest basket in
``most_shorted_basket_members`` from the investment duckdb (read-only), cached
on the file's mtime.
"""

import threading
from pathlib import Path

import duckdb

INVESTMENT_DB = Path.home() / "projects/investment/data/stocks/stocks.duckdb"

_lock = threading.Lock()
_cache: tuple[float, dict] | None = None


def read_basket(con: duckdb.DuckDBPyConnection) -> dict:
    """``{"dates", "values", "settlement", "effective", "members"}``; members
    of the latest basket, most shorted first, with ``short_pct`` in percent."""
    rows = con.execute("SELECT date, value FROM most_shorted_basket_daily ORDER BY date").fetchall()
    latest = con.execute(
        """SELECT settlement_date, effective_date, ticker, short_pct FROM most_shorted_basket_members
           WHERE settlement_date = (SELECT max(settlement_date) FROM most_shorted_basket_members)
           ORDER BY rank"""
    ).fetchall()
    return {
        "dates": [d.strftime("%Y-%m-%d") for d, _ in rows],
        "values": [round(float(v), 3) for _, v in rows],
        "settlement": latest[0][0].strftime("%Y-%m-%d") if latest else None,
        "effective": latest[0][1].strftime("%Y-%m-%d") if latest else None,
        "members": [{"ticker": t, "short_pct": round(float(p) * 100, 1)} for _, _, t, p in latest],
    }


def get_most_shorted() -> dict:
    """The basket index and current members (see ``read_basket``)."""
    global _cache
    with _lock:
        mtime = INVESTMENT_DB.stat().st_mtime
        if _cache is None or _cache[0] != mtime:
            con = duckdb.connect(str(INVESTMENT_DB), read_only=True)
            try:
                _cache = (mtime, read_basket(con))
            finally:
                con.close()
        return _cache[1]
