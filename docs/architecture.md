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
- Layering by tone, not shadow: page base3, cards `--color-sol-card` (#f7f0dc), sidebar `--color-sol-rail`, hairline `--line`/`--line-strong` borders (translucent base02); nothing brighter than base3
- Text never uses the stock accents or base1, which are 2.3-4:1 on cream: muted text is base00, and accent *text* uses darkened inks that clear ~4.5:1 on cards — `sol-up` #46701a / `sol-down` #a8362b (price changes), `sol-link` #17598a, `sol-plum` #9c2a63, `sol-amber` #7a5c00. Stock hues stay for borders, tints, bars and chart lines
- Shared component classes in `index.css` (`@layer components`): `.mp-tabs`/`.mp-tab` (via `Tabs.tsx`), `.mp-segment` (toggle groups; selected button carries `aria-pressed`), `.mp-card`, `.mp-fold` (collapsible day `<details>`), `.mp-notice`, `.mp-state` (via `StatusMessage.tsx`), `.mp-chevron` (via `Chevron.tsx`)
- Markdown summaries (Market News tabs, China news) use the shared `.summary-prose` class: body/headings in base02 (~12:1 contrast) instead of the lighter base00/base01 greys (~4-5:1), links darkened to `#17598a` and underlined, inline code without the cyan tint or backticks
- `.summary-prose` text uses "Atkinson Hyperlegible Reading", a self-hosted Latin-only copy (`public/fonts/`) with `size-adjust: 115%`: English renders ~20px while Chinese falls back to the system CJK font at its normal size

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
TradingView Scanner API                                               News Summaries + Feeds
(scanner.tradingview.com, JSON)                                       (NDX, CFZH, X, signal digest, TrendSpider, Zhihu AI)
       ↓                                                                   ↓
   quotes.py                                                         - Reads .md/.jsonl files
   - One batched POST, ~1s                                           - Returns summaries/posts
   - EXCHANGE:SYMBOL from ticker.csv                                       ↓
   - Real-time via logged-in TV                            React Frontend (port 5173)
     session (tv_session.py)                            - MarketView sub-tabs: TV, X, CFZH, General
   - Covers ~170 symbols                                   - Markdown rendering
       ↓
   tv_session.py (session cookies)
   - Reads sessionid/sessionid_sign from the crawl4ai
     profile (~3s browser launch, TTL-cached 6h);
     anonymous fallback = delayed quotes
       ↓
   vol_indices.py (the 5 symbols the scanner won't serve)
   - VIX3M/GVZ/VXSLV from CBOE's delayed-quotes JSON
   - DVOL/ETHDVOL from Deribit's volatility-index API
   - fetched concurrently with the scanner batch by
     quotes.fetch_all_quotes(), TTL 60s
       ↓
   market_overview.py
   - Groups by theme/sector
   - Computes avg change/vol ratio
       ↓
   overview_cache.py (background snapshot)
   - Daemon thread rebuilds the whole payload every 5s while
     someone is watching, 30s when idle
   - /api/market/overview serves it with no network I/O (~5ms)
       ↓
   MarketOverview.tsx (Overview sub-tab of OverviewView, the default view)
   - One request, no second phase: every tile is in the first payload
   - Polls every 5s while the browser tab is visible
   - Card grid by section; clickable tickers → TradingView charts
   - Hover tooltips with volume data
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/market/ndx-summary` | GET | Returns today's NDX/Trading View summary |
| `/api/market/cfzh-summary` | GET | Returns today's CFZH forum summary |
| `/api/market/x-summary` | GET | Returns today's X market news summary |
| `/api/market/events` | GET | Returns `today`, `updated` (note mtime, LA time), `categories` (render order: macro, special, earnings; an unknown category is served as special, the catch-all) and `events[]` (`category`, `date`, `time`, `days_away`, `critical`, `catalyst`, `why_it_matters`, `first_seen`), soonest first; `critical` is true when the row's `importance` is `critical` (the news agent's judgment that the event could move SPY/QQQ a lot given the current backdrop), past rows dropped. Reads the news project's catalyst calendar, the wiki note `~/notes/wiki/Investment/Watch/Catalyst Calendar.md`, via `news.src.catalyst_calendar.calendar_note.load_rows` |
| `/api/market/signal-digests` | GET | Returns `summaries[]` (`date`, `runs[]`): every signal-digest run with a `report.md`, grouped by day, for today + the previous 3 days (LA time), days without a report omitted; days and runs newest first. Each run has `run_id`, `time` (HH:MM from the dir name), `verdict` (first prose line, the folded-run preview) and `content` (the report minus its `# Signal digest` title). Reads `~/projects/news/data/signal_digest/runs/<YYYYMMDD_HHMM[_N]>/report.md`; experiment runs with other suffixes (`_jev`, `_nofilter`) are skipped. A run with a `proposed_log.json` also carries `proposals[]` (`n`, `label`; labels from the report's numbered `## Proposed log` list, which is then cut from `content`) and `log_job` (latest log job, see below, or null) |
| `/api/market/signal-digests/{run_id}/log-proposals` | POST | Body `{"only": [1, 3]}` (1-based proposal numbers). Starts a headless `claude -p --model opus --effort high` (no MCP, bypassPermissions, 45-min timeout) in `~/projects/stock_picker` as a background process via the agents project's `coding_agents_cli.run_background` that runs `/portfolio-brief` to apply those proposals (`apply-proposals --only`); returns the job status at once. 400 for a bad selection, 409 while the run's previous job is still running, 404 for an unknown run (`proposal_log.py`) |
| `/api/market/signal-digests/{run_id}/log-proposals` | GET | The run's latest log job or null: `job_id`, `only`, `started`, `state` (`running`, `done`, `failed`, or `lost` = process gone without an exit code), `output` (the agent's final reply), `error` (stderr tail). Jobs live as files under `tmp/proposal_logs/`: `<job>.json` holds the selection, and `run_background` writes `.out`, `.err`, `.pid` and, last, `.exitcode`. They are read back with `coding_agents_cli.detached_status`, so status survives a backend restart |
| `/api/market/trendspider-posts` | GET | Returns up to 50 recent TrendSpider posts (JSONL) |
| `/api/market/ai-news-brief` | GET | Returns the latest Zhihu AI news daily brief (`date`, `is_stale`, `articles[]`) from `~/projects/news/data/zhihu/daily_briefs/zhihu_brief_YYYYMMDD.jsonl` |
| `/api/market/overview` | GET | Returns market overview: tickers grouped by theme with prices, changes, volume, plus `age_seconds` (how old the served snapshot is). Served from `overview_cache`'s background-refreshed snapshot, so the normal response does **no** network I/O (~5ms); it fetches synchronously only when the snapshot is older than `MAX_SERVE_AGE` or `force=1` is passed (~0.9s) |
| `/api/market/breadth` | GET | Full-history S&P 500 / Nasdaq-100 breadth (% of members above 20/50/200-day SMA, net new 52-week highs, advancers − decliners) with SPY/QQQ adjusted closes and 5-week distribution-day counts, columnar (`dates` + one array per series), read-only from the investment duckdb (`breadth.py`); cached on the DB file's mtime |
| `/api/market/estimates` | GET | Analyst estimates for every ticker with a cache file in `~/projects/stock_picker/data/estimates/` (`estimates.py`): per ticker, consensus EPS and revenue by fiscal year, price, mean target, mean rating, the stockanalysis.com cross-check and the rating-change log, passed through unchanged plus `in_portfolio`. Holdings first in watchlist order, then the rest alphabetically; files that are not valid or lack required fields are named in `unreadable`. A plain per-request folder read — no network, no cache |
| `/api/market/estimates/prices` | GET | Live price of every cached estimates ticker (`estimates.live_prices`): one TradingView `america/scan` request filtered on the bare `name` column (`quotes.fetch_us_prices`), so no exchange is needed for tickers outside `ticker.csv`. Returns `{prices: {ticker: {price, delay, formal_symbol}}, error}`; a scanner failure is an `error` string with no prices. Never writes the cache files |
| `/api/market/estimates/{ticker}` | POST | One ticker's estimates for the Estimates tab's search box and Refresh link: the cache file when it is under an hour old, otherwise a live fetch through stock_picker's `fetch_estimates.fetch_ticker` (three outbound requests, ~2s) that also writes the cache. Bounded because the tunnel has no auth: 404 unless the symbol is in the chart ticker universe, 429 past 30 fetches an hour (one at a time), 502 when a source refuses or has no estimates (ETFs) |
| `/api/tickers/search` | GET | Symbol search over the chart ticker universe (`q`, `limit`) |
| `/api/tickers/portfolio` | GET | Portfolio tickers (from stock_picker's `data/portfolio.csv`, synced from the TradingView `portfolio` watchlist) with company names, for the search dropdown quick-picks |
| `/api/tickers/{ticker}/weekly-chart` | GET | Weekly OHLCV + indicators (full history) from `weekly_bars_adjusted` ⋈ `weekly_indicators` |
| `/api/tickers/{ticker}/monthly-chart` | GET | Monthly OHLCV + indicators (full history) from `monthly_bars_adjusted` ⋈ `monthly_indicators` (3-month vol avg computed in SQL) |
| `/api/tickers/{ticker}/daily-chart` | GET | Daily OHLCV + indicators (full history) from `daily_bars_adjusted` ⋈ `classifier_features` (10-day vol avg computed in SQL). Indicators listed in `_DAILY_OPTIONAL_IND_COLS` (currently `vwma_50`) are probed in `information_schema` and served as `NULL` when the duckdb snapshot predates them, so the endpoint survives the investment repo adding a feature column ahead of the nightly DB pull |
| `/api/tickers/{ticker}/pnf-chart` | GET | Point & Figure columns + boxes via the investment project's `investment.src.charts.pnf` library (high/low method; one-step-back rule on 1-box charts). Query: `since` (ISO date or past-N-calendar-days, default 365), `box` (absolute) or `box_pct` (fraction of last close, default 0.03, rounded to 1/2/2.5/5×10^k), `reversal` (3 default, 1 = Wyckoff), `end`. Each column also carries its volume, days and relative volume (column avg daily volume / 50-bar average before it), and the payload includes a volume-at-price profile per box level and `notes` (e.g. bars before a >30-day listing gap were dropped — the investment loader keeps only the latest contiguous listing, which matters for reused tickers like SPCX). Bars come from the investment duckdb (split-adjusted OHLC) with a Yahoo Finance fallback for symbols the DB lacks; 400 on bad args / no data / a chart that would exceed 50,000 boxes (`MAX_BOXES` — the endpoint is reachable through the tunnel without auth, so tiny-box long-range requests are refused rather than computed) |

## Frontend Components

```
App.tsx
├── Persists selected navigation tab in sessionStorage (per browser tab)
├── Sidebar.tsx — sticky; groups Markets / News, active item has a blue rail
│   - Overview tab → OverviewView (default)
│   - Market News tab → MarketView
│   - China Market News → ChinaNewsView, AI News → AiNewsView
├── Shared UI: Tabs.tsx (tab bar), StatusMessage.tsx (loading/empty/error), Chevron.tsx
│
├── OverviewView.tsx
│   ├── Persists selected sub-tab in sessionStorage (per browser tab)
│   ├── Sub-tabs: Overview | Charts | P&F | Trend Spider | Breadth | Estimates
│   ├── Overview tab → MarketOverview
│   ├── Charts tab: TickerSearch (search full duckdb universe) + TaCharts, with a
│   │   Daily/Weekly/Monthly timeframe toggle (default weekly, remembered in sessionStorage)
│   ├── P&F tab: the same TickerSearch (shared selected ticker) + PnfChart
│   ├── Trend Spider tab → TrendSpiderView
│   ├── Breadth tab → BreadthCharts
│   └── Estimates tab → EstimatesView
│
├── MarketOverview.tsx
│   ├── Sections: Overview | Critical Themes | Other Themes
│   ├── Card grid (auto-fill, hairline `.mp-card` cards, collapsible groups)
│   ├── Ticker rows: symbol | gradient magnitude bar | %chg | price
│   ├── High-volume highlight: blue accent rail, vol ratio chip, bolder text
│   ├── Hover tooltip: volume, avg volume, vol ratio, raw change
│   ├── Group headers: avg change%, avg volume ratio
│   └── Live: one /api/market/overview request, re-polled every 5s while the
│       browser tab is visible (see Vol indices and the background snapshot)
│
├── MarketView.tsx
│   ├── Persists selected sub-tab in sessionStorage (per browser tab)
│   ├── Sub-tabs: Trading View | X | CFZH | General (signal digest) | Calendar
│   ├── Calendar (EventsView.tsx): upcoming catalysts, "Next 14 days" then "Later",
│   │   each grouped Macro (blue) → Special events (magenta, the catch-all) → Earnings (green),
│   │   one fixed-width table per group; today/tomorrow dates in red, "first seen" date per row
│   │   critical events: a "Critical ahead" strip at the top, and in their group a red-tinted
│   │   row with a red left bar, bold catalyst and a CRITICAL badge
│   ├── CFZH and General show the last 4 days as collapsible sections (newest open)
│   ├── General nests each day's runs (SignalDigestDay.tsx): each run folds on its own,
│   │   folded runs show time + verdict, only the latest run starts open, and
│   │   "Unfold all runs" / "Fold all runs" act on the whole day
│   ├── A run with proposed log entries ends with ProposedLog.tsx in place of the
│   │   report's "Proposed log" list: a checkbox per proposal (all checked), and a
│   │   "Log N selected with /portfolio-brief" button that starts a background job;
│   │   a spinner shows while it runs (status polled every 5s, the rest of the site
│   │   stays usable), then "Logged" / "Failed" with the agent's reply
│   └── Summary tabs: markdown (react-markdown + remark-gfm)
│
├── TrendSpiderView.tsx — card feed of recent TrendSpider posts
│   (/api/market/trendspider-posts) with images and timestamps
│
├── BreadthCharts.tsx — vertically stacked SVG panels on one shared trading-day
│   axis (/api/market/breadth): SPY/QQQ rebased price, % of members above
│   200/50/20-day averages, net new 52-week highs, cumulative A/D line,
│   distribution days; synced crosshair readouts, drag-to-zoom, range presets
│   (3M–Max), SPY-drawdown shading, and a latest-readings table.
│
├── EstimatesView.tsx — analyst estimates, laid out as search → comparison table →
│   detail panel:
│     • TickerSearch on top. Picking a ticker already in the table selects it;
│       any other is fetched through POST /api/market/estimates/{t} (~2s), added
│       under "Not in the portfolio" and selected.
│     • Comparison table (/api/market/estimates), one single-line row per cached
│       ticker, holdings first: price, mean target against price, mean rating,
│       EPS-by-fiscal-year mini bars (grey reported, blue consensus, pale when
│       fewer than 3 analysts), the month the first estimate year ends, then EPS
│       growth and price ÷ EPS for three consecutive fiscal years, and the fetch
│       date (yellow when older than 8 days; a yellow dot when stockanalysis.com
│       disagrees). Rows never expand, so the list stays intact for comparison.
│     • Detail panel below for the selected row (remembered in sessionStorage,
│       first row by default): every fiscal year, the cross-check figures, the
│       rating changes (per quarter, per broker, full log) and a Refresh link.
│     • On open it also fetches /api/market/estimates/prices and overlays the live
│       TradingView price on screen, recomputing target gap and price ÷ EPS with
│       the fetcher's rounding (consensus, targets and ratings stay as fetched; the
│       cache files keep their finviz price). A price without a live quote is grey,
│       and a note under the table gives the price time or the scanner error.
│   The table is sized to fit a ~900px content area without sideways scrolling.
│   Data comes from stock_picker's scripts/fetch_estimates.py — weekly for the
│   holdings, on demand (script or search box) for anything else.
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
```

## Key Design Decisions

### 1. Timestamps in LA Time
- Source timestamps are converted to America/Los_Angeles in the backend
- Users see dates in Pacific time

### 2. Vite Proxy for API
- Frontend dev server proxies `/api` to backend
- No CORS issues in development
- `vite.config.ts` configures proxy

## Market Overview Data Sourcing (ticker.csv + TradingView scanner)

Market Overview loads ticker groups from `~/projects/stock_picker/data/ticker.csv` at runtime. To add/reorder tickers within a theme, edit the CSV (`theme`, `display_order` columns).

- The CSV's `exchange` column is the single source of truth for the scanner fetch: `quotes.py` builds each scanner symbol as `EXCHANGE:SYMBOL`, so `exchange` must be the value TradingView's scanner indexes (US ETFs use `AMEX`/`NASDAQ`/`CBOE`; index/crypto/futures use TradingView feed names like `TVC`/`CRYPTO`/`CME_MINI`).
- **Real-time vs delayed quotes.** Anonymous calls to `scanner.tradingview.com/global/scan` serve *delayed* quotes for US equities (minutes old on fast movers — measured ~$2-4 behind the live tape on AMD). The same endpoint returns real-time data when called with the logged-in TradingView session cookies (`sessionid` + `sessionid_sign`), which `tv_session.py` reads from the crawl4ai browser profile (`~/.crawl4ai/tradingview-profile`, already logged in) via a short headless playwright launch, TTL-cached for 6h. If the session is unavailable (profile locked mid-scrape, not logged in, browser error) `quotes.py` falls back to the anonymous endpoint — same response shape, just delayed. That refresh (like the FRED and CBOE-history refreshes) now happens on `overview_cache`'s background thread, never on a request — before the background snapshot existed, whichever page load happened to hit an expired cookie TTL paid the ~3s browser launch.
- **The session cookie does not make everything real-time — exchange entitlements do.** Whether a symbol streams live is a property of the TradingView *account's* data subscriptions, and the scanner REST API, the quote websocket and the website all honour the same entitlement. No change to the fetch path can turn a delayed symbol real-time; only subscribing to that exchange's real-time feed can. Verified 2026-09-04 with `python -m src.backend.scripts.check_quote_delay`, which reads TradingView's own per-symbol `update_mode`: **153 of 174 symbols stream real-time**; the exceptions are CBOE indices (VIX, VIX3M, SPX, GVZ, VXSLV — 15 min), CME/COMEX/NYMEX futures (ES1!, NQ1!, RTY1!, GC1!, CL1! — 10 min), `NASDAQ:NDX` (15 min), foreign listings (ASX/KRX/TSE/TSX/TSXV/XETR/EURONEXT — 15-20 min) and `NYSE:NYA` (end-of-day). Note the liquid proxies are real-time even where the index is not: SPY and QQQ stream while SPX and NDX are delayed.
- **The UI says which tiles are delayed.** `update_mode` is a scanner *column*, so it rides along in the existing batch request at no cost and stays current by itself — no hardcoded symbol list to go stale. `quote_format.delay_label` turns it into a display string (`""` real-time, `"15m"`, `"10m"`, `"EOD"`) carried as `delay` on every quote, and `MarketOverview.tsx` renders it as a small muted chip beside the symbol with the full wording in the hover tooltip. FRED series are labelled `EOD` directly (they are end-of-day by nature) and the CBOE vol indices `15m`. A ticker row is only ~284px wide, so when a row would show both a volume-ratio chip and a delay chip the delay wins: staleness is a correctness signal, while the vol ratio remains in the tooltip and in the row's high-volume rail.
- A symbol with no free scanner data is listed in `SCANNER_UNAVAILABLE` (= `vol_indices.SYMBOLS`) and fetched from its publisher instead — see [Vol indices and the background snapshot](#vol-indices-and-the-background-snapshot). CSV rows with exchange `FRED` are likewise fetched from FRED's keyless fredgraph.csv endpoint (`_fetch_fred_quotes`, TTL-cached). `quotes.fetch_all_quotes()` runs the scanner batch and the vol-index fetch concurrently and merges everything into one dict.
- Curated section/group ordering lives in `SECTIONS` in `market_overview.py`; new CSV themes not listed there are automatically appended to `Other Themes`. To drop a theme from the dashboard without removing it from the CSV (which stock_picker shares), delete it from `SECTIONS` *and* add it to `HIDDEN_GROUPS` — otherwise the auto-append would put it back under `Other Themes`. `Other ETFs` is hidden this way.
- Tickers may appear in multiple themes (e.g., NVDA in both Big Tech and AI Chips & Foundry).
- The `Portfolio` section (shown just below `Overview`) is the exception: it is not sourced from the CSV at all — see below.

## Vol indices and the background snapshot

Two changes (Sep 2026) took the Overview tab from ~1.3s + an 18s tail down to a ~5ms response.

### The five symbols TradingView won't serve

`VIX3M`, `GVZ`, `VXSLV`, `DVOL` and `ETHDVOL` are licensed real-time feeds. The free scanner
returns no row for them at any spelling, and the single-symbol endpoint
(`scanner.tradingview.com/symbol?symbol=CBOE:GVZ`) returns `null` even *with* the logged-in
session cookie — verified, not assumed. They used to be filled in by a headless crawl4ai scrape
of the TradingView watchlist page behind `/api/market/overview/gaps`: 18s per refresh, and by
Sep 2026 it had stopped matching any of the five, so all five tiles rendered `—`.

`vol_indices.py` fetches them from the publishers instead, concurrently, TTL-cached 60s:

| Symbols | Source |
|---|---|
| VIX3M, GVZ, VXSLV | `cdn.cboe.com/api/global/delayed_quotes/quotes/_SYM.json` (15-min delayed — **the same delay TradingView serves this account**, see above, so nothing is lost by not going through TV) |
| DVOL, ETHDVOL | `deribit.com/api/v2/public/get_volatility_index_data` (BTC / ETH, daily candles) |

The one subtlety is the **previous close**. CBOE's quote payload carries `prev_day_close`, but for
the thinner indices (GVZ/VXSLV, which come off a different feed — note their differing
`exchange_id`) it is reported equal to the current price, which would render a permanent
`+0.00%`. So the reference close comes from `charts/historical/_SYM.json` instead: the last daily
bar before the live quote's session date. That series is ~500 KB, so it is cached per symbol per
session date — one fetch per trading day. If it fails, the code falls back to `prev_day_close`
(correct for VIX3M, merely flat for the others). Deribit needs no such workaround: the last two
daily candles give the level and its reference directly, matching how TradingView shows
`DERIBIT:DVOL` — and Deribit is `streaming` (real-time) on TradingView too, so DVOL/ETHDVOL are
real-time here as well. Cross-checked 2026-09-04: TV's websocket reported `DERIBIT:DVOL`
`prev_close_price` 39.78, exactly the previous daily candle close this module uses, and `CBOE:GVZ`
`chp` -2.02 with `prev_close_price` 27.18, exactly what the CBOE-history path computes.

Both producers emit `quote_format`-shaped dicts, the same shape the scanner and FRED paths emit,
so `quotes.fetch_all_quotes()` just merges them. `quote_format.py` exists so the three producers
cannot drift on decimals, sign or volume suffixes.

### Why the overview is served from a snapshot

The scanner POST costs ~1s for ~170 symbols no matter how it is sliced — splitting it into four
parallel chunks was measured at 1.0-1.6s, because the cost is round-trip latency, not payload
size. On top of that, the caches on the request path (the 6h `tv_session` cookie TTL, worth a ~3s
browser launch, and the 900s FRED TTL) expired onto whichever page load happened to hit them,
which is what made an occasional refresh feel like several seconds.

`overview_cache.py` moves all of it off the request path. A daemon thread, started from the
FastAPI lifespan, rebuilds the entire response body — quotes, portfolio, sections — on a cadence
that follows whether anyone is actually looking:

| Constant | Value | Meaning |
|---|---|---|
| `REFRESH_ACTIVE` | 5s | cadence while a request arrived within `ACTIVE_WINDOW` |
| `REFRESH_IDLE` | 30s | cadence when nobody is watching |
| `ACTIVE_WINDOW` | 120s | how long a request keeps the server "active" |
| `MAX_SERVE_AGE` | 35s | older than this and a request fetches synchronously instead |

`MAX_SERVE_AGE` must stay greater than `REFRESH_IDLE` (there is a test asserting it): otherwise
the first page load on an idle server always blocks on a live fetch, which is the exact latency
this module exists to remove. The gate is what keeps the design honest — a stale snapshot is
never displayed; the worst case degrades to the old blocking behaviour rather than to stale
numbers. A failed fetch keeps serving the last known payload rather than erroring.

`force=1` (the UI's refresh button) always fetches synchronously (~0.9s).

The frontend side is the mirror image: `MarketOverview.tsx` makes one request instead of two
sequential ones, and polls every 5s **while the browser tab is visible** (`visibilitychange`). The
poll is nearly free for the backend (no network I/O) and it is what keeps the refresher in its
fast cadence, so an open dashboard tracks the tape within ~5-10s. A failed poll no longer blanks
a dashboard that is already rendering — the error only surfaces when there is nothing to show.

## Portfolio Section Data Sourcing (stock_picker `data/portfolio.csv`)

The `Portfolio` section mirrors the TradingView watchlist named **`portfolio`**; holdings are edited in TradingView and never in code. `tv_watchlist.py` (stock_picker) is the single implementation of "read/write a TV watchlist" and mirrors every actual watchlist change into `~/projects/stock_picker/data/portfolio.csv`, which `portfolio.py` reads per request (`load_holdings` / `load_symbols`).
- **No Chrome, no cache, no TTL** — the CSV is a plain file read on every request (sub-10ms), so the dashboard picks up a script-driven watchlist change on the next page load. A manual edit on the TradingView website goes stale until the next script-driven change or `tv_watchlist.py --sync-portfolio-csv`.
- **Benchmarks are filtered out at sync time.** The watchlist also carries NDX / QQQ / SPX / SMH / SOXX for comparison. The mirror drops a symbol by *instrument type* from TradingView's scanner (`type` column, via the same `https://scanner.tradingview.com/global/scan` POST the quote fetches use): `index`, `fund` (ETFs), `futures`, `spot`, `commodity`, `forex`, `bond`, `economic`. The filter is a **drop-list, not a keep-list**, because ADRs classify as `dr` rather than `stock` (TSM, ARM, SKHY) — a holding is better shown as a dashed tile than silently omitted. `ticker.csv`'s `ticker_type` is the fallback when the scanner returns no type.
- **CSV columns** — `ticker,exchange,ticker_type`, rows in watchlist order (so the section ordering matches the watchlist). `exchange` is the TradingView scanner prefix used to build `EXCHANGE:TICKER` quotes.
- Holdings not yet mirrored into `ticker.csv` still get quotes: `main.py` passes them to `quotes.fetch_covered_quotes(extra=...)` using the exchange from the CSV.
- A missing/unreadable CSV yields an empty holdings list, which omits the section rather than falling back to a guess.

## Future Considerations

### Production Deployment
- Build frontend: `npm run build`
- Serve static files from FastAPI or nginx
- Use Gunicorn with uvicorn workers for backend
- Consider caching API responses (Redis/in-memory)
