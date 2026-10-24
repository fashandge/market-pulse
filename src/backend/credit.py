"""Credit-stress history for the Overview "Credit" tab.

Three blocks, all columnar (one ``dates`` array plus one array per series) so
the frontend can slice any range without refetching:

- ``fred``: ICE BofA option-adjusted spreads (investment grade, BBB, high
  yield, CCC), the St. Louis and Chicago Fed stress indexes (weekly), and
  SOFR minus IORB (repo funding pressure), from FRED's keyless fredgraph.csv.
- ``prices``: adjusted closes for the credit ETFs, the crowded-out lenders,
  the AI borrowers and the semis/software ETFs, plus VIX and Treasury yields,
  read-only from the investment duckdb. HYG/IEI and LQD/IEF ratios are added
  here: credit ETFs against same-maturity Treasuries, which strips most of
  the interest-rate move and leaves the credit part. BKLN (leveraged loans)
  is the split-adjusted price, not total return: its ~8% payout would
  otherwise hide the price drops that signal loan stress.
- ``tv``: France, Italy and Spain 10-year government yields minus the German
  Bund's, in basis points (sovereign stress), and the MOVE index (Treasury
  implied volatility), from TradingView's daily history via the investment
  project's chart-data websocket fetcher. That endpoint is unofficial, so the
  block falls back to stored history if it stops answering.

FRED serves the ICE series only as a rolling three-year window, so every
fetch is merged into an append-only local file (``FRED_HISTORY``) and the
payload is built from that file. History older than three years survives
there, and the tab still loads from it when FRED is down. The TradingView
series get the same treatment in ``TV_HISTORY``.
"""

import csv
import io
import os
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import duckdb

from investment.src.scripts import validate_daily_prices_tradingview as tv_daily

INVESTMENT_DB = Path.home() / "projects/investment/data/stocks/stocks.duckdb"
FRED_HISTORY = Path(__file__).resolve().parents[2] / "data/credit/fred_history.csv"
TV_HISTORY = Path(__file__).resolve().parents[2] / "data/credit/tradingview_history.csv"
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={ids}&cosd={start}"
FRED_TTL = 3600  # seconds; the series update once per business day
FRED_START = "2007-01-01"
PRICE_START = "2019-01-01"

# FRED id -> payload key.
FRED_SERIES = {
    "BAMLC0A0CM": "ig",
    "BAMLC0A4CBBB": "bbb",
    "BAMLH0A0HYM2": "hy",
    "BAMLH0A3HYC": "ccc",
    "STLFSI4": "stlfsi",
    "NFCI": "nfci",
    "SOFR": "sofr",
    "IORB": "iorb",
}
SPREAD_KEYS = ("ig", "bbb", "hy", "ccc")  # FRED publishes percent; payload is basis points

PRICE_TICKERS = (
    "HYG", "IEI", "LQD", "IEF", "KRE", "BIZD", "OWL", "ARCC",
    "CRWV", "NBIS", "ORCL", "META", "SOXX", "IGV", "SPY",
)
PRICE_LEVEL_TICKERS = ("BKLN",)  # price, not total return
MACRO_KEYS = ("vix", "us10y", "us30y")
RATIOS = {"HYG/IEI": ("HYG", "IEI"), "LQD/IEF": ("LQD", "IEF")}

# TradingView symbol -> payload key. Euro spreads are each yield minus Germany's.
TV_SYMBOLS = {"TVC:DE10Y": "de", "TVC:FR10Y": "fr", "TVC:IT10Y": "it", "TVC:ES10Y": "es", "TVC:MOVE": "move"}
EURO_SPREADS = ("TVC:FR10Y", "TVC:IT10Y", "TVC:ES10Y")
TV_START = "2015-01-01"
TV_BARS_FULL = 3500  # first fetch of a symbol: back to ~2013
TV_BARS_TOPUP = 30  # later fetches only refresh the recent bars

_lock = threading.Lock()
_fred_state: dict = {"fetched_at": 0.0, "ok": None}
_tv_state: dict = {"fetched_at": 0.0, "ok": None}
_prices_cache: tuple[float, dict] | None = None


# ---- FRED: fetch, merge into the local history, read back -------------------
def _fetch_series(sid: str) -> dict[str, float] | None:
    """{date: value} for one FRED series; None on failure.

    One request per series: fredgraph.csv answers a multi-series request that
    mixes daily and weekly series with a zip archive instead of a CSV. During
    site maintenance FRED answers HTTP 200 with an HTML page, which parses
    without the series column -- that counts as a failure too.
    """
    try:
        with urllib.request.urlopen(FRED_CSV_URL.format(ids=sid, start=FRED_START), timeout=20) as resp:
            reader = csv.DictReader(io.TextIOWrapper(resp, encoding="utf-8"))
            rows = list(reader)
            columns = reader.fieldnames or []
    except Exception:
        return None
    if sid not in columns:
        return None
    return {row[columns[0]]: float(row[sid]) for row in rows if row.get(sid) not in (None, "", ".")}


def _fetch_fred() -> dict[str, dict[str, float]] | None:
    """{fred_id: {date: value}} for every series that fetched; None if none did."""
    with ThreadPoolExecutor(max_workers=len(FRED_SERIES)) as pool:
        results = dict(zip(FRED_SERIES, pool.map(_fetch_series, FRED_SERIES)))
    out = {sid: obs for sid, obs in results.items() if obs}
    return out or None


def _read_history(path: Path | None = None) -> dict[str, dict[str, float]]:
    """A local long-format history file as {series_id: {date: value}}."""
    path = path or FRED_HISTORY
    out: dict[str, dict[str, float]] = {}
    if not path.exists():
        return out
    with open(path) as f:
        for row in csv.DictReader(f):
            out.setdefault(row["series"], {})[row["date"]] = float(row["value"])
    return out


def merge(history: dict[str, dict[str, float]], fetched: dict[str, dict[str, float]]) -> dict[str, dict[str, float]]:
    """Union of stored and fetched observations; fetched values win on a shared
    date (FRED revises), and stored dates FRED no longer serves are kept."""
    merged = {sid: dict(obs) for sid, obs in history.items()}
    for sid, obs in fetched.items():
        merged.setdefault(sid, {}).update(obs)
    return merged


def _write_history(data: dict[str, dict[str, float]], path: Path | None = None) -> None:
    """Atomically rewrite a history file (sorted by series, then date)."""
    path = path or FRED_HISTORY
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["series", "date", "value"])
        for sid in sorted(data):
            for d in sorted(data[sid]):
                w.writerow([sid, d, data[sid][d]])
    os.replace(tmp, path)


def _refresh(state: dict, path: Path, fetch) -> dict[str, dict[str, float]]:
    """Merge a fresh pull (``fetch(stored)``) into ``path`` at most once per TTL
    and return the stored history. A failed pull leaves the file untouched."""
    now = time.time()
    if now - state["fetched_at"] >= FRED_TTL:
        stored = _read_history(path)
        fetched = fetch(stored)
        state.update(fetched_at=now, ok=fetched is not None)
        if fetched:
            _write_history(merge(stored, fetched), path)
    return _read_history(path)


def _refresh_fred() -> dict[str, dict[str, float]]:
    return _refresh(_fred_state, FRED_HISTORY, lambda stored: _fetch_fred())


# ---- euro sovereign yields and MOVE from TradingView ---------------------------
def _fetch_tv_series(symbol: str, bars: int) -> dict[str, float] | None:
    """{date: close} for one TradingView symbol; None on failure."""
    try:
        df = tv_daily.fetch_tv_daily(symbol, bars=bars, timeout=30)
    except Exception:
        return None
    return {d.strftime("%Y-%m-%d"): float(v) for d, v in zip(df["date"], df["tv_close"]) if v == v}


def _fetch_tradingview(stored: dict[str, dict[str, float]]) -> dict[str, dict[str, float]] | None:
    """Every TradingView series that fetched; full history for a symbol not yet
    stored, the last few weeks otherwise. None if none fetched."""
    bars = {s: TV_BARS_TOPUP if stored.get(s) else TV_BARS_FULL for s in TV_SYMBOLS}
    with ThreadPoolExecutor(max_workers=len(TV_SYMBOLS)) as pool:
        results = dict(zip(TV_SYMBOLS, pool.map(lambda s: _fetch_tv_series(s, bars[s]), TV_SYMBOLS)))
    out = {s: obs for s, obs in results.items() if obs}
    return out or None


def _tv_columnar(history: dict[str, dict[str, float]]) -> dict:
    """France, Italy and Spain 10-year yields minus the Bund's in basis points
    (on the dates both legs closed), plus the MOVE index level."""
    de = history.get("TVC:DE10Y", {})
    by_key = {
        TV_SYMBOLS[sym]: {d: (v - de[d]) * 100 for d, v in history.get(sym, {}).items() if d in de and d >= TV_START}
        for sym in EURO_SPREADS
    }
    by_key["move"] = {d: v for d, v in history.get("TVC:MOVE", {}).items() if d >= TV_START}
    dates = sorted({d for obs in by_key.values() for d in obs})
    series = {k: [None if d not in obs else round(obs[d], 1) for d in dates] for k, obs in by_key.items()}
    last = {k: max(obs) if obs else None for k, obs in by_key.items()}
    return {"dates": dates, "series": series, "last": last}


def _fred_columnar(history: dict[str, dict[str, float]]) -> dict:
    """Columnar FRED block: spreads in basis points, plus SOFR minus IORB in
    basis points on the dates both print. Weekly series are null on other days."""
    by_key = {key: history.get(sid, {}) for sid, key in FRED_SERIES.items()}
    sofr, iorb = by_key.pop("sofr"), by_key.pop("iorb")
    by_key["funding"] = {d: (sofr[d] - iorb[d]) * 100 for d in sofr if d in iorb}
    for k in SPREAD_KEYS:
        by_key[k] = {d: v * 100 for d, v in by_key[k].items()}
    dates = sorted({d for obs in by_key.values() for d in obs if d >= FRED_START})
    series = {
        k: [None if d not in obs else round(obs[d], 0 if k in SPREAD_KEYS or k == "funding" else 4) for d in dates]
        for k, obs in by_key.items()
    }
    last = {k: max(obs) if obs else None for k, obs in by_key.items()}
    return {"dates": dates, "series": series, "last": last}


# ---- prices from the investment duckdb ---------------------------------------
def _prices() -> dict:
    """Columnar closes (total return, or price for ``PRICE_LEVEL_TICKERS``),
    VIX and yields; cached on the DB file's mtime."""
    global _prices_cache
    mtime = INVESTMENT_DB.stat().st_mtime
    if _prices_cache is not None and _prices_cache[0] == mtime:
        return _prices_cache[1]

    tickers = ", ".join(f"'{t}'" for t in PRICE_TICKERS)
    macro = ", ".join(f"'{k}'" for k in MACRO_KEYS)
    con = duckdb.connect(str(INVESTMENT_DB), read_only=True)
    try:
        bars = con.execute(
            f"SELECT ticker, date, close_adjusted FROM daily_bars_adjusted "
            f"WHERE ticker IN ({tickers}) AND date >= '{PRICE_START}'"
        ).fetchall()
        levels = ", ".join(f"'{t}'" for t in PRICE_LEVEL_TICKERS)
        bars += con.execute(
            f"SELECT ticker, date, close_split_adjusted FROM daily_bars_adjusted "
            f"WHERE ticker IN ({levels}) AND date >= '{PRICE_START}'"
        ).fetchall()
        mac = con.execute(
            f"SELECT series_key, date, value FROM macro_series_daily "
            f"WHERE series_key IN ({macro}) AND date >= '{PRICE_START}'"
        ).fetchall()
    finally:
        con.close()

    by_key: dict[str, dict[str, float]] = {}
    for key, d, v in [*bars, *mac]:
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
    payload = {"dates": dates, "series": series}
    _prices_cache = (mtime, payload)
    return payload


def get_credit() -> dict:
    """``{"fred", "prices", "tv", "fred_live", "tv_live"}`` for the Credit tab.

    ``fred_live`` / ``tv_live`` are False when the latest pull from that
    source failed and its block comes from the local history file alone.
    """
    with _lock:
        fred = _fred_columnar(_refresh_fred())
        tv = _tv_columnar(_refresh(_tv_state, TV_HISTORY, _fetch_tradingview))
        fred_live, tv_live = _fred_state["ok"], _tv_state["ok"]
    return {"fred": fred, "prices": _prices(), "tv": tv, "fred_live": fred_live, "tv_live": tv_live}
