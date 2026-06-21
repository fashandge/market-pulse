# Market Pulse Architecture

## Overview

Market Pulse is a web dashboard for monitoring market and individual stock/crypto tickers. It uses a decoupled frontend/backend architecture for flexibility and scalability.

## Tech Stack Decisions

### Frontend: React + Vite + TypeScript + Tailwind CSS

**Why React + Vite over Dash/Streamlit:**
- Full control over UI layout and theming
- Scales better for complex interactions (drag-drop, animations)
- Large ecosystem of components
- Streamlit/Dash are simpler but limit customization

**Why React + Vite over htmx + Alpine.js:**
- No migration cost if UI complexity grows
- Better component composition
- htmx would require a rewrite to add rich client-side interactions

**Why Tailwind CSS v4:**
- Utility-first approach for rapid styling
- Full theming control via CSS variables
- No build step issues with Vite plugin

**Theme: Solarized Light**
- Defined in `index.css` using `@theme` directive with `--color-sol-*` variables
- Warm cream backgrounds (base3/base2), blue accents, green/red for changes
- Applied consistently across all components including Plotly charts

### Backend: FastAPI

**Why FastAPI over Flask/Django:**
- Async-native (ASGI) for better concurrency
- Auto-generates OpenAPI docs
- Type hints with Pydantic validation
- Lightweight for API-only backend

**Server: Uvicorn**
- ASGI server that runs FastAPI
- Handles network layer (ports, connections)
- `--reload` for development hot-reloading

### Charts: Plotly (react-plotly.js)

**Why Plotly:**
- Rich interactive charts out of the box
- Good time series support
- Hover tooltips, zoom, pan built-in
- Works well with React via react-plotly.js

## Data Flow

```
TradingView Watchlist                CoinMarketCap API                News Summaries + Feeds
(crawl4ai with persistent profile)        ↓                          (NDX, CFZH, X, TrendSpider, Zhihu AI)
       ↓                            FastAPI Backend (port 8000)            ↓
   watchlist_scraper.py              - Fetches data                  - Reads .md/.jsonl files
   - Scrapes ~150 tickers            - Converts UTC → LA time        - Returns summaries/posts
   - Extracts price/change/volume    - Computes changes                    ↓
       ↓                                   ↓                         React Frontend (port 5173)
   market_overview.py                React Frontend (port 5173)      - MarketView sub-tabs: TV, X, CFZH
   - Groups by theme/sector          - Filters by time range         - Markdown rendering
   - Computes avg change/vol ratio   - Renders Plotly chart
   - 15 min cache                    - Displays changes table
       ↓
   MarketOverview.tsx (Overview sub-tab of OverviewView, the default view)
   - Card grid by section
   - Clickable tickers → TradingView charts
   - Hover tooltips with volume data
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tickers/crcl/market-cap` | GET | Returns 3Y market cap time series |
| `/api/tickers/crcl/changes` | GET | Returns percentage changes |
| `/api/market/ndx-summary` | GET | Returns today's NDX/Trading View summary |
| `/api/market/cfzh-summary` | GET | Returns today's CFZH forum summary |
| `/api/market/x-summary` | GET | Returns today's X market news summary |
| `/api/market/trendspider-posts` | GET | Returns up to 50 recent TrendSpider posts (JSONL) |
| `/api/market/ai-news-brief` | GET | Returns the latest Zhihu AI news daily brief (`date`, `is_stale`, `articles[]`) from `~/projects/news/data/zhihu/daily_briefs/zhihu_brief_YYYYMMDD.jsonl` |
| `/api/market/overview` | GET | Returns market overview: tickers grouped by theme with prices, changes, volume (cached 15 min; `force=1` refreshes) |
| `/api/tickers/search` | GET | Symbol search over the chart ticker universe (`q`, `limit`) |
| `/api/tickers/portfolio` | GET | Portfolio tickers (`PORTFOLIO` in `market_overview.py`) with company names, for the search dropdown quick-picks |
| `/api/tickers/{ticker}/weekly-chart` | GET | Weekly OHLCV + indicators (full history) from `weekly_bars_adjusted` ⋈ `weekly_indicators` |
| `/api/tickers/{ticker}/daily-chart` | GET | Daily OHLCV + indicators (full history) from `daily_bars_adjusted` ⋈ `classifier_features` (10-day vol avg computed in SQL) |

## Frontend Components

```
App.tsx
├── Persists selected navigation tab in sessionStorage (per browser tab)
├── Sidebar.tsx
│   - Overview tab → OverviewView (default)
│   - Market News tab → MarketView
│   - Tickers section (collapsible)
│     └── CRCL tab → TickerView
│
├── OverviewView.tsx
│   ├── Persists selected sub-tab in sessionStorage (per browser tab)
│   ├── Sub-tabs: Overview | Charts | Trend Spider
│   ├── Overview tab → MarketOverview
│   ├── Charts tab: TickerSearch (search full duckdb universe) + TaCharts, with a
│   │   Weekly/Daily timeframe toggle (default weekly, remembered in sessionStorage)
│   └── Trend Spider tab → TrendSpiderView
│
├── MarketOverview.tsx
│   ├── Sections: Overview | Critical Themes | Other Themes
│   ├── Card grid (auto-fill, soft-shadow cards, collapsible groups)
│   ├── Ticker rows: symbol | gradient magnitude bar | %chg | price
│   ├── High-volume highlight: blue accent rail, vol ratio chip, bolder text
│   ├── Hover tooltip: volume, avg volume, vol ratio, raw change
│   └── Group headers: avg change%, avg volume ratio
│
├── MarketView.tsx
│   ├── Persists selected sub-tab in sessionStorage (per browser tab)
│   ├── Sub-tabs: Trading View | X | CFZH
│   └── Summary tabs: markdown (react-markdown + remark-gfm)
│
├── TrendSpiderView.tsx — card feed of recent TrendSpider posts
│   (/api/market/trendspider-posts) with images and timestamps
│
├── TickerSearch.tsx — debounced /api/tickers/search dropdown (symbol + name).
│   With an empty box it shows quick-picks: a "Recently searched" section
│   (localStorage `recentTickers`, excludes portfolio symbols) above an always-on
│   "Portfolio" section (/api/tickers/portfolio). Opens on any click/focus.
│
├── TaCharts.tsx — multi-pane TA charts (lightweight-charts v5) from the investment
│   duckdb, config-driven per timeframe:
│     • Weekly (/api/tickers/{t}/weekly-chart): candles+SMA 5/10/40, volume+4wk avg,
│       MACD, RSI, OBV, ROC, KDJ; ranges 1Y/2Y/5Y/Max (default 1Y).
│     • Daily (/api/tickers/{t}/daily-chart): candles+EMA 8/13/21/50 & SMA 100/150/200,
│       volume+10d avg, MACD, RSI, OBV, KDJ, CCI 20 (no ROC); ranges 3M/6M/1Y/2Y/Max
│       (default 3M).
│   Each pane shows a top-left color-coded legend (per-pane watermark) of the
│   crosshair-hovered bar's values, defaulting to the latest bar when not hovering.
│   RSI pane has a soft 30–70 band fill + dashed 30/50/70 guides; KDJ pane has
│   green/red K≥D regime bands + dashed 80/20 guides (custom lightweight-charts
│   primitives drawn behind the series)
│
└── TickerView.tsx
    ├── Header (ticker name, market cap link)
    ├── Time range toggle (YTD, 1Y, 3Y)
    ├── MarketCapChart.tsx (Plotly)
    └── Changes table
```

## Key Design Decisions

### 1. Timestamps in LA Time
- Data from CoinMarketCap is UTC
- Converted to America/Los_Angeles in backend
- Users see dates in Pacific time

### 2. Client-side Time Filtering
- Backend returns full 3Y data
- Frontend filters by YTD/1Y/3Y
- Avoids multiple API calls for different ranges

### 3. Market Cap as Link
- The market cap value links to source (CoinMarketCap)
- Cleaner than separate "Source" link

### 4. Vite Proxy for API
- Frontend dev server proxies `/api` to backend
- No CORS issues in development
- `vite.config.ts` configures proxy

## Future Considerations

### Adding New Tickers
1. Create `src/backend/tickers/{ticker}.py` with data fetching
2. Add API endpoints in `src/backend/main.py`
3. Add ticker to sidebar in `Sidebar.tsx`
4. Make TickerView generic (pass source URL as prop)

### Production Deployment
- Build frontend: `npm run build`
- Serve static files from FastAPI or nginx
- Use Gunicorn with uvicorn workers for backend
- Consider caching API responses (Redis/in-memory)
