"""Portfolio holdings, read from stock_picker's ``data/portfolio.csv``.

The holdings list is *not* hardcoded here. TradingView's ``portfolio``
watchlist is the source of truth; the ``tv_watchlist.py`` CLI mirrors every
watchlist change into ``~/projects/stock_picker/data/portfolio.csv`` —
holdings only (benchmarks/ETFs dropped by instrument type), in watchlist
order — so this module is a plain per-request CSV reader: no Chrome launch,
no cache, no TTL, no background refresh.

Edit the watchlist through ``tv_watchlist.py`` (or the ``manage-watchlist``
skill) and the dashboard picks the change up on the next request. A manual
edit on the TradingView website goes stale until the next script-driven
change or ``tv_watchlist.py --sync-portfolio-csv``.

A missing/unreadable CSV yields an empty list, which omits the Portfolio
section (``market_overview.build_overview``) rather than falling back to a
guess.
"""

from __future__ import annotations

import csv
from pathlib import Path

PORTFOLIO_CSV = Path.home() / "projects/stock_picker/data/portfolio.csv"


def load_holdings(force: bool = False) -> list[tuple[str, str]]:
    """Portfolio holdings as ordered ``(ticker, exchange)`` pairs, straight
    from the CSV. ``force`` is kept for interface compatibility (no-op)."""
    try:
        with open(PORTFOLIO_CSV) as f:
            return [(row["ticker"], row["exchange"]) for row in csv.DictReader(f)]
    except (OSError, KeyError):
        return []


def load_symbols(force: bool = False) -> list[str]:
    """Portfolio holdings as bare symbols, in watchlist order."""
    return [symbol for symbol, _ in load_holdings(force)]
