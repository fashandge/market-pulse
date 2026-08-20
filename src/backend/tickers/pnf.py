"""Point & Figure chart data for one ticker.

Thin wrapper over the ``investment`` project's P&F library
(``investment.src.charts.pnf``: high/low method, one-step-back rule for 1-box
charts). Bars come from the investment duckdb (split-adjusted OHLC) with a
Yahoo Finance fallback for symbols the DB lacks; the frontend draws the boxes
with Plotly, so this module only serves data, no rendering.
"""

from datetime import date

from investment.src.charts import pnf as pnf_lib

DEFAULT_BOX_PCT = 0.03
MAX_CALENDAR_DAYS = 365 * 25


def get_pnf_chart(
    ticker: str,
    since: str = "365",
    box: float | None = None,
    box_pct: float | None = None,
    reversal: int = 3,
    end: str | None = None,
) -> dict:
    """Compute the P&F columns/boxes for ``ticker``.

    since:    ISO date, or an integer N = past N calendar days.
    box:      absolute box size; when None, ``box_pct`` (default 3%) of the last
              close, rounded to 1/2/2.5/5 x 10^k.
    reversal: boxes needed to open a new column (3 = modern, 1 = Wyckoff; the
              1-box chart applies the one-step-back rule).
    Returns ``{ticker, source, box_size, reversal, first_date, last_date,
    last_close, n_columns, columns: [...], boxes: [...]}``; ``boxes`` is one
    row per filled box ``{column, level, kind, start, end}``.
    Raises ValueError on bad arguments or when the symbol has no data.
    """
    if reversal not in (1, 2, 3, 4, 5):
        raise ValueError("reversal must be between 1 and 5")
    if box is not None and box <= 0:
        raise ValueError("box must be positive")
    if box_pct is not None and not (0 < box_pct < 1):
        raise ValueError("box_pct must be a fraction between 0 and 1")
    start = pnf_lib.resolve_start(since)
    if (date.today() - start).days > MAX_CALENDAR_DAYS:
        raise ValueError(f"since too far back (max {MAX_CALENDAR_DAYS} days)")
    end_date = date.fromisoformat(end) if end else None

    bars = pnf_lib.load_bars(ticker.upper(), start, end_date, source="auto")
    box_size = box if box is not None else pnf_lib.pick_box_size(
        bars, pct=box_pct if box_pct is not None else DEFAULT_BOX_PCT
    )
    chart = pnf_lib.compute_pnf(bars, box_size=box_size, reversal=reversal, ticker=ticker.upper())

    cols = chart.to_frame()
    boxes = chart.boxes()
    for frame in (cols, boxes):
        frame["start"] = frame["start"].dt.strftime("%Y-%m-%d")
        frame["end"] = frame["end"].dt.strftime("%Y-%m-%d")
    cols["lead"] = cols["lead"].astype(object).where(cols["lead"].notna(), None)
    return {
        "ticker": chart.ticker,
        "source": chart.source,
        "box_size": chart.box_size,
        "reversal": chart.reversal,
        "first_date": chart.first_date.date().isoformat(),
        "last_date": chart.last_date.date().isoformat(),
        "last_close": chart.last_close,
        "n_columns": len(chart.columns),
        "columns": cols.to_dict(orient="records"),
        "boxes": boxes.to_dict(orient="records"),
    }
