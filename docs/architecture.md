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
TradingView Scanner API              CoinMarketCap API                News Summaries + Feeds
(scanner.tradingview.com, JSON)           ↓                          (NDX, CFZH, X, TrendSpider, Zhihu AI)
       ↓                            FastAPI Backend (port 8000)            ↓
   quotes.py                         - Fetches data                  - Reads .md/.jsonl files
   - One batched POST, ~0.12s        - Converts UTC → LA time        - Returns summaries/posts
   - EXCHANGE:SYMBOL from ticker.csv - Computes changes                    ↓
   - Real-time via logged-in TV                            React Frontend (port 5173)
     session (tv_session.py)                            - MarketView sub-tabs: TV, X, CFZH
   - Covers ~166 symbols                                   - Markdown rendering
       ↓                                                    - Renders Plotly chart
   tv_session.py (session cookies)                         - Displays changes table
   - Reads sessionid/sessionid_sign from the crawl4ai
     profile (~2s browser launch, TTL-cached 6h);
     anonymous fallback = delayed quotes
       ↓
   watchlist_scraper.py (fallback)
   - crawl4ai scrape, ~8s
   - only ~5 licensed-feed gap
     symbols (SCANNER_UNAVAILABLE),
     via /api/market/overview/gaps
       ↓
   market_overview.py
   - Groups by theme/sector
   - Computes avg change/vol ratio
       ↓
   MarketOverview.tsx (Overview sub-tab of OverviewView, the default view)
   - Two-phase load: fast scanner tiles render instantly, gap tiles
     patched in from /gaps without blocking or flashing
   - Card grid by section; clickable tickers → TradingView charts
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
| `/api/market/overview` | GET | Returns market overview: tickers grouped by theme with prices, changes, volume. Live from the TradingView scanner API (`quotes.py`, ~0.12s, real-time when the logged-in TV session is available), merged with last-known gap values |
| `/api/market/overview/gaps` | GET | Returns the ~5 licensed-feed symbols (`SCANNER_UNAVAILABLE`) the scanner can't serve, via the watchlist scrape (~8s, TTL-cached 90s; `force=1` refreshes). Frontend fetches this after the fast tiles render |
| `/api/tickers/search` | GET | Symbol search over the chart ticker universe (`q`, `limit`) |
| `/api/tickers/portfolio` | GET | Portfolio tickers (from stock_picker's `data/portfolio.csv`, synced from the TradingView `portfolio` watchlist) with company names, for the search dropdown quick-picks |
| `/api/tickers/{ticker}/weekly-chart` | GET | Weekly OHLCV + indicators (full history) from `weekly_bars_adjusted` ⋈ `weekly_indicators` |
| `/api/tickers/{ticker}/monthly-chart` | GET | Monthly OHLCV + indicators (full history) from `monthly_bars_adjusted` ⋈ `monthly_indicators` (3-month vol avg computed in SQL) |
| `/api/tickers/{ticker}/daily-chart` | GET | Daily OHLCV + indicators (full history) from `daily_bars_adjusted` ⋈ `classifier_features` (10-day vol avg computed in SQL). Indicators listed in `_DAILY_OPTIONAL_IND_COLS` (currently `vwma_50`) are probed in `information_schema` and served as `NULL` when the duckdb snapshot predates them, so the endpoint survives the investment repo adding a feature column ahead of the nightly DB pull |
| `/api/tickers/{ticker}/pnf-chart` | GET | Point & Figure columns + boxes via the investment project's `investment.src.charts.pnf` library (high/low method; one-step-back rule on 1-box charts). Query: `since` (ISO date or past-N-calendar-days, default 365), `box` (absolute) or `box_pct` (fraction of last close, default 0.03, rounded to 1/2/2.5/5×10^k), `reversal` (3 default, 1 = Wyckoff), `end`. Each column also carries its volume, days and relative volume (column avg daily volume / 50-bar average before it), and the payload includes a volume-at-price profile per box level. Bars come from the investment duckdb (split-adjusted OHLC) with a Yahoo Finance fallback for symbols the DB lacks; 400 on bad args / no data |

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
│   │   Daily/Weekly/Monthly timeframe toggle (default weekly, remembered in sessionStorage)
│   ├── P&F tab: the same TickerSearch (shared selected ticker) + PnfChart
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
├── PnfChart.tsx — Point & Figure chart (react-plotly, Solarized) from
│   /api/tickers/{t}/pnf-chart; controls for range (3M–5Y), box size (1/2/3/5% of
│   last close or a custom value), reversal (3-box / 1-box Wyckoff) and style (X·O or
│   price-in-box); a relative-volume-per-column pane below the columns and a
│   volume-at-price profile on the right; settings persist in sessionStorage. Used by the P&F tab.
├── TickerSearch.tsx — debounced /api/tickers/search dropdown (symbol + name).
│   With an empty box it shows quick-picks: a "Recently searched" section
│   (localStorage `recentTickers`, excludes portfolio symbols) above an always-on
│   "Portfolio" section (/api/tickers/portfolio). Opens on any click/focus.
│
├── TaCharts.tsx — multi-pane TA charts (lightweight-charts v5) from the investment
│   duckdb, config-driven per timeframe:
│     • Weekly (/api/tickers/{t}/weekly-chart): candles+SMA 5/10/40, volume+4wk avg,
│       MACD, RSI, OBV, ROC 12, KDJ; ranges 1Y/2Y/5Y/Max (default 1Y).
│     • Monthly (/api/tickers/{t}/monthly-chart): candles+SMA 3/12 & EMA 21, volume+3mo
│       avg, MACD, RSI, OBV, ROC 3, KDJ; ranges 1Y/2Y/5Y/10Y/Max (default 2Y).
│     • Daily (/api/tickers/{t}/daily-chart): candles+EMA 8/13/21/50 & SMA 100/150/200
│       (dashed except SMA 200) & VWMA 50 (solid violet), volume+10d avg, MACD, RSI,
│       OBV, KDJ, CCI 20 (no ROC); ranges 3M/6M/1Y/2Y/Max (default 3M).
│   Each pane shows a top-left color-coded legend (per-pane watermark) of the
│   crosshair-hovered bar's values, defaulting to the latest bar when not hovering.
│   A price-pane MA whose column is all-NULL in the payload is drawn nowhere and
│   listed nowhere: `visibleMas()` filters the config's `mas` list to specs with at
│   least one value, so an indicator the duckdb snapshot does not carry yet simply
│   appears — line and legend entry — once the column lands.
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

## Market Overview Data Sourcing (ticker.csv + TradingView scanner)

Market Overview loads ticker groups from `~/projects/stock_picker/data/ticker.csv` at runtime. To add/reorder tickers within a theme, edit the CSV (`theme`, `display_order` columns).

- The CSV's `exchange` column is the single source of truth for the scanner fetch: `quotes.py` builds each scanner symbol as `EXCHANGE:SYMBOL`, so `exchange` must be the value TradingView's scanner indexes (US ETFs use `AMEX`/`NASDAQ`/`CBOE`; index/crypto/futures use TradingView feed names like `TVC`/`CRYPTO`/`CME_MINI`).
- **Real-time vs delayed quotes.** Anonymous calls to `scanner.tradingview.com/global/scan` serve *delayed* quotes for US equities (minutes old on fast movers — measured ~$2-4 behind the live tape on AMD). The same endpoint returns real-time data when called with the logged-in TradingView session cookies (`sessionid` + `sessionid_sign`), which `tv_session.py` reads from the crawl4ai browser profile (`~/.crawl4ai/tradingview-profile`, already logged in) via a short headless playwright launch, TTL-cached for 6h. If the session is unavailable (profile locked mid-scrape, not logged in, browser error) `quotes.py` falls back to the anonymous endpoint — same response shape, just delayed. The first request after a server restart pays the ~2s browser launch; subsequent ones stay at ~0.1s.
- A symbol with no free scanner data is listed in `SCANNER_UNAVAILABLE` in `quotes.py` and served from the crawl4ai watchlist scrape (`watchlist_scraper.py`) instead.
- Curated section/group ordering lives in `SECTIONS` in `market_overview.py`; new CSV themes not listed there are automatically appended to `Other Themes`. To drop a theme from the dashboard without removing it from the CSV (which stock_picker shares), delete it from `SECTIONS` *and* add it to `HIDDEN_GROUPS` — otherwise the auto-append would put it back under `Other Themes`. `Other ETFs` is hidden this way.
- Tickers may appear in multiple themes (e.g., NVDA in both Big Tech and AI Chips & Foundry).
- The `Portfolio` section (shown just below `Overview`) is the exception: it is not sourced from the CSV at all — see below.

## Portfolio Section Data Sourcing (stock_picker `data/portfolio.csv`)

The `Portfolio` section mirrors the TradingView watchlist named **`portfolio`**; holdings are edited in TradingView and never in code. `tv_watchlist.py` (stock_picker) is the single implementation of "read/write a TV watchlist" and mirrors every actual watchlist change into `~/projects/stock_picker/data/portfolio.csv`, which `portfolio.py` reads per request (`load_holdings` / `load_symbols`).
- **No Chrome, no cache, no TTL** — the CSV is a plain file read on every request (sub-10ms), so the dashboard picks up a script-driven watchlist change on the next page load. A manual edit on the TradingView website goes stale until the next script-driven change or `tv_watchlist.py --sync-portfolio-csv`.
- **Benchmarks are filtered out at sync time.** The watchlist also carries NDX / QQQ / SPX / SMH / SOXX for comparison. The mirror drops a symbol by *instrument type* from TradingView's scanner (`type` column, via the same `https://scanner.tradingview.com/global/scan` POST the quote fetches use): `index`, `fund` (ETFs), `futures`, `spot`, `commodity`, `forex`, `bond`, `economic`. The filter is a **drop-list, not a keep-list**, because ADRs classify as `dr` rather than `stock` (TSM, ARM, SKHY) — a holding is better shown as a dashed tile than silently omitted. `ticker.csv`'s `ticker_type` is the fallback when the scanner returns no type.
- **CSV columns** — `ticker,exchange,ticker_type`, rows in watchlist order (so the section ordering matches the watchlist). `exchange` is the TradingView scanner prefix used to build `EXCHANGE:TICKER` quotes.
- Holdings not yet mirrored into `ticker.csv` still get quotes: `main.py` passes them to `quotes.fetch_covered_quotes(extra=...)` using the exchange from the CSV.
- A missing/unreadable CSV yields an empty holdings list, which omits the section rather than falling back to a guess.

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
