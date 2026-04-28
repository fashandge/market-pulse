# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, OpenClaw, Hermes, and similar tools).

## Project Overview

Market Pulse - A web dashboard for monitoring market and individual stock/crypto tickers.

## Tech Stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS v4
- **Backend**: FastAPI (Python)
- **Charts**: Plotly (react-plotly.js)
- **Data Source**: CoinMarketCap API

## Project Structure

```
src/
├── backend/              # Python FastAPI backend
│   ├── __init__.py
│   ├── main.py           # FastAPI app, API endpoints
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
- Backend API endpoints are under `/api/tickers/{ticker}/`
- Temp files (screenshots, logs, etc.) go in `tmp/` folder
