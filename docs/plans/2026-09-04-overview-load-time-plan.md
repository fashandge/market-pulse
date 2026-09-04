# Plan: cut Market Overview load time while keeping quotes real-time

**Goal.** The Overview tab of Market Overview renders with fresh (real-time) numbers
essentially instantly on a page refresh, instead of the current ~1.3 s + an 18 s tail.

**Done when:** `curl /api/market/overview` returns in < 0.3 s on a warm server with a
snapshot age < 10 s, every ticker in the response (including VIX3M / GVZ / VXSLV /
DVOL / ETHDVOL) carries a real price rather than `—`, the frontend issues no second
blocking request for those tiles, `python -m pytest tests/ -q` passes, and docs are
updated.

## Measured baseline (2026-09-04)

| Step | Time | Note |
|---|---|---|
| `/api/market/overview` | 1.3 s | one TradingView scanner POST for 176 symbols |
| `/api/market/overview/gaps` | 18.2 s | crawl4ai headless-browser watchlist scrape |

Sub-timings: portfolio CSV 1 ms, `tv_session` cookies 0 ms warm (2.9 s cold, 6 h TTL),
scanner POST 0.85–1.6 s, `build_overview` 1 ms. Splitting the scanner POST into 4
parallel chunks does **not** help (1.0–1.6 s) — the cost is round-trip latency, not
payload size, so the only way to remove it from the request path is to have the fetch
already done when the request arrives.

Worse, the 18 s gaps scrape currently returns `{}`: all five licensed-feed vol tiles
render `—` today. So that 18 s buys nothing.

## Approach

1. **Replace the browser scrape with the vendors' own JSON APIs.** CBOE publishes
   `cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX3M.json` (also `_GVZ`, `_VXSLV`)
   with `current_price` / `price_change` / `price_change_percent`; Deribit publishes
   `api/v2/public/get_volatility_index_data` (BTC → DVOL, ETH → ETHDVOL) whose last two
   daily candles give level + change. Both answer in well under a second, so these
   symbols move onto the fast path and the 18 s scrape leaves the request path entirely.
   (Consistent with the global rule: prefer a data API over scraping rendered HTML.)

2. **Serve the overview from a background-refreshed snapshot.** A refresher thread keeps
   the merged quote dict warm; the endpoint returns it without any network I/O when it is
   fresh, and only blocks on a live fetch when the snapshot is older than a max-serve-age
   bound. Cadence adapts to whether anyone is actually watching, so an open dashboard gets
   ~5 s-old quotes while an idle server does not hammer TradingView.

3. **Frontend: one request instead of two sequential ones.** With the vol indices on the
   fast path, `fetchGaps` and its 18 s tail are deleted.

Rejected: parallel scanner chunks (measured, no gain); a websocket/SSE push feed
(much larger change, and the user asked about page-refresh latency, not a live tape);
keeping the scrape as a fallback (it is already returning nothing for these symbols).

## Tasks

- [x] 1. `src/backend/vol_indices.py` — CBOE + Deribit fetchers, `quotes.py`-shaped output, concurrent, TTL-cached, failure-tolerant
- [x] 2. Wire into `quotes.fetch_covered_quotes`; drop `SCANNER_UNAVAILABLE` from the scrape path
- [x] 3. `src/backend/overview_cache.py` — background snapshot refresher + max-serve-age gate; `/api/market/overview` serves from it
- [x] 4. Retire `/api/market/overview/gaps` + `watchlist_scraper.py`; delete `fetchGaps` from `MarketOverview.tsx`
- [x] 5. Tests (`tests/test_vol_indices.py`, `tests/test_overview_cache.py`), full suite green
- [ ] 6. Verify in the real app (timings + a browser load), then `/update-docs-and-push-code`

## Risks / open questions

- Deribit DVOL daily candles are UTC-bucketed; the change% is vs the previous UTC daily
  close, which is how TradingView shows `DERIBIT:DVOL`. Verify the number looks sane.
- CBOE's feed is delayed (its own path is `delayed_quotes`); these are vol indices where
  the previous scrape gave nothing at all, so delayed-but-present is a strict improvement.
- Background polling adds steady outbound requests to TradingView. Kept modest via the
  active/idle cadence split.
- The refresher thread must not break `pytest` collection or a `--reload` uvicorn (daemon
  thread, started on FastAPI startup, not at import).
