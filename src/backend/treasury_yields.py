"""DFII10 / T10YIE from the U.S. Treasury's daily par yield curves.

FRED's two series are both built from Treasury's own daily curves:

* ``DFII10`` — the 10-year point of the *real* (TIPS) par yield curve.
* ``T10YIE`` — FRED defines it as the 10-year nominal constant-maturity yield
  minus ``DFII10``, i.e. the nominal curve's 10-year point minus the real one.

``quotes._fetch_fred_quotes`` uses this as the fallback when fredgraph.csv
fails — FRED periodically takes the whole site down for maintenance and serves
an HTML page with HTTP 200 instead of the CSV. Treasury publishes the same day
(FRED lags 1-2 business days), so the numbers can be one print newer than
FRED's.

Each curve is one keyless CSV per calendar year, newest row first. Failures
return the last cached data, or {}, so the rest of the overview still loads.
"""

from __future__ import annotations

import csv
import io
import time
import urllib.request
from datetime import date, datetime

from src.backend import quote_format
from src.backend.quote_format import build_quote

CURVE_CSV_URL = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
    "daily-treasury-rates.csv/{year}/all?type={curve}&field_tdr_date_value={year}"
    "&page&_format=csv"
)
NOMINAL_CURVE = "daily_treasury_yield_curve"
REAL_CURVE = "daily_treasury_real_yield_curve"
# Treasury's CDN stalls some clients until the read times out (Python's default
# urllib agent, curl's); a browser User-Agent is answered at once.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
SYMBOLS = ("DFII10", "T10YIE")
CACHE_TTL = 900  # seconds; the curves update once per business day

_cache: dict = {"data": {}, "timestamp": 0.0}


def _ten_year_by_date(curve: str, year: int) -> dict[date, float]:
    """The curve's 10-year yield per date for one calendar year."""
    url = CURVE_CSV_URL.format(year=year, curve=curve)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:
        rows = list(csv.DictReader(io.TextIOWrapper(resp, encoding="utf-8")))
    out: dict[date, float] = {}
    for row in rows:
        # The nominal curve spells the column "10 Yr", the real one "10 YR".
        value = next((v for k, v in row.items() if k and k.upper() == "10 YR"), "")
        if value:
            out[datetime.strptime(row["Date"], "%m/%d/%Y").date()] = float(value)
    return out


def _ten_year_series(curve: str) -> dict[date, float]:
    """This year's 10-year yields, plus last year's when this year has fewer
    than two prints (early January), so a daily change is always computable."""
    year = date.today().year
    series = _ten_year_by_date(curve, year)
    if len(series) < 2:
        series.update(_ten_year_by_date(curve, year - 1))
    return series


def _quote(symbol: str, series: dict[date, float]) -> dict | None:
    dates = sorted(series)
    if not dates:
        return None
    close = series[dates[-1]]
    prev = series[dates[-2]] if len(dates) >= 2 else None
    change_abs, change = quote_format.pct_change(close, prev)
    # Same exchange as the FRED path, so the tile and its chart link don't change.
    return build_quote(symbol, "FRED", close, change=change, change_abs=change_abs, delay="EOD")


def fetch_quotes(symbols: list[str]) -> dict[str, dict]:
    """Quotes for the requested ``SYMBOLS`` members, keyed by symbol."""
    wanted = [s for s in symbols if s in SYMBOLS]
    if not wanted:
        return {}
    now = time.time()
    if now - _cache["timestamp"] < CACHE_TTL:
        return {s: _cache["data"][s] for s in wanted if s in _cache["data"]}

    try:
        real = _ten_year_series(REAL_CURVE)
        nominal = _ten_year_series(NOMINAL_CURVE)
    except Exception:
        return {s: _cache["data"][s] for s in wanted if s in _cache["data"]}

    # Breakeven only on dates both curves printed; round off float noise.
    breakeven = {d: round(nominal[d] - real[d], 2) for d in real.keys() & nominal.keys()}
    data = {
        symbol: quote
        for symbol, series in (("DFII10", real), ("T10YIE", breakeven))
        if (quote := _quote(symbol, series)) is not None
    }
    _cache.update(data=data, timestamp=now)
    return {s: data[s] for s in wanted if s in data}
