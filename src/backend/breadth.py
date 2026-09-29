"""Market breadth history alongside SPY and QQQ, for the Overview "Breadth" tab.

Reads (read-only) from the ``investment`` project's duckdb:

- ``market_breadth_daily``: point-in-time S&P 500 (``spx_*``) and Nasdaq-100
  (``ndx_*``) breadth -- % of members above their 20/50/200-day SMA, 52-week
  new highs/lows, and daily advancers minus decliners.
- ``daily_bars_adjusted``: SPY and QQQ adjusted closes.
- ``index_distribution_days``: SPY/QQQ rolling 5-week distribution-day counts.

The payload is columnar (one ``dates`` array plus one array per series) over
the full history, so the frontend can slice any range without refetching. The
nightly DB pull replaces the file, so the payload is cached on the file's mtime.
"""

from pathlib import Path

import duckdb

INVESTMENT_DB = Path.home() / "projects/investment/data/stocks/stocks.duckdb"

# Payload key -> SQL expression, in payload order. S&P 500 / SPY keys start
# with "s", Nasdaq-100 / QQQ keys with "n" (prices keep their ticker names).
_SERIES = {
    "spy": "px.spy",
    "qqq": "px.qqq",
    "s20": "b.spx_pct_above_sma_20",
    "n20": "b.ndx_pct_above_sma_20",
    "s50": "b.spx_pct_above_sma_50",
    "n50": "b.ndx_pct_above_sma_50",
    "s200": "b.spx_pct_above_sma_200",
    "n200": "b.ndx_pct_above_sma_200",
    "snh": "b.spx_new_high_252_pct - b.spx_new_low_252_pct",
    "nnh": "b.ndx_new_high_252_pct - b.ndx_new_low_252_pct",
    "sad": "b.spx_adv_minus_decl_pct",
    "nad": "b.ndx_adv_minus_decl_pct",
    "sdd": "d.spy_distribution_days_5wk",
    "ndd": "d.qqq_distribution_days_5wk",
}

# Prices to the cent, counts as integers, fractions to 4 places: keeps the
# ~5k-row payload near half a megabyte without visible loss.
_DIGITS = {"spy": 2, "qqq": 2, "sdd": 0, "ndd": 0}

_cache: tuple[float, dict] | None = None


def _round(key: str, v):
    if v is None:
        return None
    digits = _DIGITS.get(key, 4)
    return int(v) if digits == 0 else round(float(v), digits)


def get_breadth() -> dict:
    """Full-history breadth + SPY/QQQ closes as ``{"as_of", "dates", "series"}``.

    Rows are the breadth table's trading days that also have both ETF closes.
    SQL NULLs (moving-average / 52-week warmup) come back as ``None``.
    """
    global _cache
    mtime = INVESTMENT_DB.stat().st_mtime
    if _cache is not None and _cache[0] == mtime:
        return _cache[1]

    exprs = ", ".join(f"{sql} AS {key}" for key, sql in _SERIES.items())
    con = duckdb.connect(str(INVESTMENT_DB), read_only=True)
    try:
        rows = con.execute(
            f"""
            WITH px AS (
                SELECT date,
                    MAX(CASE WHEN ticker = 'SPY' THEN close_adjusted END) AS spy,
                    MAX(CASE WHEN ticker = 'QQQ' THEN close_adjusted END) AS qqq
                FROM daily_bars_adjusted
                WHERE ticker IN ('SPY', 'QQQ')
                GROUP BY date
            )
            SELECT b.date, {exprs}
            FROM market_breadth_daily b
            JOIN px USING (date)
            LEFT JOIN index_distribution_days d USING (date)
            WHERE px.spy IS NOT NULL AND px.qqq IS NOT NULL
            ORDER BY b.date
            """
        ).fetchall()
    finally:
        con.close()

    keys = list(_SERIES)
    dates = [r[0].strftime("%Y-%m-%d") for r in rows]
    series = {k: [_round(k, r[i + 1]) for r in rows] for i, k in enumerate(keys)}
    payload = {"as_of": dates[-1] if dates else None, "dates": dates, "series": series}
    _cache = (mtime, payload)
    return payload
