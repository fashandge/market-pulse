"""Weekly + monthly + daily OHLCV + technical indicators for charting.

Reads (read-only) from the ``investment`` project's duckdb. We only read and
serve -- no indicator math here.

- Weekly: ``weekly_bars_adjusted`` joined 1:1 with ``weekly_indicators``
  (SMA 5/10/40, MACD, RSI, OBV, ROC 12, KDJ).
- Monthly: ``monthly_bars_adjusted`` joined 1:1 with ``monthly_indicators``
  (SMA 3/12, EMA 21, MACD, RSI, OBV, ROC 3, KDJ). The 3-month volume average
  is computed in SQL.
- Daily: ``daily_bars_adjusted`` (OHLCV) joined with ``classifier_features``
  (EMA 8/13/21/50, SMA 100/150/200, VWMA 50, MACD, RSI, OBV, KDJ, CCI). The
  10-day volume average is computed in SQL.
"""

from pathlib import Path

import duckdb

INVESTMENT_DB = Path.home() / "projects/investment/data/stocks/stocks.duckdb"

# Columns served per weekly bar, in payload order.
_WEEKLY_BAR_COLS = ["open", "high", "low", "close", "volume", "vol_avg_4"]
_WEEKLY_IND_COLS = [
    "sma_5", "sma_10", "sma_40",
    "macd", "macd_signal", "macd_hist",
    "rsi_14", "obv", "roc_12",
    "kdj_k", "kdj_d", "kdj_j",
]

# Columns served per monthly bar, in payload order.
_MONTHLY_BAR_COLS = ["open", "high", "low", "close", "volume", "vol_avg_3"]
_MONTHLY_IND_COLS = [
    "sma_3", "sma_12", "ema_21",
    "macd", "macd_signal", "macd_hist",
    "rsi_14", "obv", "roc_3",
    "kdj_k", "kdj_d", "kdj_j",
]

# Columns served per daily bar, in payload order.
_DAILY_BAR_COLS = ["open", "high", "low", "close", "volume", "vol_avg_10"]
_DAILY_IND_COLS = [
    "ema_8", "ema_13", "ema_21", "ema_50",
    "sma_100", "sma_150", "sma_200",
    "vwma_50",
    "macd", "macd_signal", "macd_hist",
    "rsi_14", "obv",
    "kdj_k", "kdj_d", "kdj_j",
    "cci_20",
]

# Daily indicators the investment project computes but that an older
# ``classifier_features`` snapshot may not have yet (the nightly DB pull adds
# them). Served as NULL until the column shows up, so the endpoint keeps
# working and the series appears on its own once the column lands.
_DAILY_OPTIONAL_IND_COLS = {"vwma_50"}

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

    keys = ["week_start"] + _WEEKLY_BAR_COLS + _WEEKLY_IND_COLS
    data = []
    for row in rows:
        rec = dict(zip(keys, row))
        rec["week_start"] = rec["week_start"].isoformat()
        data.append(rec)
    return {"ticker": ticker, "data": data}


def get_monthly_chart(ticker: str) -> dict:
    """Full-history monthly OHLCV + indicators for one ticker.

    Returns ``{"ticker": ..., "data": [ {month_start, open, high, low, close,
    volume, vol_avg_3, sma_3, ...}, ... ]}`` sorted ascending by month. SQL
    NULLs (indicator warmup) come back as JSON ``null`` so the frontend can
    drop them per series.
    """
    con = _connect()
    try:
        rows = con.execute(
            """
            SELECT
                b.month_start,
                b.open_adjusted, b.high_adjusted, b.low_adjusted, b.close_adjusted,
                b.volume_split_adjusted,
                AVG(b.volume_split_adjusted) OVER (
                    ORDER BY b.month_start ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
                ) AS vol_avg_3,
                i.sma_3, i.sma_12, i.ema_21,
                i.macd, i.macd_signal, i.macd_hist,
                i.rsi_14, i.obv, i.roc_3,
                i.kdj_k, i.kdj_d, i.kdj_j
            FROM monthly_bars_adjusted b
            JOIN monthly_indicators i USING (ticker, month_start)
            WHERE b.ticker = ?
            ORDER BY b.month_start
            """,
            [ticker],
        ).fetchall()
    finally:
        con.close()

    keys = ["month_start"] + _MONTHLY_BAR_COLS + _MONTHLY_IND_COLS
    data = []
    for row in rows:
        rec = dict(zip(keys, row))
        rec["month_start"] = rec["month_start"].isoformat()
        data.append(rec)
    return {"ticker": ticker, "data": data}


def _daily_ind_select(con: duckdb.DuckDBPyConnection) -> str:
    """SELECT fragment for the daily indicator columns.

    Optional columns (``_DAILY_OPTIONAL_IND_COLS``) that ``classifier_features``
    does not have yet become ``NULL AS <col>``, so the payload shape stays the
    same and the frontend simply drops an all-NULL series.
    """
    present = {
        r[0]
        for r in con.execute(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'classifier_features'
            """
        ).fetchall()
    }
    return ",\n                ".join(
        f"NULL AS {c}" if c in _DAILY_OPTIONAL_IND_COLS and c not in present else f"f.{c}"
        for c in _DAILY_IND_COLS
    )


def get_daily_chart(ticker: str) -> dict:
    """Full-history daily OHLCV + indicators for one ticker.

    OHLCV comes from ``daily_bars_adjusted``; indicators from
    ``classifier_features`` (joined on ticker+date). The 10-day volume average
    is computed in SQL. Returns ``{"ticker": ..., "data": [ {date, open, high,
    low, close, volume, vol_avg_10, ema_8, ...}, ... ]}`` sorted ascending by
    date. SQL NULLs (indicator warmup, or an optional column the DB snapshot
    does not carry yet) come back as JSON ``null``.
    """
    con = _connect()
    try:
        rows = con.execute(
            f"""
            SELECT
                d.date,
                d.open_adjusted, d.high_adjusted, d.low_adjusted, d.close_adjusted,
                d.volume_split_adjusted,
                AVG(d.volume_split_adjusted) OVER (
                    ORDER BY d.date ROWS BETWEEN 9 PRECEDING AND CURRENT ROW
                ) AS vol_avg_10,
                {_daily_ind_select(con)}
            FROM daily_bars_adjusted d
            JOIN classifier_features f USING (ticker, date)
            WHERE d.ticker = ?
            ORDER BY d.date
            """,
            [ticker],
        ).fetchall()
    finally:
        con.close()

    keys = ["date"] + _DAILY_BAR_COLS + _DAILY_IND_COLS
    data = []
    for row in rows:
        rec = dict(zip(keys, row))
        # daily_bars_adjusted.date is a TIMESTAMP; serve the date part only.
        rec["date"] = rec["date"].date().isoformat()
        data.append(rec)
    return {"ticker": ticker, "data": data}


if __name__ == "__main__":
    print("tickers:", len(list_tickers()))
    print("search 'app':", [t["symbol"] for t in search_tickers("app", 10)])
    wk = get_weekly_chart("NVDA")
    print("NVDA weekly rows:", len(wk["data"]))
    if wk["data"]:
        print("last weekly:", wk["data"][-1])
    mo = get_monthly_chart("NVDA")
    print("NVDA monthly rows:", len(mo["data"]))
    if mo["data"]:
        print("last monthly:", mo["data"][-1])
    dy = get_daily_chart("NVDA")
    print("NVDA daily rows:", len(dy["data"]))
    if dy["data"]:
        print("last daily:", dy["data"][-1])
