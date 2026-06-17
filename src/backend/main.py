"""FastAPI backend for the market dashboard."""

import json
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.backend.tickers import crcl, charts
from src.backend import market_overview, watchlist_scraper

NEWS_BASE_PATH = Path.home() / "projects/news/data/market_news"
CFZH_PATH = Path.home() / "projects/news/data/cfzh_forum_summaries"
X_MARKET_NEWS_PATH = Path.home() / "projects/news/data/x_market_news"
TRENDSPIDER_PATH = Path.home() / "projects/news/data/trendspider"
ZHIHU_DAILY_BRIEFS_PATH = Path.home() / "projects/news/data/zhihu/daily_briefs"

app = FastAPI(title="Market Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


_overview_cache: dict = {"data": None, "timestamp": 0.0}
OVERVIEW_CACHE_TTL = 900


@app.get("/api/market/overview")
def get_market_overview(force: int = 0):
    """Get market overview with all watched tickers grouped by theme."""
    now = time.time()
    if not force and _overview_cache["data"] and now - _overview_cache["timestamp"] < OVERVIEW_CACHE_TTL:
        return _overview_cache["data"]

    scraped = watchlist_scraper.scrape_watchlist()
    sections = market_overview.build_overview(scraped)
    la_tz = ZoneInfo("America/Los_Angeles")
    updated_at = datetime.now(la_tz).strftime("%H:%M (%b %d, %Y)")

    result = {"sections": sections, "updated_at": updated_at}
    _overview_cache["data"] = result
    _overview_cache["timestamp"] = now
    return result


@app.get("/api/tickers/search")
def search_tickers(q: str = "", limit: int = 20):
    """Search the chart ticker universe by symbol."""
    return {"results": charts.search_tickers(q, limit)}


@app.get("/api/tickers/portfolio")
def get_portfolio_tickers():
    """Portfolio tickers (with company names when known) for the search dropdown."""
    names = {t["symbol"]: t["name"] for t in charts.list_tickers()}
    return {"results": [{"symbol": s, "name": names.get(s)} for s in market_overview.PORTFOLIO]}


@app.get("/api/tickers/{ticker}/weekly-chart")
def get_weekly_chart(ticker: str):
    """Weekly OHLCV + technical indicators for a ticker (full history)."""
    return charts.get_weekly_chart(ticker.upper())


@app.get("/api/tickers/{ticker}/daily-chart")
def get_daily_chart(ticker: str):
    """Daily OHLCV + technical indicators for a ticker (full history)."""
    return charts.get_daily_chart(ticker.upper())


@app.get("/api/tickers/crcl/market-cap")
def get_crcl_market_cap():
    """Get CRCL (USDC) market cap time series for the past year."""
    df = crcl.get_usdc_market_cap_1y()
    return {
        "data": [
            {
                "timestamp": row["timestamp"].isoformat(),
                "market_cap": row["market_cap"],
            }
            for _, row in df.iterrows()
        ]
    }


@app.get("/api/tickers/crcl/changes")
def get_crcl_changes():
    """Get CRCL (USDC) market cap percentage changes."""
    df = crcl.get_usdc_market_cap_1y()
    changes = crcl.compute_changes(df)

    # Get latest market cap value
    latest_market_cap = df.iloc[-1]["market_cap"] if not df.empty else None

    return {
        "latest_market_cap": latest_market_cap,
        "changes": changes,
    }


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
        articles = [json.loads(line) for line in f.read_text().splitlines() if line.strip()]
        articles.sort(key=lambda a: a.get("rank", 9999))
        briefs.append({"date": brief_date, "articles": articles})

    today_available = bool(briefs) and briefs[0]["date"] == today_la
    return {"today_available": today_available, "briefs": briefs}
