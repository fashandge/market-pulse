"""Weekly OHLCV + technical indicators for charting.

Reads (read-only) from the ``investment`` project's duckdb, which already has
weekly bars joined 1:1 with precomputed indicators (SMA, MACD, RSI, OBV, ROC,
KDJ). We only read and serve -- no indicator math here.
"""

from pathlib import Path

import duckdb

INVESTMENT_DB = Path.home() / "projects/investment/data/stocks/stocks.duckdb"

# Columns served per weekly bar, in payload order.
_BAR_COLS = ["open", "high", "low", "close", "volume", "vol_avg_4"]
_IND_COLS = [
    "sma_5", "sma_10", "sma_40",
    "macd", "macd_signal", "macd_hist",
    "rsi_14", "obv", "roc_12",
    "kdj_k", "kdj_d", "kdj_j",
]

# Cached ticker universe (loaded lazily on first search).
_ticker_cache: list[dict] | None = None


def _connect() -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(INVESTMENT_DB), read_only=True)


def list_tickers() -> list[dict]:
    """All tickers that have weekly bars, with company name when known.

    Cached in a module global; the full universe (~19k symbols) is small enough
    to filter in Python so per-keystroke search never re-hits duckdb.
    """
    global _ticker_cache
    if _ticker_cache is None:
        con = _connect()
        try:
            rows = con.execute(
                """
                SELECT b.ticker, c.name
                FROM (SELECT DISTINCT ticker FROM weekly_bars_adjusted) b
                LEFT JOIN tickers_common_stocks c USING (ticker)
                ORDER BY b.ticker
                """
            ).fetchall()
        finally:
            con.close()
        _ticker_cache = [{"symbol": sym, "name": name} for sym, name in rows]
    return _ticker_cache


def search_tickers(q: str, limit: int = 20) -> list[dict]:
    """Symbol-prefix-then-substring search over the full duckdb universe."""
    q = (q or "").strip().upper()
    if not q:
        return []
    prefix, contains = [], []
    for t in list_tickers():
        sym = t["symbol"].upper()
        if sym.startswith(q):
            prefix.append(t)
        elif q in sym:
            contains.append(t)
        if len(prefix) >= limit:
            break
    return (prefix + contains)[:limit]


def get_weekly_chart(ticker: str) -> dict:
    """Full-history weekly OHLCV + indicators for one ticker.

    Returns ``{"ticker": ..., "data": [ {week_start, open, high, low, close,
    volume, vol_avg_4, sma_5, ...}, ... ]}`` sorted ascending by week. SQL NULLs
    (indicator warmup) come back as JSON ``null`` so the frontend can drop them
    per series.
    """
    con = _connect()
    try:
        rows = con.execute(
            """
            SELECT
                b.week_start,
                b.open_adjusted, b.high_adjusted, b.low_adjusted, b.close_adjusted,
                b.volume_split_adjusted,
                AVG(b.volume_split_adjusted) OVER (
                    ORDER BY b.week_start ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
                ) AS vol_avg_4,
                i.sma_5, i.sma_10, i.sma_40,
                i.macd, i.macd_signal, i.macd_hist,
                i.rsi_14, i.obv, i.roc_12,
                i.kdj_k, i.kdj_d, i.kdj_j
            FROM weekly_bars_adjusted b
            JOIN weekly_indicators i USING (ticker, week_start)
            WHERE b.ticker = ?
            ORDER BY b.week_start
            """,
            [ticker],
        ).fetchall()
    finally:
        con.close()

    keys = ["week_start"] + _BAR_COLS + _IND_COLS
    data = []
    for row in rows:
        rec = dict(zip(keys, row))
        rec["week_start"] = rec["week_start"].isoformat()
        data.append(rec)
    return {"ticker": ticker, "data": data}


if __name__ == "__main__":
    print("tickers:", len(list_tickers()))
    print("search 'app':", [t["symbol"] for t in search_tickers("app", 10)])
    chart = get_weekly_chart("NVDA")
    print("NVDA rows:", len(chart["data"]))
    if chart["data"]:
        print("last:", chart["data"][-1])
