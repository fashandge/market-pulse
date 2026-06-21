# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, OpenClaw, Hermes, and similar tools).

## Project Overview

Market Pulse - A web dashboard for monitoring market and individual stock/crypto tickers.

## Tech Stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS v4 (Solarized Light theme)
- **Backend**: FastAPI (Python)
- **Charts**: Plotly (react-plotly.js) for market-cap; TradingView Lightweight Charts v5 for weekly + daily TA charts
- **Data Sources**: CoinMarketCap API, TradingView watchlist (crawl4ai), news summaries (NDX, CFZH forum, X market news), TrendSpider posts, Zhihu AI news daily briefs, and OHLCV + precomputed indicators from the `investment` project duckdb (`~/projects/investment/data/stocks/stocks.duckdb`): weekly from `weekly_bars_adjusted` + `weekly_indicators`, daily from `daily_bars_adjusted` + `classifier_features`

## Project Structure

```
src/
├── backend/              # Python FastAPI backend
│   ├── __init__.py
│   ├── main.py           # FastAPI app, API endpoints
│   ├── watchlist_scraper.py  # TradingView watchlist scraper (crawl4ai)
│   ├── market_overview.py    # Market overview data assembler (groups/themes)
│   ├── tickers/          # Ticker data modules
│   │   ├── __init__.py
│   │   ├── crcl.py       # USDC/CRCL data fetching
│   │   └── charts.py     # Weekly + daily OHLCV + indicators (reads investment duckdb, read-only)
│   └── scripts/          # Shell utilities
│       └── start_tunnel.sh   # Expose the running app on a temporary public ngrok URL
│
└── frontend/             # React + Vite frontend
    ├── src/
    │   ├── App.tsx
    │   ├── main.tsx
    │   ├── index.css     # Tailwind CSS
    │   └── components/
    │       ├── Sidebar.tsx
    │       ├── OverviewView.tsx    # Default view; sub-tabs (Overview, Charts, Trend Spider)
    │       ├── MarketOverview.tsx   # Market overview card grid (Overview sub-tab)
    │       ├── MarketView.tsx      # Market news with sub-tabs (Trading View, X, CFZH)
    │       ├── TrendSpiderView.tsx # TrendSpider post feed (Trend Spider sub-tab)
    │       ├── TickerSearch.tsx    # Ticker search box (queries /api/tickers/search)
    │       ├── TaCharts.tsx        # Weekly + daily TA charts (lightweight-charts) for the Charts sub-tab
    │       ├── TickerView.tsx
    │       └── MarketCapChart.tsx
    ├── index.html
    ├── package.json
    └── vite.config.ts
```

## Running the App

```bash
# Quick start (starts both servers detached, then returns)
market-pulse-server
# Stop them again with:
market-pulse-server stop

# Or manually in separate terminals:
# Terminal 1 - Backend (port 8000)
cd /Users/jianfuchen/projects/market-pulse
/opt/homebrew/Caskroom/miniconda/base/envs/ml/bin/python -m uvicorn src.backend.main:app --reload

# Terminal 2 - Frontend (port 5173)
cd /Users/jianfuchen/projects/market-pulse/src/frontend
npm run dev
```

Open http://localhost:5173

**Prefer `market-pulse-server` (in `~/mycmd/`) over launching `uvicorn` by hand**, especially
when starting from inside a cmux/Claude Code terminal. cmux injects a transient
`NODE_OPTIONS=--require=…/cmux-claude-node-options/restore-node-options.cjs` shim into the shell;
once that temp file is cleaned up the env var dangles, so any `node` the backend spawns (the
Playwright driver behind `watchlist_scraper`, and vite) aborts with `MODULE_NOT_FOUND`. The visible
symptom is the **Overview sub-tab failing with `HTTP 500`** (`/api/market/overview` → scraper →
Playwright driver crash). `market-pulse-server` self-heals this: it detects a cmux shell and drops
the stale `NODE_OPTIONS` before starting the servers. If you must run `uvicorn` directly from a
cmux shell, prefix it with `env -u NODE_OPTIONS`, or just launch from a normal terminal (Terminal /
iTerm), whose `NODE_OPTIONS` is clean.

`market-pulse-server` starts both servers **detached** (`nohup` + `disown`), waits for each port to
come up (printing a `✓ ready` line per server, or the tail of the log on a timeout), then returns —
so they keep running after the launching shell exits. Output goes to `tmp/backend.log` and
`tmp/frontend.log` (tail them to debug startup). Stop the servers with `market-pulse-server stop`,
which finds them by port and so works regardless of how they were started.

### Public access (temporary tunnel)

To share the running app on a temporary public URL (e.g. to view it off-machine):

```bash
src/backend/scripts/start_tunnel.sh
```

Requires `ngrok` installed with an authtoken configured (`ngrok config add-authtoken <TOKEN>`).
It tunnels the frontend (`:5173`), which proxies `/api` to the backend, so the whole app works
through one URL. `vite.config.ts` `allowedHosts` already whitelists the ngrok/trycloudflare/etc.
tunnel domains (Vite 403s any other public host). The URL is public with no auth and requires this
Mac awake with the app running. Note: some routers/ISPs block `*.trycloudflare.com` at the DNS
level — ngrok (`*.ngrok-free.dev`) avoids that.

## Documentation

- [Architecture & Design Decisions](docs/architecture.md)

## Key Conventions

- All timestamps are in LA time (America/Los_Angeles)
- Market cap values are displayed in billions (e.g., "$77.61B")
- Backend API endpoints are under `/api/tickers/{ticker}/` and `/api/market/`
- UI uses Solarized Light color theme (defined in `index.css` as `--color-sol-*` variables)
- Temp files (screenshots, logs, etc.) go in `tmp/` folder
- Market Overview loads ticker groups from `~/projects/stock_picker/data/ticker.csv` at runtime. To add/reorder tickers within a theme, edit the CSV (`theme`, `display_order` columns). Curated section/group ordering lives in `SECTIONS` in `market_overview.py`; new CSV themes not listed there are automatically appended to `Other Themes`. Tickers may appear in multiple themes (e.g., NVDA in both Big Tech and AI Chips & Foundry). The `Portfolio` section (shown just below `Overview`) is the exception: its single group is a hardcoded ticker list in `PORTFOLIO` in `market_overview.py`, not sourced from the CSV.
