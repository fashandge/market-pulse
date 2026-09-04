# Progress: Overview load time

## 2026-09-04 15:12 — backend done, endpoint is now instant

Done:
- `quote_format.py` — shared quote-dict formatting, so the scanner, FRED and the
  new vol-index producers can't drift apart.
- `vol_indices.py` — VIX3M/GVZ/VXSLV from CBOE's delayed-quotes JSON (previous
  close from its daily-history series, cached per session date, because CBOE's
  own `prev_day_close` reports a flat 0.00% for GVZ/VXSLV), DVOL/ETHDVOL from
  Deribit's volatility-index candles. All five fetched concurrently, TTL 60s.
  VIX3M reproduces CBOE's own +1.09% exactly.
- `quotes.fetch_all_quotes()` — scanner batch and vol indices in parallel.
- `overview_cache.py` — daemon thread keeps the snapshot warm (5s while someone
  is watching, 30s idle); `/api/market/overview` serves it with no I/O and only
  fetches synchronously if the snapshot is older than 35s or `force=1`.
- Retired `/api/market/overview/gaps` and deleted `watchlist_scraper.py`.
- `MarketOverview.tsx`: dropped `fetchGaps`; polls every 5s while the tab is
  visible; a failed poll no longer blanks a rendering dashboard.

Measured after restart: `/api/market/overview` **1.3s → 3-7ms**, snapshot age
~1s; `force=1` 0.87s. The 18.2s `/gaps` call is gone entirely, and the five vol
tiles that had been rendering "—" now carry real numbers.

Also answers the user's mid-run note that a refresh "after some time" felt like
several seconds: that was the 6h tv_session cookie refresh (2.9s browser launch)
and the 900s FRED cache expiring onto whichever request happened to hit them.
Both now expire on the background thread, never on a request.

Next: tests, browser verification, docs, push.

## 2026-09-04 15:16 — verified in the app

- `pytest tests/ -q`: **34 passed** (13 new across `test_vol_indices.py` and
  `test_overview_cache.py`), `tsc --noEmit` clean.
- Browser (localhost:5173, reload): first `/api/market/overview` fetch **36 ms**,
  first contentful paint 668 ms, **187 tiles rendered, 0 showing "—"**, and no
  `/api/market/overview/gaps` request at all. Repeat polls 20-64 ms.

Remaining: docs + push.
