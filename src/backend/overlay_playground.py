"""Smoothing playground pages for the Credit tab's short-index charts.

One HTML template (``overlay_playground.html``) serves every page: a short
index drawn against QQQ, SPY, SMH and SOXX, all rebased to 100, with series
toggles, SMA/EMA smoothing with a chosen N, 3M–Max ranges or a custom start,
log scale, an optional index ÷ QQQ pane and a copyable prompt. Each caller
(``most_shorted``, ``cbb_charts``) supplies the page text and the index lines;
this module adds the ETF lines, inlines everything into the page, and caches
the result on whatever file mtimes the data comes from.
"""

import json
import threading
from pathlib import Path

import duckdb

TEMPLATE = Path(__file__).with_name("overlay_playground.html")
ETFS = ("QQQ", "SPY", "SMH", "SOXX")
# Only the short index is red, so no other line gets a red-adjacent hue. The
# Credit tab's charts use the same colors (CreditCharts.tsx SHORT_INDEX_COLORS).
INDEX_COLOR = "#dc322f"
COLORS = {"QQQ": "#268bd2", "SPY": "#859900", "SMH": "#2aa198", "SOXX": "#6c71c4", "Basket": "#586e75"}
DEFAULT_VISIBLE = ("QQQ",)

_lock = threading.Lock()
_cache: dict[str, tuple[tuple, str]] = {}


def closes_on(con: duckdb.DuckDBPyConnection, dates: list[str], column: str) -> dict[str, list[float | None]]:
    """Each of ``ETFS``' ``column`` from ``daily_bars_adjusted`` on ``dates``
    (``YYYY-MM-DD``), None where an ETF has no bar that day."""
    if not dates:
        return {t: [] for t in ETFS}
    rows = con.execute(
        f"SELECT ticker, strftime(date, '%Y-%m-%d'), {column} FROM daily_bars_adjusted "
        f"WHERE ticker IN {ETFS} AND date::DATE BETWEEN ?::DATE AND ?::DATE",
        [dates[0], dates[-1]],
    ).fetchall()
    by_day = {(t, d): v for t, d, v in rows}
    return {t: [None if by_day.get((t, d)) is None else round(float(by_day[(t, d)]), 4) for d in dates] for t in ETFS}


def line(key: str, label: str, values: list[float | None], color: str, visible: bool, width: float = 2) -> dict:
    return {"key": key, "label": label, "values": values, "color": color, "visible": visible, "width": width}


def etf_lines(closes: dict[str, list[float | None]]) -> list[dict]:
    """The ETF lines in ``ETFS`` order, QQQ alone shown by default."""
    return [line(t, t, closes[t], COLORS[t], t in DEFAULT_VISIBLE) for t in ETFS]


def render(page: dict) -> str:
    """The template with ``page`` inlined: ``title``, ``heading``, ``intro``,
    ``note``, ``subject``, ``sources``, ``default_range``, ``dates`` and
    ``lines`` (from ``line``; the short index first)."""
    return TEMPLATE.read_text().replace("__CONFIG__", json.dumps(page, separators=(",", ":"), ensure_ascii=False))


def cached(name: str, mtimes: tuple, build) -> str:
    """``build()``'s page, rebuilt when ``mtimes`` (of the data files) or the
    template's mtime change, so an edited template shows without a restart."""
    key = (*mtimes, TEMPLATE.stat().st_mtime)
    with _lock:
        if name not in _cache or _cache[name][0] != key:
            _cache[name] = (key, build())
        return _cache[name][1]
