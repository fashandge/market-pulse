"""Bloomberg-sourced charts from the Credit Bubble Bulletin, for the Credit tab.

Doug Noland's Credit Bubble Bulletin posts weekly chart images, sourced from
Bloomberg, of series with no free feed. The tab shows three groups of them,
credited and linked back as the site's terms require:

- ``goldman_short``: the Goldman Short Index (Goldman's most-shorted basket),
  a recent-weeks view and a year-to-date view.
- ``oracle``: Oracle's 10-year bond yield, year to date.
- ``meta``: Meta's 10-year bond yield, year to date.

The homepage is scraped for ``<img>`` tags under ``/media/charts/`` and each is
assigned to a group by its filename. The site overwrites the same files in
place each week (alt text can be months stale while the image is current), so
images are re-downloaded once per TTL and dated by the server's
``Last-Modified`` header, never cached by name alone. A manifest of the last
good scrape lets the tab keep showing the stored images when the site is down.

Every new ``Last-Modified`` seen for an image is appended to ``update_log.jsonl``
in the cache folder, recording the site's actual update rhythm (expected:
weekly, uploaded as a batch on Friday mornings US time). The scrape only runs
when the tab is opened, so a gap between log lines can mean an unobserved
upload; the logged ``modified`` times themselves are the site's, not ours.

The Goldman Short Index charts are also read into daily values
(``chart_digitizer``), once per new image, and merged into
``goldman_short_history.csv``: for each day the reading from the chart with the
most pixels per day wins (a 34-day chart over a year-to-date one), the newer
chart breaking ties. The digitized points ride along with each chart so the
tab can draw them over the original image for checking. ``goldman_overlay_page``
serves that history as a smoothing playground (``overlay_playground``) against
our own most-shorted basket and the ETFs.
"""

import csv
import json
import re
import threading
import time
import urllib.request
from datetime import date
from email.utils import parsedate_to_datetime
from pathlib import Path

import duckdb

from src.backend import chart_digitizer, overlay_playground

SITE_URL = "https://thecreditbubblebulletin.com/"
CACHE_DIR = Path(__file__).resolve().parents[2] / "data/credit/cbb_charts"
TTL = 6 * 3600  # seconds; the charts change about once a week
USER_AGENT = "Mozilla/5.0 (market-pulse personal dashboard)"

# Group key -> filename pattern. Filenames look like TC_Gsshort_2026_iwJ4bt3.png.
GROUPS = {
    "goldman_short": re.compile(r"Gsshort", re.IGNORECASE),
    "oracle": re.compile(r"_Oracle_", re.IGNORECASE),
    "meta": re.compile(r"MetaYield", re.IGNORECASE),
}

DIGITIZE_GROUPS = ("goldman_short",)
INVESTMENT_DB = Path.home() / "projects/investment/data/stocks/stocks.duckdb"

IMG_RE = re.compile(r'<img[^>]*\bsrc="(/media/charts/[^"]+\.png)"', re.IGNORECASE)
NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+\.png$")

_lock = threading.Lock()
_state: dict = {"fetched_at": 0.0, "live": None}


def find_chart_paths(html: str) -> dict[str, list[str]]:
    """{group: site-relative image paths} in page order, deduped; groups with
    no image on the page are omitted."""
    out: dict[str, list[str]] = {}
    for path in IMG_RE.findall(html):
        name = path.rsplit("/", 1)[-1]
        for group, pattern in GROUPS.items():
            if pattern.search(name) and path not in out.get(group, []):
                out.setdefault(group, []).append(path)
    return out


def label_for(name: str) -> str:
    """'Recent weeks' for a short-window chart (``..._10day_...``), 'Year to date' otherwise."""
    return "Recent weeks" if re.search(r"\d+day", name, re.IGNORECASE) else "Year to date"


def _get(url: str) -> tuple[bytes, str | None]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read(), resp.headers.get("Last-Modified")


def _manifest_path() -> Path:
    return CACHE_DIR / "manifest.json"


def _read_manifest() -> dict[str, list[dict]]:
    try:
        return json.loads(_manifest_path().read_text())
    except (OSError, ValueError):
        return {}


def _log_updates(groups: dict[str, list[dict]], previous: dict[str, list[dict]]) -> None:
    """Append one line per image whose ``modified`` differs from the previous manifest."""
    before = {c["name"]: c.get("modified") for charts in previous.values() for c in charts}
    seen_at = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    lines = [
        json.dumps({"group": group, "name": c["name"], "modified": c["modified"], "seen_at": seen_at})
        for group, charts in groups.items() for c in charts
        if c.get("modified") and before.get(c["name"]) != c["modified"]
    ]
    if lines:
        with open(CACHE_DIR / "update_log.jsonl", "a") as f:
            f.write("\n".join(lines) + "\n")


def _refresh() -> bool:
    """Scrape the homepage and re-download every chart; False if anything failed
    (the previous manifest and images are then left as they were)."""
    try:
        html, _ = _get(SITE_URL)
        found = find_chart_paths(html.decode("utf-8", errors="replace"))
        if not found:
            return False
        groups: dict[str, list[dict]] = {}
        for group, paths in found.items():
            for path in paths:
                name = path.rsplit("/", 1)[-1]
                if not NAME_RE.match(name):
                    continue
                body, modified = _get(SITE_URL.rstrip("/") + path)
                if not body.startswith(b"\x89PNG"):
                    return False
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                tmp = CACHE_DIR / (name + ".tmp")
                tmp.write_bytes(body)
                tmp.replace(CACHE_DIR / name)
                stamp = parsedate_to_datetime(modified) if modified else None
                groups.setdefault(group, []).append({
                    "name": name, "label": label_for(name),
                    "updated": stamp.date().isoformat() if stamp else None,
                    "modified": stamp.isoformat() if stamp else None,
                })
    except Exception:
        return False
    if not groups:
        return False
    _log_updates(groups, _read_manifest())
    _manifest_path().write_text(json.dumps(groups, indent=2))
    return True


# ---- digitized Goldman Short Index ---------------------------------------------
def _digitized_path(name: str) -> Path:
    return CACHE_DIR / f"{name}.digitized.json"


def _history_path(group: str) -> Path:
    return CACHE_DIR / f"{group}_history.csv"


def _read_history(group: str) -> dict[str, dict]:
    path = _history_path(group)
    if not path.exists():
        return {}
    with open(path) as f:
        return {r["date"]: {"value": float(r["value"]), "px_per_day": float(r["px_per_day"]), "chart_modified": r["chart_modified"]}
                for r in csv.DictReader(f)}


def merge_history(history: dict[str, dict], reading: dict, chart_modified: str) -> dict[str, dict]:
    """Fold one chart's daily values into the history: a day takes the reading
    with more pixels per day, or on a tie the newer chart."""
    out = dict(history)
    for d, v in zip(reading["dates"], reading["values"]):
        new = {"value": v, "px_per_day": reading["px_per_day"], "chart_modified": chart_modified}
        old = out.get(d)
        if old is None or (new["px_per_day"], chart_modified) >= (old["px_per_day"], old["chart_modified"]):
            out[d] = new
    return out


def _write_history(group: str, history: dict[str, dict]) -> None:
    tmp = _history_path(group).with_suffix(".tmp")
    with open(tmp, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "value", "px_per_day", "chart_modified"])
        for d in sorted(history):
            h = history[d]
            w.writerow([d, h["value"], h["px_per_day"], h["chart_modified"]])
    tmp.replace(_history_path(group))


def _trading_days() -> list[str]:
    con = duckdb.connect(str(INVESTMENT_DB), read_only=True)
    try:
        rows = con.execute(
            "SELECT date FROM daily_bars_adjusted WHERE ticker = 'SPY' AND date >= '2015-01-01' ORDER BY date"
        ).fetchall()
    finally:
        con.close()
    return [d.strftime("%Y-%m-%d") for (d,) in rows]


def _digitize_new(manifest: dict[str, list[dict]]) -> None:
    """Digitize each stored chart in ``DIGITIZE_GROUPS`` not yet read at its
    current ``modified`` time, and merge the readings into the group history.
    A chart that fails is recorded with its error and retried next time it changes."""
    days: list[str] | None = None
    for group in DIGITIZE_GROUPS:
        history, changed = _read_history(group), False
        for c in manifest.get(group, []):
            path, out = CACHE_DIR / c["name"], _digitized_path(c["name"])
            if not path.exists() or not c.get("modified"):
                continue
            try:
                stored = json.loads(out.read_text())
                if stored.get("modified") == c["modified"] and stored.get("version") == chart_digitizer.VERSION:
                    continue
            except (OSError, ValueError):
                pass
            days = days if days is not None else _trading_days()
            try:
                reading = chart_digitizer.digitize(path, days, date.fromisoformat(c["modified"][:10]))
            except Exception as e:  # noqa: BLE001 -- any failure leaves the chart image-only
                out.write_text(json.dumps({"modified": c["modified"], "version": chart_digitizer.VERSION, "error": str(e)}))
                continue
            out.write_text(json.dumps({"modified": c["modified"], **reading}))
            history, changed = merge_history(history, reading, c["modified"]), True
        if changed:
            _write_history(group, history)


BENCHMARKS = overlay_playground.ETFS
_bench_cache: tuple[tuple, dict] | None = None


def _benchmarks(start: str) -> dict:
    """{ticker: {dates, closes}} from ``start``: split-adjusted prices, not total
    return, to compare with a price index. Cached on the duckdb file's mtime."""
    global _bench_cache
    key = (INVESTMENT_DB.stat().st_mtime, start)
    if _bench_cache is None or _bench_cache[0] != key:
        con = duckdb.connect(str(INVESTMENT_DB), read_only=True)
        try:
            rows = con.execute(
                f"SELECT ticker, date, close_split_adjusted FROM daily_bars_adjusted "
                f"WHERE ticker IN {BENCHMARKS} AND date >= ? ORDER BY date", [start]
            ).fetchall()
        finally:
            con.close()
        out = {t: {"dates": [], "closes": []} for t in BENCHMARKS}
        for t, d, v in rows:
            if v is not None:
                out[t]["dates"].append(d.strftime("%Y-%m-%d"))
                out[t]["closes"].append(round(float(v), 2))
        _bench_cache = (key, out)
    return _bench_cache[1]


def list_charts() -> dict:
    """``{"groups": {group: [{name, label, updated, modified, digitized?}]},
    "series": {group: {dates, values, px_per_day}}, "benchmarks": {QQQ, SPY:
    {dates, closes}}, "source_url", "live"}``.

    ``digitized`` (Goldman charts only) holds the values read off that image and
    their pixel positions, or ``{"error": ...}``. ``series`` is the merged daily
    history of the digitized readings. ``live`` is False when the latest scrape
    failed and the charts are the stored ones from an earlier scrape.
    """
    with _lock:
        if time.time() - _state["fetched_at"] >= TTL:
            _state.update(fetched_at=time.time(), live=_refresh())
        manifest = _read_manifest()
        try:
            _digitize_new(manifest)
        except Exception:  # noqa: BLE001 -- the images still show without readings
            pass
        groups = {}
        for group, charts in manifest.items():
            groups[group] = []
            for c in charts:
                if not (CACHE_DIR / c["name"]).exists():
                    continue
                entry = dict(c)
                try:
                    dig = json.loads(_digitized_path(c["name"]).read_text())
                    if dig.get("modified") == c.get("modified"):
                        entry["digitized"] = {k: v for k, v in dig.items() if k != "modified"}
                except (OSError, ValueError):
                    pass
                groups[group].append(entry)
        series = {}
        for group in DIGITIZE_GROUPS:
            h = _read_history(group)
            if h:
                ds = sorted(h)
                series[group] = {"dates": ds, "values": [h[d]["value"] for d in ds], "px_per_day": [h[d]["px_per_day"] for d in ds]}
        starts = [c["digitized"]["dates"][0] for cs in groups.values() for c in cs if c.get("digitized", {}).get("dates")]
        try:
            benchmarks = _benchmarks(min(starts)) if starts else {}
        except Exception:  # noqa: BLE001 -- the charts still show without the comparison lines
            benchmarks = {}
        return {"groups": groups, "series": series, "benchmarks": benchmarks, "source_url": SITE_URL, "live": _state["live"]}


def read_goldman_overlay(con: duckdb.DuckDBPyConnection, history: dict[str, dict]) -> dict:
    """The Goldman Short Index playground page config: the digitized history,
    our most-shorted basket (total return, the only form it has) and the ETFs'
    split-adjusted closes (price, to compare with a price index) on the
    history's days."""
    dates = sorted(history)
    ours = dict(con.execute(
        "SELECT strftime(date, '%Y-%m-%d'), value FROM most_shorted_basket_daily WHERE date BETWEEN ?::DATE AND ?::DATE",
        [dates[0], dates[-1]]).fetchall()) if dates else {}
    return {
        "title": "Goldman Short Index Overlay",
        "heading": "Goldman Short Index overlay",
        "intro": f"Goldman's most-shorted basket, digitized from the Credit Bubble Bulletin's weekly charts since {dates[0] if dates else '—'}, vs our own basket and ETFs (price).",
        "note": "Goldman values are read off chart images: about ±0.3 points from the 34-day chart, ±2 from the year-to-date one. The history only starts with the year-to-date chart, so ranges longer than that show it all. Our basket is total return; the ETFs are price, like Goldman's index.",
        "subject": "the Goldman Short Index (digitized)",
        "sources": "market-pulse data/credit/cbb_charts/goldman_short_history.csv, most_shorted_basket_daily.value and daily_bars_adjusted.close_split_adjusted in the investment duckdb",
        "default_range": "Max",
        "dates": dates,
        "lines": [overlay_playground.line("GOLDMAN", "Goldman", [history[d]["value"] for d in dates], overlay_playground.INDEX_COLOR, True, 2.6),
                  overlay_playground.line("BASKET", "Our basket", [None if ours.get(d) is None else round(float(ours[d]), 4) for d in dates],
                                          overlay_playground.COLORS["Basket"], True),
                  *overlay_playground.etf_lines(overlay_playground.closes_on(con, dates, "close_split_adjusted"))],
    }


def goldman_overlay_page() -> str:
    """The Goldman Short Index playground HTML with the stored digitized history
    (as of the last scrape; the page does not scrape) and the latest DB data."""
    def build():
        con = duckdb.connect(str(INVESTMENT_DB), read_only=True)
        try:
            return overlay_playground.render(read_goldman_overlay(con, _read_history("goldman_short")))
        finally:
            con.close()
    history = _history_path("goldman_short")
    mtimes = (INVESTMENT_DB.stat().st_mtime, history.stat().st_mtime if history.exists() else 0)
    return overlay_playground.cached("goldman_short", mtimes, build)


def image_path(name: str) -> Path | None:
    """Stored image for ``name``, or None for an unknown or unsafe name."""
    if not NAME_RE.match(name):
        return None
    path = CACHE_DIR / name
    return path if path.is_file() else None
