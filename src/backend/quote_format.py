"""Shared formatting for the quote dicts the overview consumes.

``quotes.py`` (TradingView scanner + FRED) and ``vol_indices.py`` (CBOE +
Deribit) all emit the same shape, which ``market_overview.build_overview``
reads: string ``price`` / ``change_pct`` / ``change_abs`` / ``volume`` /
``avg_volume`` for display, plus a numeric ``change_pct_float`` for the group
averages and a ``formal_symbol`` for the TradingView chart link.

Keeping the formatters here means the three producers can't drift apart on
decimals, sign, or volume suffixes.
"""

from __future__ import annotations

# Treasury-yield and real-yield symbols display their price with a trailing "%".
YIELD_SYMBOLS = {"US10Y", "US20Y", "US30Y", "DFII10", "T10YIE"}


def num_str(x: float) -> str:
    """Compact numeric string (up to 4 decimals, trailing zeros stripped)."""
    s = f"{x:.4f}".rstrip("0").rstrip(".")
    return s or "0"


def formal_symbol(ticker: str, exchange: str) -> str:
    return f"{exchange}:{ticker}"


def fmt_price(close: float | None, is_yield: bool = False) -> str:
    if close is None:
        return "—"
    s = num_str(close)
    return f"{s}%" if is_yield else s


def fmt_pct(change: float | None) -> str:
    if change is None:
        return ""
    return f"{change:+.2f}%"


def fmt_change_abs(change_abs: float | None) -> str:
    if change_abs is None:
        return ""
    if abs(change_abs) >= 1000:
        return f"{change_abs:+,.0f}"
    return f"{change_abs:+.2f}"


def fmt_volume(v: float | None) -> str:
    if not v or v <= 0:
        return ""
    for suffix, mult in (("T", 1e12), ("B", 1e9), ("M", 1e6), ("K", 1e3)):
        if v >= mult:
            return f"{v / mult:.2f}{suffix}"
    return f"{v:.0f}"


def delay_label(update_mode: str | None) -> str:
    """Display label for TradingView's ``update_mode``: "" when the quote is
    real-time, else how far behind it is.

    Real-time vs delayed is an exchange data entitlement on the TradingView
    account — the same for the scanner REST API, the quote websocket and the
    website — so this is reported, never worked around. See
    ``src/backend/scripts/check_quote_delay.py``.
    """
    if not update_mode or update_mode == "streaming":
        return ""
    if update_mode == "endofday":
        return "EOD"
    if update_mode.startswith("delayed_streaming_"):
        seconds = update_mode.rsplit("_", 1)[-1]
        if seconds.isdigit():
            return f"{int(seconds) // 60}m"
    return "delayed"


def build_quote(
    symbol: str,
    exchange: str,
    close: float | None,
    change: float | None = None,
    change_abs: float | None = None,
    volume: float | None = None,
    avg_volume: float | None = None,
    delay: str = "",
) -> dict:
    """One overview-shaped quote dict. ``change`` is a percentage; ``delay`` is
    a ``delay_label`` result ("" when the quote is real-time)."""
    return {
        "delay": delay,
        "price": fmt_price(close, symbol in YIELD_SYMBOLS),
        "change_pct": fmt_pct(change),
        "change_pct_float": round(change, 2) if change is not None else None,
        "change_abs": fmt_change_abs(change_abs),
        "volume": fmt_volume(volume),
        "avg_volume": fmt_volume(avg_volume),
        "formal_symbol": formal_symbol(symbol, exchange),
    }


def pct_change(close: float | None, prev_close: float | None) -> tuple[float | None, float | None]:
    """``(change_abs, change_pct)`` from a level and its previous close."""
    if close is None or not prev_close:
        return None, None
    change_abs = close - prev_close
    return change_abs, change_abs / prev_close * 100
