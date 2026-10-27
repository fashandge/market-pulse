"""FastAPI backend for the market dashboard."""

import ipaddress
import json
import re
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from news.src.catalyst_calendar import calendar_note
from news.src.catalyst_calendar import state as catalyst_state
from src.backend.tickers import charts, pnf
from src.backend import breadth, cbb_charts, credit, estimates, most_shorted, overview_cache, portfolio, proposal_log

NEWS_BASE_PATH = Path.home() / "projects/news/data/market_news"
CFZH_PATH = Path.home() / "projects/news/data/cfzh_forum_summaries"
X_MARKET_NEWS_PATH = Path.home() / "projects/news/data/x_market_news"
TRENDSPIDER_PATH = Path.home() / "projects/news/data/trendspider"
ZHIHU_DAILY_BRIEFS_PATH = Path.home() / "projects/news/data/zhihu/daily_briefs"
SIGNAL_DIGEST_RUNS_PATH = Path.home() / "projects/news/data/signal_digest/runs"
CATALYST_EVENTS_PATH = catalyst_state.CALENDAR_NOTE  # a wiki note in the Obsidian vault
# Render order of the Events tab.
CATALYST_CATEGORIES = catalyst_state.CATEGORIES
# signal_digest names runs YYYYMMDD_HHMM, suffixed _2, _3… on collision; other
# suffixes (e.g. _jev, _nofilter) are manual experiments and are skipped.
SIGNAL_DIGEST_RUN_RE = re.compile(r"^(\d{8})_(\d{4})(?:_(\d+))?$")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Keep the market-overview snapshot warm for the whole server lifetime, so
    a page load never pays for the quote fetch (see ``overview_cache``)."""
    overview_cache.start()
    yield
    overview_cache.stop()


app = FastAPI(title="Market Dashboard API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/market/overview")
def get_market_overview(force: int = 0):
    """Market overview sections. Served from the background-refreshed snapshot
    (``overview_cache``), so this is a no-I/O response in the normal case;
    ``force=1`` (the UI's refresh button) always fetches live."""
    return overview_cache.get_overview(force=bool(force))


@app.get("/api/market/breadth")
def get_market_breadth():
    """Full-history S&P 500 / Nasdaq-100 breadth with SPY and QQQ closes
    (columnar, from the investment duckdb) for the Overview Breadth tab."""
    return breadth.get_breadth()


@app.get("/api/market/credit")
def get_market_credit():
    """Credit-stress history for the Overview Credit tab: credit spreads, Fed
    stress indexes, repo funding pressure, euro sovereign spreads and MOVE
    (investment duckdb credit_series_daily), plus credit-ETF, lender and
    AI-borrower closes."""
    return credit.get_credit()


@app.get("/api/market/credit/most-shorted")
def get_most_shorted_basket():
    """Free stand-in for Goldman's most-shorted basket: the daily index and
    current members, read from the investment duckdb (built nightly there
    from FINRA short interest and SEC shares outstanding)."""
    return most_shorted.get_most_shorted()


@app.get("/api/market/credit/most-shorted/overlay", response_class=HTMLResponse)
def get_most_shorted_overlay():
    """Overlay playground for the Credit tab's most-shorted chart: the basket
    against QQQ, SPY, SMH and SOXX with SMA/EMA smoothing and range controls
    (overlay_playground), opened in its own browser tab with the latest data."""
    return HTMLResponse(most_shorted.overlay_page(), headers={"Cache-Control": "no-cache"})


@app.get("/api/market/credit/goldman-short/overlay", response_class=HTMLResponse)
def get_goldman_short_overlay():
    """Overlay playground for the Credit tab's digitized Goldman Short Index:
    the stored daily history against our most-shorted basket and QQQ, SPY, SMH
    and SOXX, opened in its own browser tab."""
    return HTMLResponse(cbb_charts.goldman_overlay_page(), headers={"Cache-Control": "no-cache"})


@app.get("/api/market/credit/cbb-charts")
def get_cbb_charts():
    """Bloomberg-sourced chart images scraped from the Credit Bubble Bulletin for
    the Credit tab, by group (goldman_short, oracle, meta): names, labels and
    Last-Modified dates of the stored images."""
    return cbb_charts.list_charts()


@app.get("/api/market/credit/cbb-charts/{name}")
def get_cbb_chart_image(name: str):
    """One stored Credit Bubble Bulletin chart image."""
    path = cbb_charts.image_path(name)
    if path is None:
        raise HTTPException(status_code=404, detail=f"No stored chart named {name!r}")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-cache"})


@app.get("/api/market/estimates")
def get_market_estimates():
    """Cached analyst estimates (consensus by fiscal year, price targets,
    rating changes) for every ticker stock_picker's fetch_estimates.py has
    been run on, portfolio holdings first, for the Overview Estimates tab."""
    return estimates.load_estimates()


@app.get("/api/market/estimates/prices")
def get_market_estimate_prices():
    """Live TradingView price of every cached estimates ticker, which the
    Estimates tab fetches on open to update price, target gap and price ÷ EPS
    on screen. The cache files keep their fetch-time price."""
    return estimates.live_prices()


@app.post("/api/market/estimates/{ticker}")
def fetch_market_estimates(ticker: str):
    """One ticker's estimates for the Estimates tab's search box: the cache
    file when it is under an hour old, otherwise a live fetch (about two
    seconds) that also writes the cache. 404 for a symbol outside the chart
    universe, 429 when the hourly fetch budget is spent, 502 when a source
    refused or has no estimates for it (ETFs, for instance)."""
    try:
        return estimates.get_or_fetch(ticker)
    except estimates.UnknownTicker:
        raise HTTPException(status_code=404, detail=f"{ticker.upper()} is not a known ticker")
    except estimates.RateLimited as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except estimates.FetchFailed as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/tickers/search")
def search_tickers(q: str = "", limit: int = 20):
    """Search the chart ticker universe by symbol."""
    return {"results": charts.search_tickers(q, limit)}


@app.get("/api/tickers/portfolio")
def get_portfolio_tickers():
    """Portfolio tickers (with company names when known) for the search dropdown."""
    names = {t["symbol"]: t["name"] for t in charts.list_tickers()}
    return {"results": [
        {"symbol": s, "name": names.get(s)} for s in portfolio.load_symbols()
    ]}


@app.get("/api/tickers/{ticker}/weekly-chart")
def get_weekly_chart(ticker: str):
    """Weekly OHLCV + technical indicators for a ticker (full history)."""
    return charts.get_weekly_chart(ticker.upper())


@app.get("/api/tickers/{ticker}/monthly-chart")
def get_monthly_chart(ticker: str):
    """Monthly OHLCV + technical indicators for a ticker (full history)."""
    return charts.get_monthly_chart(ticker.upper())


@app.get("/api/tickers/{ticker}/daily-chart")
def get_daily_chart(ticker: str):
    """Daily OHLCV + technical indicators for a ticker (full history)."""
    return charts.get_daily_chart(ticker.upper())


@app.get("/api/tickers/{ticker}/pnf-chart")
def get_pnf_chart(
    ticker: str,
    since: str = "365",
    box: float | None = None,
    box_pct: float | None = None,
    reversal: int = 3,
    end: str | None = None,
):
    """Point & Figure columns/boxes (investment P&F library; duckdb bars with a
    Yahoo fallback). ``since`` = ISO date or past-N-calendar-days; ``box`` or
    ``box_pct`` (default 3% of last close) sets the box size; ``reversal`` 1|3."""
    try:
        return pnf.get_pnf_chart(ticker.upper(), since, box, box_pct, reversal, end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/market/ndx-summary")
def get_ndx_summary():
    """Get the latest NDX news summary for today."""
    today = date.today()
    date_str = today.strftime("%Y%m%d")
    formatted_date = today.strftime("%B %d, %Y")

    summary_dir = NEWS_BASE_PATH / "ndx" / date_str / "summary"

    if not summary_dir.exists():
        return {"date": formatted_date, "content": None}

    md_files = sorted(summary_dir.glob("*.md"), reverse=True)
    if not md_files:
        return {"date": formatted_date, "content": None}

    content = md_files[0].read_text()
    return {"date": formatted_date, "content": content}


@app.get("/api/market/cfzh-summary")
def get_cfzh_summary():
    """Get the latest CFZH forum summary for today."""
    today = date.today()
    date_str = today.strftime("%Y%m%d")
    formatted_date = today.strftime("%B %d, %Y")

    pattern = f"cfzh_summary_{date_str}_*.md"
    md_files = sorted(CFZH_PATH.glob(pattern), reverse=True)

    if not md_files:
        return {"date": formatted_date, "content": None}

    latest = md_files[0]
    content = latest.read_text()
    time_part = latest.stem.split("_")[-1]
    generated_time = f"{time_part[:2]}:{time_part[2:]}"
    content = f"Generated {generated_time} ({formatted_date})\n\n{content}"
    return {"date": formatted_date, "content": content}


@app.get("/api/market/cfzh-summaries")
def get_cfzh_summaries():
    """Get the latest CFZH forum summary for today and the previous 3 days."""
    today = date.today()
    summaries = []
    for days_ago in range(4):
        d = today - timedelta(days=days_ago)
        date_str = d.strftime("%Y%m%d")
        formatted_date = d.strftime("%B %d, %Y")
        pattern = f"cfzh_summary_{date_str}_*.md"
        md_files = sorted(CFZH_PATH.glob(pattern), reverse=True)
        if not md_files:
            summaries.append({"date": formatted_date, "content": None})
            continue
        latest = md_files[0]
        content = latest.read_text()
        time_part = latest.stem.split("_")[-1]
        generated_time = f"{time_part[:2]}:{time_part[2:]}"
        content = f"Generated {generated_time} ({formatted_date})\n\n{content}"
        summaries.append({"date": formatted_date, "content": content})
    return {"summaries": summaries}


def _split_signal_report(text: str) -> tuple[str, str]:
    """Return (body without the leading ``# Signal digest`` title, verdict line).

    The verdict previews a folded run: the first line of prose after the title,
    skipping headings, blockquotes (the fallback-agent notice) and bare bold
    labels such as ``**Investing**``, with list markers and markdown stripped.
    """
    lines = text.split("\n")
    body_start = 0
    for i, line in enumerate(lines):
        if line.strip():
            if line.startswith("# "):
                body_start = i + 1
            break
    body = "\n".join(lines[body_start:]).strip()
    verdict = ""
    for line in body.split("\n"):
        line = line.strip()
        if not line or line.startswith((">", "#")) or re.fullmatch(r"\*\*[^*]+\*\*:?", line):
            continue
        line = re.sub(r"^(?:[-*+]|\d+\.)\s+", "", line)
        line = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", line)
        verdict = line.replace("**", "").replace("`", "")
        break
    return body, verdict


LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]"}


def _is_loopback(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.strip())
    except ValueError:
        return False
    return ip.is_loopback or bool(getattr(ip, "ipv4_mapped", None) and ip.ipv4_mapped.is_loopback)


def is_local_request(request: Request) -> bool:
    """True only for a browser on this machine (http://localhost:5173 or 127.0.0.1).

    The client IP alone proves nothing: every request arrives from 127.0.0.1
    through the Vite proxy, whether it came from this Mac, a Wi-Fi device or a
    tunnel. The proxy (``xfwd``) appends the real client address to
    X-Forwarded-For, so every hop listed there must be loopback too; a device
    can add fake entries but not remove its own. The Host must also be local,
    which also refuses a Wi-Fi device should the proxy ever stop adding the
    header. Fails closed on anything unexpected.
    """
    host = request.headers.get("host", "").rsplit(":", 1)[0]
    hops = [request.client.host if request.client else ""]
    if "x-forwarded-for" in request.headers:
        hops += request.headers["x-forwarded-for"].split(",")
    return host in LOCAL_HOSTS and all(_is_loopback(hop) for hop in hops)


def _require_local(request: Request) -> None:
    if not is_local_request(request):
        raise HTTPException(status_code=403, detail="proposal logging is only available from this machine")


def load_signal_digests(runs_path: Path, today: date, days: int = 4,
                        jobs_dir: Path = proposal_log.JOBS_DIR,
                        include_proposals: bool = True) -> list[dict]:
    """Every signal-digest run with a report, grouped by day, for ``today`` and
    the previous days. Without ``include_proposals`` (a remote viewer) runs carry
    no ``proposals``/``log_job`` and keep the report's plain "Proposed log" list.

    Days without a report are omitted, so at most ``days`` entries come back,
    newest first; each day's ``runs`` are newest first too.
    """
    wanted = {(today - timedelta(days=i)).strftime("%Y%m%d") for i in range(days)}
    by_day: dict[str, list[tuple[tuple[str, int], Path]]] = {}
    if runs_path.exists():
        for run in runs_path.iterdir():
            m = SIGNAL_DIGEST_RUN_RE.match(run.name)
            if not m or m.group(1) not in wanted or not (run / "report.md").is_file():
                continue
            by_day.setdefault(m.group(1), []).append(((m.group(2), int(m.group(3) or 1)), run))

    summaries = []
    for day in sorted(by_day, reverse=True):
        formatted_date = datetime.strptime(day, "%Y%m%d").strftime("%B %d, %Y")
        runs = []
        for (hhmm, _), run in sorted(by_day[day], reverse=True):
            body, verdict = _split_signal_report((run / "report.md").read_text())
            proposals = []
            if include_proposals and (run / "proposed_log.json").is_file():
                # The checkbox panel replaces the report's numbered "Proposed log" list.
                trimmed, labels = proposal_log.split_proposed_log_section(body)
                proposals = proposal_log.proposals(run, labels)
                if proposals:
                    body = trimmed
            runs.append({"run_id": run.name, "time": f"{hhmm[:2]}:{hhmm[2:]}",
                         "verdict": verdict, "content": body, "proposals": proposals,
                         "log_job": proposal_log.latest_job(run.name, jobs_dir) if proposals else None})
        summaries.append({"date": formatted_date, "content": None, "runs": runs})
    return summaries


@app.get("/api/market/signal-digests")
def get_signal_digests(request: Request):
    """Get every signal-digest run for today and each of the previous 3 days, grouped by day.
    The proposal-log panel's data is served only to a browser on this machine."""
    today = datetime.now(ZoneInfo("America/Los_Angeles")).date()
    return {"summaries": load_signal_digests(SIGNAL_DIGEST_RUNS_PATH, today,
                                             include_proposals=is_local_request(request))}


def _signal_digest_run_dir(run_id: str) -> Path:
    run = SIGNAL_DIGEST_RUNS_PATH / run_id
    if not SIGNAL_DIGEST_RUN_RE.match(run_id) or not run.is_dir():
        raise HTTPException(status_code=404, detail=f"no signal-digest run {run_id}")
    return run


class LogProposalsRequest(BaseModel):
    only: list[int]
    instructions: str = ""  # free-text extra guidance and sources for the agent


@app.post("/api/market/signal-digests/{run_id}/log-proposals")
def log_signal_digest_proposals(run_id: str, request: LogProposalsRequest, http_request: Request):
    """Apply the selected (1-based) proposals of the run's proposed_log.json via a
    headless ``claude -p`` running stock_picker's /portfolio-brief skill, with the
    user's free-text ``instructions`` added to its prompt. Returns the job status
    at once; poll the GET below. 403 unless the request comes from a browser on
    this machine (never through the tunnel), 400 for a bad selection, 409 while
    an earlier job for the run is still running."""
    _require_local(http_request)
    run = _signal_digest_run_dir(run_id)
    try:
        return proposal_log.start(run, request.only, instructions=request.instructions)
    except proposal_log.InvalidSelection as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except proposal_log.AlreadyRunning as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.get("/api/market/signal-digests/{run_id}/log-proposals")
def get_signal_digest_log_job(run_id: str, request: Request):
    """The run's latest proposal-log job (``state``: running/done/failed/lost), or
    null. 403 unless the request comes from this machine."""
    _require_local(request)
    return proposal_log.latest_job(_signal_digest_run_dir(run_id).name)


@app.get("/api/market/x-summary")
def get_x_summary():
    """Get the latest X market news summary for today."""
    today = date.today()
    date_str = today.strftime("%Y%m%d")
    formatted_date = today.strftime("%B %d, %Y")

    pattern = f"x_market_news_{date_str}_*.md"
    md_files = sorted(X_MARKET_NEWS_PATH.glob(pattern), reverse=True)

    if not md_files:
        return {"date": formatted_date, "content": None}

    content = md_files[0].read_text()
    return {"date": formatted_date, "content": content}


EASTERN_TIME = re.compile(r"(\d{1,2}):(\d{2})\s*(?:ET|EST|EDT)", re.IGNORECASE)


def eastern_to_la(day: date, time_text: str) -> tuple[date, str]:
    """Convert an ``HH:MM ET`` catalyst time to LA time, e.g. ``08:30 ET`` -> ``05:30 PT``.

    The zone math handles DST on either coast, and a late-night ET time can move
    the event to the previous LA day. Other time text is returned unchanged.
    """
    match = EASTERN_TIME.fullmatch(time_text)
    if not match:
        return day, time_text
    hour, minute = int(match[1]), int(match[2])
    eastern = datetime(day.year, day.month, day.day, hour, minute, tzinfo=ZoneInfo("America/New_York"))
    local = eastern.astimezone(ZoneInfo("America/Los_Angeles"))
    return local.date(), local.strftime("%H:%M PT")


def load_catalyst_events(path: Path, today: date) -> list[dict]:
    """Catalyst-calendar rows dated ``today`` or later, soonest first.

    ``when`` is ``YYYY-MM-DD`` optionally followed by a time; it is split into
    ``date`` and ``time``, with ET times converted to LA time; ``critical`` marks the few events the news project's
    agent judged able to move the whole market. Past rows are dropped here too, so the tab stays right
    between the news project's twice-daily refreshes.
    """
    events = []
    for row in calendar_note.load_rows(path):
        when = (row.get("when") or "").strip()
        try:
            day = date.fromisoformat(when[:10])
        except ValueError:
            continue
        day, time_text = eastern_to_la(day, when[10:].strip())
        if day < today:
            continue
        category = row.get("category", "")
        events.append({
            "category": category if category in CATALYST_CATEGORIES else catalyst_state.FALLBACK_CATEGORY,
            "date": day.isoformat(),
            "time": time_text,
            "days_away": (day - today).days,
            "critical": row.get("importance") == "critical",
            "catalyst": row.get("catalyst", ""),
            "why_it_matters": row.get("why_it_matters", ""),
            "first_seen": row.get("first_seen", ""),
        })
    events.sort(key=lambda e: (e["date"], CATALYST_CATEGORIES.index(e["category"]), e["time"]))
    return events


@app.get("/api/market/events")
def get_catalyst_events():
    """Upcoming catalysts from the news project's catalyst calendar."""
    today = datetime.now(ZoneInfo("America/Los_Angeles")).date()
    updated = None
    if CATALYST_EVENTS_PATH.exists():
        mtime = datetime.fromtimestamp(CATALYST_EVENTS_PATH.stat().st_mtime, ZoneInfo("America/Los_Angeles"))
        updated = mtime.strftime("%b %d, %H:%M")
    return {
        "today": today.isoformat(),
        "updated": updated,
        "categories": list(CATALYST_CATEGORIES),
        "events": load_catalyst_events(CATALYST_EVENTS_PATH, today),
    }


@app.get("/api/market/trendspider-posts")
def get_trendspider_posts():
    """Get recent TrendSpider posts filtered to watchlist tickers."""
    max_posts = 50
    posts = []
    jsonl_files = sorted(TRENDSPIDER_PATH.glob("trendspider_*.jsonl"), reverse=True)

    for jsonl_file in jsonl_files:
        for line in jsonl_file.read_text().strip().split("\n"):
            if line:
                post = json.loads(line)
                posts.append(post)
        if len(posts) >= max_posts:
            break

    posts.sort(key=lambda p: p.get("t", ""), reverse=True)
    posts = posts[:max_posts]

    for post in posts:
        post.pop("id", None)

    return {"posts": posts}


@app.get("/api/market/china-news")
def get_china_news(region: str = "china"):
    """Get the latest available daily summary for China A-share or Hong Kong markets.

    Returns the most recent day's summary. ``is_today`` is False when today's
    summary has not been generated yet, so the frontend can show a warning.
    """
    folder = "hk" if region == "hk" else "china"
    base = NEWS_BASE_PATH / folder

    date_dirs = (
        sorted((d for d in base.glob("*") if d.is_dir() and d.name.isdigit()), reverse=True)
        if base.exists()
        else []
    )
    if not date_dirs:
        return {"region": region, "date": None, "is_today": False, "content": None}

    latest_dir = date_dirs[0]
    news_date = datetime.strptime(latest_dir.name, "%Y%m%d").date()
    formatted_date = news_date.strftime("%B %d, %Y")
    is_today = news_date == date.today()

    summary_dir = latest_dir / "summary"
    md_files = sorted(summary_dir.glob("*.md"), reverse=True) if summary_dir.exists() else []
    content = md_files[0].read_text() if md_files else None

    return {
        "region": region,
        "date": formatted_date,
        "is_today": is_today,
        "content": content,
    }


@app.get("/api/market/ai-news-briefs")
def get_ai_news_briefs():
    """Return the past 7 days of Zhihu AI news daily briefs."""
    files = sorted(ZHIHU_DAILY_BRIEFS_PATH.glob("zhihu_brief_*.jsonl"), reverse=True)[:7]
    today_la = datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat()

    briefs = []
    for f in files:
        date_str = f.stem.split("_")[-1]
        brief_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
        # Not splitlines(): bodies are written with ensure_ascii=False, so U+2028 etc. occur raw.
        articles = [json.loads(line) for line in f.read_text().split("\n") if line.strip()]
        for article in articles:
            # The full article text (for signal_digest) is not shown in the tab.
            article.pop("body", None)
        articles.sort(key=lambda a: a.get("rank", 9999))
        briefs.append({"date": brief_date, "articles": articles})

    today_available = bool(briefs) and briefs[0]["date"] == today_la
    return {"today_available": today_available, "briefs": briefs}
