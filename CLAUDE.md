# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, OpenClaw, Hermes, and similar tools).

## Project Overview

Market Pulse - A web dashboard for monitoring market and individual stock/crypto tickers.

## Tech Stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS v4 (Solarized Light theme)
- **Backend**: FastAPI (Python)
- **Charts**: Plotly (react-plotly.js) for market-cap; TradingView Lightweight Charts v5 for weekly + monthly + daily TA charts
- **Data Sources**: CoinMarketCap API, TradingView scanner JSON API (live Overview-tab quotes, `quotes.py`) with a crawl4ai watchlist scrape as fallback for a handful of licensed-feed symbols (`watchlist_scraper.py`), news summaries (NDX, CFZH forum, X market news), TrendSpider posts, Zhihu AI news daily briefs, and OHLCV + precomputed indicators from the `investment` project duckdb (`~/projects/investment/data/stocks/stocks.duckdb`): weekly from `weekly_bars_adjusted` + `weekly_indicators`, monthly from `monthly_bars_adjusted` + `monthly_indicators`, daily from `daily_bars_adjusted` + `classifier_features`

## Project Structure

```
src/
├── backend/              # Python FastAPI backend
│   ├── __init__.py
│   ├── main.py           # FastAPI app, API endpoints
│   ├── quotes.py             # Fast Overview quotes via TradingView scanner JSON API (CSV-driven EXCHANGE:SYMBOL)
│   ├── watchlist_scraper.py  # crawl4ai watchlist scrape; now only the ~5 licensed-feed gap symbols
│   ├── market_overview.py    # Market overview data assembler (groups/themes)
│   ├── tickers/          # Ticker data modules
│   │   ├── __init__.py
│   │   ├── crcl.py       # USDC/CRCL data fetching
│   │   └── charts.py     # Weekly + monthly + daily OHLCV + indicators (reads investment duckdb, read-only)
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
    │       ├── TaCharts.tsx        # Weekly + monthly + daily TA charts (lightweight-charts) for the Charts sub-tab
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
symptom is an **`HTTP 500` from `/api/market/overview/gaps`** (that endpoint → scraper → Playwright
driver crash); the main `/api/market/overview` no longer scrapes (it uses the scanner API, `quotes.py`)
so it stays up, but the ~5 licensed-feed gap tiles fail to refresh. `market-pulse-server` self-heals
this: it detects a cmux shell and drops
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
src/backend/scripts/start_tunnel.sh         # start the tunnel (detached) and print the URL
src/backend/scripts/start_tunnel.sh status  # show the current public URL (if any)
src/backend/scripts/start_tunnel.sh stop    # stop the running tunnel
```

Requires `ngrok` installed with an authtoken configured (`ngrok config add-authtoken <TOKEN>`).
It tunnels the frontend (`:5173`), which proxies `/api` to the backend, so the whole app works
through one URL. `vite.config.ts` `allowedHosts` already whitelists the ngrok/trycloudflare/etc.
tunnel domains (Vite 403s any other public host). The URL is public with no auth and requires this
Mac awake with the app running. Note: some routers/ISPs block `*.trycloudflare.com` at the DNS
level — ngrok (`*.ngrok-free.dev`) avoids that.

The tunnel starts **detached** (`nohup` + `disown`), so it keeps running after the launching
shell exits; output goes to `tmp/ngrok.log` and the agent PID to `tmp/ngrok.pid`. Stop it with
`start_tunnel.sh stop` (kills by PID file, falling back to any `ngrok http` process). ngrok's free
tier hands out a **new random hostname on every start**, so the URL changes each restart — reserve
a static domain on the ngrok dashboard and add `--url=<domain>` to the `ngrok http` line if you
need a stable link. The tunnel still dies if the Mac sleeps.

### Auto-start on login (LaunchAgent)

A LaunchAgent keeps the app and tunnel running without manual commands:

- `deploy/launchd/com.jianfuchen.market-pulse.plist` — symlinked into `~/Library/LaunchAgents/`.
- It runs `src/backend/scripts/ensure_up.sh`, a **long-running supervisor daemon** started at
  login (`RunAtLoad`) and kept alive by launchd (`KeepAlive`). The daemon loops forever,
  re-checking every 60s and (re)starting the app servers (`market-pulse-server`) and the ngrok
  tunnel (`start_tunnel.sh`) only if they are down; it is silent in the log when everything is
  healthy. This gives login-start **plus** crash / wake-from-sleep recovery within ~a minute (a
  sleeping Mac drops the tunnel, but it comes back on wake).
- It must NOT be a one-shot (`StartInterval`/`RunAtLoad`-then-exit): under launchd, when a job's
  main process exits, launchd kills the whole job — including the `nohup`/`disown`'d backend,
  frontend and ngrok it just started. The daemon stays running so the servers (in its process
  group) stay up; `KeepAlive` only restarts the daemon itself if it ever dies.
- It runs via `/bin/zsh` so `~/.zshenv` supplies the full PATH (node/npm live in `~/.local/bin`,
  ngrok in `/opt/homebrew/bin`) that launchd's minimal default PATH would otherwise miss.
- Logs: `tmp/supervisor.log` (actions only) and `tmp/launchd.{out,err}.log`.

Enable/disable:

```bash
launchctl load   ~/Library/LaunchAgents/com.jianfuchen.market-pulse.plist   # enable
launchctl unload ~/Library/LaunchAgents/com.jianfuchen.market-pulse.plist   # disable
```

## Documentation

- [Architecture & Design Decisions](docs/architecture.md)

## Key Conventions

- All timestamps are in LA time (America/Los_Angeles)
- Market cap values are displayed in billions (e.g., "$77.61B")
- Backend API endpoints are under `/api/tickers/{ticker}/` and `/api/market/`
- UI uses Solarized Light color theme (defined in `index.css` as `--color-sol-*` variables)
- Temp files (screenshots, logs, etc.) go in `tmp/` folder
- Market Overview loads ticker groups from `~/projects/stock_picker/data/ticker.csv` at runtime. To add/reorder tickers within a theme, edit the CSV (`theme`, `display_order` columns). The CSV's `exchange` column is the single source of truth for the scanner fetch: `quotes.py` builds each scanner symbol as `EXCHANGE:SYMBOL`, so `exchange` must be the value TradingView's scanner indexes (US ETFs use `AMEX`/`NASDAQ`/`CBOE`; index/crypto/futures use TradingView feed names like `TVC`/`CRYPTO`/`CME_MINI`). A symbol with no free scanner data is listed in `SCANNER_UNAVAILABLE` and served from the scrape instead. Curated section/group ordering lives in `SECTIONS` in `market_overview.py`; new CSV themes not listed there are automatically appended to `Other Themes`. Tickers may appear in multiple themes (e.g., NVDA in both Big Tech and AI Chips & Foundry). The `Portfolio` section (shown just below `Overview`) is the exception: its single group is a hardcoded ticker list in `PORTFOLIO` in `market_overview.py`, not sourced from the CSV.
