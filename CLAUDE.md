# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, OpenClaw, Hermes, and similar tools).

## Project Overview

Market Pulse - A web dashboard for monitoring market and individual stock/crypto tickers.

## Tech Stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS v4 (Solarized Light theme)
- **Backend**: FastAPI (Python)
- **Charts**: Plotly (react-plotly.js)
- **Data Sources**: CoinMarketCap API, TradingView watchlist (crawl4ai), news summaries (NDX, CFZH forum, X market news), TrendSpider posts

## Project Structure

```
src/
├── backend/              # Python FastAPI backend
│   ├── __init__.py
│   ├── main.py           # FastAPI app, API endpoints
│   ├── watchlist_scraper.py  # TradingView watchlist scraper (crawl4ai)
│   ├── market_overview.py    # Market overview data assembler (groups/themes)
│   └── tickers/          # Ticker data modules
│       ├── __init__.py
│       └── crcl.py       # USDC/CRCL data fetching
│
└── frontend/             # React + Vite frontend
    ├── src/
    │   ├── App.tsx
    │   ├── main.tsx
    │   ├── index.css     # Tailwind CSS
    │   └── components/
    │       ├── Sidebar.tsx
    │       ├── MarketOverview.tsx   # Market overview card grid (default view)
    │       ├── MarketView.tsx      # Market news with sub-tabs (Trading View, X, CFZH, Trend Spider)
    │       ├── TickerView.tsx
    │       └── MarketCapChart.tsx
    ├── index.html
    ├── package.json
    └── vite.config.ts
```

## Running the App

```bash
# Quick start (both servers in one terminal)
market-pulse-server

# Or manually in separate terminals:
# Terminal 1 - Backend (port 8000)
cd /Users/jianfuchen/projects/market-pulse
/opt/homebrew/Caskroom/miniconda/base/envs/ml/bin/python -m uvicorn src.backend.main:app --reload

# Terminal 2 - Frontend (port 5173)
cd /Users/jianfuchen/projects/market-pulse/src/frontend
npm run dev
```

Open http://localhost:5173

## Documentation

- [Architecture & Design Decisions](docs/architecture.md)

## Key Conventions

- All timestamps are in LA time (America/Los_Angeles)
- Market cap values are displayed in billions (e.g., "$77.61B")
- Backend API endpoints are under `/api/tickers/{ticker}/` and `/api/market/`
- UI uses Solarized Light color theme (defined in `index.css` as `--color-sol-*` variables)
- Temp files (screenshots, logs, etc.) go in `tmp/` folder
- Market Overview loads all ticker groups from `~/projects/stock_picker/data/ticker.csv` at runtime. To add/reorder tickers, edit the CSV (theme, display_order columns). Section assignment and group ordering are in `SECTIONS` in `market_overview.py`. Tickers may appear in multiple themes (e.g., NVDA in both Big Tech and AI Chips & Foundry).
