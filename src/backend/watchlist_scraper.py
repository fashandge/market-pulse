"""Scrape TradingView watchlist for ticker prices and volume data."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

DEFAULT_PROFILE_DIR = Path.home() / ".crawl4ai" / "tradingview-profile"


def _clean_price(raw: str) -> str:
    raw = re.sub(r"USD.*|CAD.*|POINT.*|BLL.*|APZ.*", "", raw).strip()
    raw = raw.replace("−", "-").replace("‪", "").replace("‬", "")
    return raw


def _clean_pct(raw: str) -> str:
    raw = raw.replace("−", "-").replace("‪", "").replace("‬", "")
    if raw and not raw.startswith("-") and not raw.startswith("+"):
        raw = "+" + raw
    return raw


def _clean_vol(raw: str) -> str:
    if raw == "—" or not raw:
        return ""
    return raw.strip()


def _extract_formal_symbol(url_path: str, symbol: str) -> str:
    """Extract 'EXCHANGE:SYMBOL' from TradingView URL path.

    Two patterns:
      'NASDAQ-MU/'         -> 'NASDAQ:MU'
      'GOLD/?exchange=TVC' -> 'TVC:GOLD'
    """
    exchange_param = re.search(r"\?exchange=([A-Z_]+)", url_path)
    if exchange_param:
        return f"{exchange_param.group(1)}:{symbol}"
    path_match = re.match(r"([A-Z_]+)-", url_path)
    if path_match:
        return f"{path_match.group(1)}:{symbol}"
    return symbol


def _parse_pct_float(pct_str: str) -> float | None:
    try:
        return float(pct_str.replace("%", "").replace("+", ""))
    except (ValueError, AttributeError):
        return None


async def _fetch_watchlist_async(
    url: str, *, headless: bool, profile_dir: Path
) -> str:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig

    browser_config = BrowserConfig(
        headless=headless,
        user_data_dir=str(profile_dir),
        use_persistent_context=True,
        viewport_width=1920,
        viewport_height=12000,
    )
    run_config = CrawlerRunConfig(
        wait_until="domcontentloaded",
        delay_before_return_html=6.0,
    )
    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(url=url, config=run_config)
        if not result.success:
            raise RuntimeError(f"Failed to fetch {url}")
        return result.markdown or ""


def scrape_watchlist(
    url: str = "https://www.tradingview.com/watchlists/186502838/",
    *,
    headless: bool = True,
    profile_dir: Path | str | None = None,
) -> dict[str, dict]:
    """Scrape a TradingView watchlist page for ticker data.

    Returns dict keyed by symbol: {price, change_pct, change_pct_float,
    volume, avg_volume, section}.
    """
    profile_path = Path(profile_dir) if profile_dir else DEFAULT_PROFILE_DIR
    md = asyncio.run(
        _fetch_watchlist_async(url, headless=headless, profile_dir=profile_path)
    )

    lines = md.split("\n")
    result: dict[str, dict] = {}
    current_section: str | None = None

    i = 0
    while i < len(lines):
        stripped = lines[i].strip()

        if stripped in ("INDICES", "Cryto", "GOLD/SILVER", "SECTORS") or stripped.startswith("⁤"):
            current_section = stripped.replace("⁤", "").strip()
            i += 1
            continue

        ticker_match = re.search(
            r"\[([A-Z0-9!.]+)\]\(https://www\.tradingview\.com/symbols/([^)]+)\)", stripped
        )
        if ticker_match:
            symbol = ticker_match.group(1)
            url_path = ticker_match.group(2)
            formal_symbol = _extract_formal_symbol(url_path, symbol)
            vals: list[str] = []
            j = i + 1
            while j < min(i + 8, len(lines)):
                val = lines[j].strip()
                if val and not val.startswith("[") and not val.startswith("!"):
                    vals.append(val)
                if re.search(
                    r"\[([A-Z0-9!.]+)\]\(https://www\.tradingview\.com/symbols/",
                    val,
                ):
                    break
                j += 1

            price = _clean_price(vals[0]) if len(vals) >= 1 else ""
            change_pct = _clean_pct(vals[1]) if len(vals) >= 2 else ""
            change_abs = _clean_price(vals[2]) if len(vals) >= 3 else ""
            volume = _clean_vol(vals[3]) if len(vals) >= 4 else ""
            avg_volume = _clean_vol(vals[4]) if len(vals) >= 5 else ""

            if symbol in ("US10Y", "US20Y", "US30Y"):
                price = price + "%"

            result[symbol] = {
                "price": price,
                "change_pct": change_pct,
                "change_pct_float": _parse_pct_float(change_pct),
                "change_abs": change_abs,
                "volume": volume,
                "avg_volume": avg_volume,
                "formal_symbol": formal_symbol,
                "section": current_section or "UNKNOWN",
            }
        i += 1

    return result
