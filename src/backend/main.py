"""FastAPI backend for the market dashboard."""

import json
import time
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.backend.tickers import crcl
from src.backend import market_overview, watchlist_scraper

NEWS_BASE_PATH = Path.home() / "projects/news/data/market_news"
CFZH_PATH = Path.home() / "projects/news/data/cfzh_forum_summaries"
X_MARKET_NEWS_PATH = Path.home() / "projects/news/data/x_market_news"
TRENDSPIDER_PATH = Path.home() / "projects/news/data/trendspider"

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
