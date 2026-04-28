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
CoinMarketCap API                    NDX News Summaries
       ↓                             ~/projects/news/data/market_news/ndx/{date}/summary/
   FastAPI Backend (port 8000)       ↓
   - Fetches data                    - Reads latest .md file
   - Converts UTC → LA time          - Returns markdown content
   - Computes changes
       ↓                             ↓
   React Frontend (port 5173)
   - Filters data by time range      - Renders markdown (react-markdown)
   - Renders Plotly chart            - Displays tables via remark-gfm
   - Displays changes table
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tickers/crcl/market-cap` | GET | Returns 3Y market cap time series |
| `/api/tickers/crcl/changes` | GET | Returns percentage changes |
| `/api/market/ndx-summary` | GET | Returns today's NDX news summary (markdown) |

## Frontend Components

```
App.tsx
├── Sidebar.tsx
│   - Market tab → MarketView
│   - Tickers section (collapsible)
│     └── CRCL tab → TickerView
│
├── MarketView.tsx
│   └── NDX news summary (react-markdown + remark-gfm)
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
