"""Download USDC market cap time series from CoinMarketCap."""

import requests
import pandas as pd
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

LA_TZ = ZoneInfo("America/Los_Angeles")


CMC_CHART_API = "https://api.coinmarketcap.com/data-api/v3.3/cryptocurrency/detail/chart"
USDC_ID = 3408
USD_CONVERT_ID = 2781


def fetch_usdc_market_cap(range_: str = "1Y", interval: str = "1d") -> pd.DataFrame:
    """
    Fetch USDC market cap time series from CoinMarketCap.

    Args:
        range_: Time range - "1D", "7D", "1M", "3M", "1Y", "All"
        interval: Data interval - "5m", "15m", "1h", "4h", "1d", "7d"

    Returns:
        DataFrame with columns: timestamp, price, volume, market_cap
    """
    params = {
        "id": USDC_ID,
        "interval": interval,
        "convertId": USD_CONVERT_ID,
        "range": range_,
    }

    response = requests.get(CMC_CHART_API, params=params)
    response.raise_for_status()

    data = response.json()
    points = data.get("data", {}).get("points", [])

    rows = []
    for point in points:
        ts = int(point.get("s", 0))
        v = point.get("v", [])
        if ts and len(v) >= 3:
            # Convert UTC timestamp to LA time
            utc_dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            la_dt = utc_dt.astimezone(LA_TZ)
            rows.append({
                "timestamp": la_dt,
                "price": v[0],
                "volume": v[1],
                "market_cap": v[2],
            })

    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values("timestamp").reset_index(drop=True)

    return df


def get_usdc_market_cap_1y() -> pd.DataFrame:
    """Get USDC market cap for the past 1 year with daily granularity."""
    return fetch_usdc_market_cap(range_="1Y", interval="1d")


def compute_changes(df: pd.DataFrame) -> dict:
    """
    Compute market cap percentage changes for various time periods.

    Args:
        df: DataFrame with timestamp and market_cap columns, sorted by timestamp

    Returns:
        Dict with keys: 1d, 7d, 30d, 90d, ytd and percentage change values
    """
    if df.empty:
        return {"1d": None, "7d": None, "30d": None, "90d": None, "ytd": None}

    latest = df.iloc[-1]
    latest_value = latest["market_cap"]
    latest_date = latest["timestamp"]

    changes = {}

    # Helper to find value N days ago
    def get_change(days: int) -> float | None:
        target_date = latest_date - pd.Timedelta(days=days)
        past_df = df[df["timestamp"] <= target_date]
        if past_df.empty:
            return None
        past_value = past_df.iloc[-1]["market_cap"]
        return ((latest_value - past_value) / past_value) * 100

    changes["1d"] = get_change(1)
    changes["7d"] = get_change(7)
    changes["30d"] = get_change(30)
    changes["90d"] = get_change(90)

    # YTD: from Jan 1 of current year
    year_start = pd.Timestamp(year=latest_date.year, month=1, day=1, tz=LA_TZ)
    ytd_df = df[df["timestamp"] <= year_start]
    if not ytd_df.empty:
        ytd_value = ytd_df.iloc[-1]["market_cap"]
        changes["ytd"] = ((latest_value - ytd_value) / ytd_value) * 100
    else:
        changes["ytd"] = None

    return changes


if __name__ == "__main__":
    df = get_usdc_market_cap_1y()
    print(f"Fetched {len(df)} data points")
    print(f"Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
    print(f"\nLatest data:")
    print(df.tail())
    print(f"\nMarket cap range: ${df['market_cap'].min()/1e9:.2f}B - ${df['market_cap'].max()/1e9:.2f}B")
