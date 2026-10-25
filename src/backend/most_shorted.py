"""A free stand-in for Goldman's most-shorted basket, for the Credit tab.

Goldman's index (Bloomberg ``GSCBMSAL``) has no free feed. This rebuilds the
idea from free data and tracks its turning points, not its level:

- Short interest: FINRA's keyless consolidated short-interest API, published
  twice a month. Only each month's last settlement date is used.
- Shares outstanding: SEC XBRL frames (``dei:EntityCommonStockSharesOutstanding``),
  one bulk request per calendar quarter, keyed by CIK.
- Prices and the ticker -> CIK map: the investment duckdb (read-only), using
  ``tickers_reference`` so names delisted since stay in past baskets.

At each month-end settlement date, the basket is the 50 US-listed common stocks
with the highest short interest as a share of shares outstanding, among those
with a market value of at least $1B and a price of at least $5. Members are
equal-weighted from the first trading day 12 days after settlement (FINRA
publishes about eight business days after settlement), and the daily index is
the compounded mean of the members' total returns, starting at 100.

FINRA snapshots and SEC frames never change once complete, so each is fetched
once into ``CACHE_DIR`` (gitignored). The two most recent SEC quarters are
re-fetched daily while companies are still filing. The index is recomputed
only when the cache or the duckdb file changes.
"""

import csv
import json
import threading
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import duckdb
import pandas as pd

INVESTMENT_DB = Path.home() / "projects/investment/data/stocks/stocks.duckdb"
CACHE_DIR = Path(__file__).resolve().parents[2] / "data/credit/most_shorted"
FINRA_URL = "https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest"
SEC_FRAME_URL = "https://data.sec.gov/api/xbrl/frames/dei/EntityCommonStockSharesOutstanding/shares/{frame}.json"
USER_AGENT = "market-pulse research tool"

START = "2025-11-01"  # first month-end settlement used
PROBE_SYMBOL = "AAPL"  # any long-listed stock: its rows list every settlement date
BASKET_SIZE = 50
MIN_MARKET_CAP = 1e9
MIN_PRICE = 5.0
PUBLICATION_LAG_DAYS = 12
EXCHANGES = ("XNAS", "XNYS", "XASE")
CHECK_TTL = 12 * 3600  # seconds between checks for new FINRA dates / SEC filings
SEC_SETTLING_DAYS = 120  # a quarter's frame keeps filling in this long after quarter end
PAGE = 5000

_lock = threading.Lock()
_state: dict = {"checked_at": 0.0, "live": None}
_index_cache: tuple[tuple, dict] | None = None


# ---- FINRA short interest ----------------------------------------------------
def _finra(filters: list[dict], fields: list[str], offset: int = 0) -> list[dict]:
    body = json.dumps({"limit": PAGE, "offset": offset, "compareFilters": filters, "fields": fields}).encode()
    req = urllib.request.Request(FINRA_URL, data=body, headers={"Content-Type": "application/json", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        text = resp.read().decode()
    return json.loads(text) if text.strip() else []


def month_end_dates(settlement_dates: list[str], start: str = START) -> list[str]:
    """The last settlement date of each month, from ``start`` on, sorted."""
    last: dict[str, str] = {}
    for d in settlement_dates:
        if d >= start and d > last.get(d[:7], ""):
            last[d[:7]] = d
    return sorted(last.values())


def _si_path(settlement: str) -> Path:
    return CACHE_DIR / f"si_{settlement}.csv"


def _fetch_settlement(settlement: str) -> None:
    """Store every symbol's short position for one settlement date."""
    rows, offset = [], 0
    while True:
        page = _finra([{"compareType": "EQUAL", "fieldName": "settlementDate", "fieldValue": settlement}],
                      ["symbolCode", "currentShortPositionQuantity"], offset)
        rows += page
        if len(page) < PAGE:
            break
        offset += PAGE
    if not rows:
        raise RuntimeError(f"FINRA returned no rows for {settlement}")
    tmp = _si_path(settlement).with_suffix(".tmp")
    with open(tmp, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ticker", "short_qty"])
        for r in rows:
            if r.get("symbolCode") and r.get("currentShortPositionQuantity") is not None:
                w.writerow([r["symbolCode"], r["currentShortPositionQuantity"]])
    tmp.replace(_si_path(settlement))


# ---- SEC shares outstanding --------------------------------------------------
def quarter_frames(start: str, today: date) -> list[tuple[str, date]]:
    """(frame name, quarter end) for every calendar quarter from the one before
    ``start`` through the last one that has ended by ``today``."""
    y, q = int(start[:4]), (int(start[5:7]) - 1) // 3  # quarter before start's quarter
    if q == 0:
        y, q = y - 1, 4
    out = []
    while True:
        end = date(y, 3 * q, 31 if q in (1, 4) else 30)
        if end > today:
            return out
        out.append((f"CY{y}Q{q}I", end))
        y, q = (y + 1, 1) if q == 4 else (y, q + 1)


def _sec_path(frame: str) -> Path:
    return CACHE_DIR / f"sec_{frame}.csv"


def _fetch_frame(frame: str) -> None:
    req = urllib.request.Request(SEC_FRAME_URL.format(frame=frame), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())["data"]
    tmp = _sec_path(frame).with_suffix(".tmp")
    with open(tmp, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["cik", "end", "shares"])
        for x in data:
            w.writerow([x["cik"], x["end"], x["val"]])
    tmp.replace(_sec_path(frame))


def _sync(today: date) -> bool:
    """Fetch any missing month-end FINRA snapshot and any missing or still-filling
    SEC quarter. True if everything needed was fetched or already stored."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ok = True
    try:
        probe = _finra([{"compareType": "EQUAL", "fieldName": "symbolCode", "fieldValue": PROBE_SYMBOL}], ["settlementDate"])
        for d in month_end_dates([r["settlementDate"] for r in probe]):
            if not _si_path(d).exists():
                _fetch_settlement(d)
    except Exception:
        ok = False
    for frame, end in quarter_frames(START, today):
        settling = today - end < timedelta(days=SEC_SETTLING_DAYS)
        if _sec_path(frame).exists() and not settling:
            continue
        try:
            _fetch_frame(frame)
        except Exception:
            # Right after a quarter ends its frame may not exist yet, and a
            # stored copy of a settling quarter stays usable; only a quarter
            # long past with nothing stored is a real gap.
            if not _sec_path(frame).exists() and today - end > timedelta(days=60):
                ok = False
    return ok


# ---- the index ---------------------------------------------------------------
def _stored_settlements() -> list[str]:
    return sorted(p.stem[3:] for p in CACHE_DIR.glob("si_*.csv") if p.stem[3:] >= START)


def _shares_as_of(frames: pd.DataFrame, when: str) -> pd.Series:
    """Latest reported shares outstanding per CIK with a period end on or before ``when``."""
    f = frames[frames.end <= when].sort_values("end")
    return f.groupby("cik").shares.last()


def build_index(con: duckdb.DuckDBPyConnection, settlements: list[str], frames: pd.DataFrame) -> dict:
    """Basket membership per month-end and the daily equal-weight index."""
    ref = con.execute(
        f"""SELECT ticker, try_cast(cik AS BIGINT) AS cik FROM tickers_reference
            WHERE type = 'CS' AND cik IS NOT NULL AND primary_exchange IN {EXCHANGES}
            QUALIFY row_number() OVER (PARTITION BY ticker ORDER BY active DESC, last_seen_utc DESC) = 1"""
    ).df()
    baskets: list[tuple[pd.Timestamp, str, pd.DataFrame]] = []
    for d in settlements:
        si = pd.read_csv(_si_path(d)).merge(ref, on="ticker")
        si["shares"] = si.cik.map(_shares_as_of(frames, d))
        px = con.execute(
            """SELECT ticker, close FROM daily_bars_adjusted
               WHERE date = (SELECT max(date) FROM daily_bars_adjusted WHERE ticker = 'SPY' AND date <= ?)""",
            [d],
        ).df()
        si = si.merge(px, on="ticker").dropna(subset=["shares"])
        si = si[(si.shares > 0) & (si.close >= MIN_PRICE) & (si.close * si.shares >= MIN_MARKET_CAP)]
        si["short_pct"] = si.short_qty / si.shares
        si = si[si.short_pct < 1.0]  # a short count above the share count is a share-count mismatch
        top = si.nlargest(BASKET_SIZE, "short_pct")
        baskets.append((pd.Timestamp(d) + pd.Timedelta(days=PUBLICATION_LAG_DAYS), d, top))
    if not baskets:
        return {"dates": [], "values": [], "members": [], "settlement": None}

    tickers = sorted({t for _, _, top in baskets for t in top.ticker})
    prices = con.execute(
        "SELECT ticker, date, close_adjusted FROM daily_bars_adjusted WHERE ticker IN (SELECT unnest(?)) AND date >= ?",
        [tickers, (baskets[0][0] - pd.Timedelta(days=10)).strftime("%Y-%m-%d")],
    ).df().pivot(index="date", columns="ticker", values="close_adjusted").sort_index()
    rets = prices.pct_change(fill_method=None)

    level, dates, values = 100.0, [], []
    for day in rets.index[rets.index >= baskets[0][0]]:
        members = [top for eff, _, top in baskets if eff <= day][-1].ticker
        r = rets.loc[day, rets.columns.intersection(members)].dropna()
        if len(r):
            level *= 1 + float(r.mean())
        dates.append(day.strftime("%Y-%m-%d"))
        values.append(round(level, 3))

    eff, settlement, top = baskets[-1]
    return {
        "dates": dates,
        "values": values,
        "settlement": settlement,
        "effective": eff.strftime("%Y-%m-%d"),
        "members": [{"ticker": t, "short_pct": round(float(p) * 100, 1)} for t, p in zip(top.ticker, top.short_pct)],
    }


def _read_frames() -> pd.DataFrame:
    parts = [pd.read_csv(p) for p in sorted(CACHE_DIR.glob("sec_*.csv"))]
    return pd.concat(parts) if parts else pd.DataFrame(columns=["cik", "end", "shares"])


def get_most_shorted() -> dict:
    """``{"dates", "values", "settlement", "effective", "members", "live"}``.

    ``live`` is False when the latest check for new FINRA or SEC data failed;
    the index is then built from what is stored.
    """
    global _index_cache
    with _lock:
        if time.time() - _state["checked_at"] >= CHECK_TTL:
            _state.update(checked_at=time.time(), live=_sync(date.today()))
        inputs = tuple(sorted((p.name, p.stat().st_mtime) for p in CACHE_DIR.glob("*.csv"))) if CACHE_DIR.exists() else ()
        key = (INVESTMENT_DB.stat().st_mtime, inputs)
        if _index_cache is None or _index_cache[0] != key:
            con = duckdb.connect(str(INVESTMENT_DB), read_only=True)
            try:
                _index_cache = (key, build_index(con, month_end_dates(_stored_settlements()), _read_frames()))
            finally:
                con.close()
        return {**_index_cache[1], "live": _state["live"]}
