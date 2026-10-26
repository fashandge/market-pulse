"""Credit-stress history for the Overview "Credit" tab.

Three blocks, all columnar (one ``dates`` array plus one array per series) so
the frontend can slice any range without refetching. Everything is read-only
from the investment duckdb, whose nightly pipeline fetches and stores it
(see the investment project's ``docs/credit-data.md``):

- ``fred``: ICE BofA option-adjusted spreads (investment grade, BBB, high
  yield, CCC) in basis points, the St. Louis and Chicago Fed stress indexes
  (weekly), and SOFR minus IORB (repo funding pressure) in basis points, from
  ``credit_series_daily``. FRED serves only a rolling three years of the ICE
  series; the table keeps the longer history it has accumulated.
- ``prices``: adjusted closes for the credit ETFs, the crowded-out lenders,
  the AI borrowers and the semis/software ETFs, plus VIX and Treasury yields.
  HYG/IEI and LQD/IEF ratios are added here: credit ETFs against
  same-maturity Treasuries, which strips most of the interest-rate move and
  leaves the credit part. BKLN (leveraged loans) is the split-adjusted price,
  not total return: its ~8% payout would otherwise hide the price drops that
  signal loan stress.
- ``tv``: France, Italy and Spain 10-year government yields minus the German
  Bund's in basis points (sovereign stress), and the MOVE index (Treasury
  implied volatility), from ``credit_series_daily``'s TradingView series.
- ``cds``: 5-year credit-default-swap spreads in basis points for the AI
  borrowers and chipmakers (Oracle, SpaceX, hyperscalers, Nvidia, Broadcom,
  AMD), from ``cds_spreads_daily``, which the investment pipeline infers from
  DTCC's public trade reports. A name is null on days it did not trade. None
  when the table is absent (a DB pulled before the stage existed).

The payload is cached on the duckdb file's mtime (the nightly pull replaces it).
"""

import threading
from pathlib import Path

import duckdb

INVESTMENT_DB = Path.home() / "projects/investment/data/stocks/stocks.duckdb"
FRED_START = "2007-01-01"
PRICE_START = "2017-12-01"  # covers the most-shorted basket, which starts Jan 2018
TV_START = "2015-01-01"

# credit_series_daily series_key -> payload key, per block.
FRED_KEYS = {
    "oas_ig": "ig",
    "oas_bbb": "bbb",
    "oas_hy": "hy",
    "oas_ccc": "ccc",
    "stlfsi4": "stlfsi",
    "nfci": "nfci",
    "sofr": "sofr",
    "iorb": "iorb",
}
SPREAD_KEYS = ("ig", "bbb", "hy", "ccc")  # stored in percent; payload is basis points
EURO_SPREADS = {"fr10y": "fr", "it10y": "it", "es10y": "es"}  # each minus de10y

PRICE_TICKERS = (
    "HYG", "IEI", "LQD", "IEF", "KRE", "BIZD", "OWL", "ARCC",
    "CRWV", "NBIS", "ORCL", "META", "SOXX", "SMH", "IGV", "SPY", "QQQ",
)
PRICE_LEVEL_TICKERS = ("BKLN",)  # price, not total return
MACRO_KEYS = ("vix", "us10y", "us30y")
RATIOS = {"HYG/IEI": ("HYG", "IEI"), "LQD/IEF": ("LQD", "IEF")}

_lock = threading.Lock()
_cache: tuple[float, dict] | None = None


def _credit_series(con: duckdb.DuckDBPyConnection) -> dict[str, dict[str, float]]:
    """{series_key: {date: value}} from ``credit_series_daily``."""
    out: dict[str, dict[str, float]] = {}
    for key, d, v in con.execute("SELECT series_key, date, value FROM credit_series_daily").fetchall():
        if v is not None:
            out.setdefault(key, {})[d.strftime("%Y-%m-%d")] = float(v)
    return out


def _columnar(by_key: dict[str, dict[str, float]], start: str, digits) -> dict:
    """``{"dates", "series", "last"}`` over the union of dates from ``start``;
    a series is null on dates it has no value (weekly series, holidays)."""
    dates = sorted({d for obs in by_key.values() for d in obs if d >= start})
    series = {k: [None if d not in obs else round(obs[d], digits(k)) for d in dates] for k, obs in by_key.items()}
    last = {k: max(obs) if obs else None for k, obs in by_key.items()}
    return {"dates": dates, "series": series, "last": last}


def fred_block(history: dict[str, dict[str, float]]) -> dict:
    """Spreads in basis points, the stress indexes, and SOFR minus IORB in
    basis points on the dates both print."""
    by_key = {payload: history.get(key, {}) for key, payload in FRED_KEYS.items()}
    sofr, iorb = by_key.pop("sofr"), by_key.pop("iorb")
    by_key["funding"] = {d: (sofr[d] - iorb[d]) * 100 for d in sofr if d in iorb}
    for k in SPREAD_KEYS:
        by_key[k] = {d: v * 100 for d, v in by_key[k].items()}
    return _columnar(by_key, FRED_START, lambda k: 0 if k in SPREAD_KEYS or k == "funding" else 4)


def tv_block(history: dict[str, dict[str, float]]) -> dict:
    """France, Italy and Spain 10-year yields minus the Bund's in basis points
    (on the dates both legs closed), plus the MOVE index level."""
    de = history.get("de10y", {})
    by_key = {
        payload: {d: (v - de[d]) * 100 for d, v in history.get(key, {}).items() if d in de}
        for key, payload in EURO_SPREADS.items()
    }
    by_key["move"] = dict(history.get("move", {}))
    return _columnar(by_key, TV_START, lambda k: 1)


def _prices(con: duckdb.DuckDBPyConnection) -> dict:
    """Columnar closes (total return, or price for ``PRICE_LEVEL_TICKERS``), VIX and yields."""
    tickers = ", ".join(f"'{t}'" for t in PRICE_TICKERS)
    levels = ", ".join(f"'{t}'" for t in PRICE_LEVEL_TICKERS)
    macro = ", ".join(f"'{k}'" for k in MACRO_KEYS)
    rows = con.execute(
        f"SELECT ticker, date, close_adjusted FROM daily_bars_adjusted "
        f"WHERE ticker IN ({tickers}) AND date >= '{PRICE_START}'"
    ).fetchall()
    rows += con.execute(
        f"SELECT ticker, date, close_split_adjusted FROM daily_bars_adjusted "
        f"WHERE ticker IN ({levels}) AND date >= '{PRICE_START}'"
    ).fetchall()
    rows += con.execute(
        f"SELECT series_key, date, value FROM macro_series_daily "
        f"WHERE series_key IN ({macro}) AND date >= '{PRICE_START}'"
    ).fetchall()

    by_key: dict[str, dict[str, float]] = {}
    for key, d, v in rows:
        if v is not None:
            by_key.setdefault(key, {})[d.strftime("%Y-%m-%d")] = float(v)
    # Trading days are the days SPY printed; VIX/yields can print on others.
    dates = sorted(by_key.get("SPY", {}))
    for name, (num, den) in RATIOS.items():
        a, b = by_key.get(num, {}), by_key.get(den, {})
        by_key[name] = {d: a[d] / b[d] for d in a if d in b}
    series = {
        k: [None if (v := by_key.get(k, {}).get(d)) is None else round(v, 5 if "/" in k else 2) for d in dates]
        for k in [*PRICE_TICKERS, *PRICE_LEVEL_TICKERS, *MACRO_KEYS, *RATIOS]
    }
    return {"dates": dates, "series": series}


def _cds(con: duckdb.DuckDBPyConnection) -> dict | None:
    """Columnar 5Y CDS spreads per name, plus ``names`` (key -> display name)."""
    exists = con.execute(
        "SELECT count(*) FROM information_schema.tables WHERE table_name = 'cds_spreads_daily'"
    ).fetchone()[0]
    if not exists:
        return None
    by_key: dict[str, dict[str, float]] = {}
    names: dict[str, str] = {}
    for key, name, d, v in con.execute(
        "SELECT name_key, name, date, spread_bp FROM cds_spreads_daily WHERE spread_bp IS NOT NULL"
    ).fetchall():
        by_key.setdefault(key, {})[d.strftime("%Y-%m-%d")] = float(v)
        names[key] = name
    return {**_columnar(by_key, "", lambda k: 0), "names": names}


def get_credit() -> dict:
    """``{"fred", "prices", "tv", "cds"}`` for the Credit tab."""
    global _cache
    with _lock:
        mtime = INVESTMENT_DB.stat().st_mtime
        if _cache is None or _cache[0] != mtime:
            con = duckdb.connect(str(INVESTMENT_DB), read_only=True)
            try:
                history = _credit_series(con)
                payload = {"fred": fred_block(history), "prices": _prices(con), "tv": tv_block(history), "cds": _cds(con)}
            finally:
                con.close()
            _cache = (mtime, payload)
        return _cache[1]
