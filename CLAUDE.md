# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, OpenClaw, Hermes, and similar tools).

## Project Overview

Market Pulse - A web dashboard for monitoring market and individual stock/crypto tickers.

## Tech Stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS v4 (Solarized Light theme, `--color-sol-*` variables in `index.css`)
- **Backend**: FastAPI (Python, `ml` conda env per global CLAUDE.md)
- **Charts**: Plotly (react-plotly.js) for market-cap; TradingView Lightweight Charts v5 for weekly + monthly + daily TA charts
- **Data Sources**: CoinMarketCap API; TradingView scanner JSON API for live quotes (`quotes.py`) with a crawl4ai watchlist scrape covering a handful of licensed-feed symbols (`watchlist_scraper.py`); news summaries (NDX, CFZH forum, X market news), TrendSpider posts, Zhihu AI briefs (all from the `news` project); OHLCV + precomputed indicators read-only from the `investment` project duckdb (`~/projects/investment/data/stocks/stocks.duckdb`)

## Project Structure

```
src/
├── backend/                  # FastAPI backend (port 8000)
│   ├── main.py               # App + API endpoints (/api/tickers/…, /api/market/…)
│   ├── quotes.py             # Live quotes via TradingView scanner JSON API (CSV-driven EXCHANGE:SYMBOL)
│   ├── watchlist_scraper.py  # crawl4ai scrape for the ~5 licensed-feed gap symbols
│   ├── market_overview.py    # Market overview assembler (SECTIONS)
│   ├── portfolio.py          # Holdings from stock_picker's data/portfolio.csv (mirror of the TradingView "portfolio" watchlist)
│   ├── tickers/charts.py     # Weekly/monthly/daily OHLCV + indicators (reads investment duckdb)
│   └── scripts/              # start_tunnel.sh, ensure_up.sh
└── frontend/                 # React + Vite (port 5173); components in src/components/
                              # (OverviewView, MarketOverview, MarketView, TaCharts, TickerView, …)
```

Full component list and data flow: [docs/architecture.md](docs/architecture.md).

## Running the App

```bash
market-pulse-server        # start backend + frontend detached; ✓ ready per server
market-pulse-server stop   # stop both (finds them by port)
```

Open http://localhost:5173

- **Always prefer `market-pulse-server` over raw `uvicorn`/`npm run dev`** — from a cmux/Claude Code shell, a dangling cmux `NODE_OPTIONS` shim crashes every spawned `node` (symptom: HTTP 500 from `/api/market/overview/gaps`); the wrapper strips it. If you must run uvicorn from a cmux shell, prefix `env -u NODE_OPTIONS`. Details + manual two-terminal commands: [docs/operations.md](docs/operations.md).
- Server logs: `tmp/backend.log`, `tmp/frontend.log`.
- Public URL: `src/backend/scripts/start_tunnel.sh [status|stop]` (ngrok, detached). Details: [docs/operations.md](docs/operations.md).
- Auto-start on login: LaunchAgent `com.jianfuchen.market-pulse` runs the `ensure_up.sh` supervisor daemon (restarts app + tunnel within ~1 min of a crash/wake). Enable/disable + design constraints: [docs/operations.md](docs/operations.md).

## Key Conventions

- All timestamps are in LA time (America/Los_Angeles)
- Market cap values are displayed in billions (e.g., "$77.61B")
- Backend API endpoints are under `/api/tickers/{ticker}/` and `/api/market/`
- Temp files (screenshots, logs, etc.) go in `tmp/` folder
- Market Overview ticker groups come from `~/projects/stock_picker/data/ticker.csv` at runtime (`theme`, `display_order` columns; `exchange` must be the TradingView scanner value). Section ordering lives in `SECTIONS` (`market_overview.py`). The `Portfolio` section is **not** hardcoded — it reads `~/projects/stock_picker/data/portfolio.csv` (`portfolio.py`), which `tv_watchlist.py` mirrors from the TradingView watchlist named `portfolio` on every change; edit the holdings in TradingView (via the script), not in code. Full sourcing rules: [docs/architecture.md](docs/architecture.md#market-overview-data-sourcing-tickercsv--tradingview-scanner).

## Documentation

- [Architecture & Design Decisions](docs/architecture.md) — tech stack rationale, data flow, API endpoints, components, Market Overview data sourcing
- [Operations](docs/operations.md) — market-pulse-server & the cmux NODE_OPTIONS trap, ngrok tunnel, auto-start LaunchAgent
