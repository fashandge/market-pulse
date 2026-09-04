#!/usr/bin/env python
"""Report TradingView's own real-time/delayed status for every overview symbol.

Answers "are these prices real-time?" with data instead of assumption. Whether a
symbol streams live or arrives delayed is an **exchange entitlement on the
TradingView account**, not something the fetch path chooses: the scanner REST
API, the websocket feed and the website all honour the same entitlement, so no
change to ``quotes.py`` or ``vol_indices.py`` can turn a delayed symbol
real-time. Only subscribing to that exchange's real-time data can.

TradingView publishes the entitlement per symbol as ``update_mode`` on its quote
websocket, which is what this script reads (using the same logged-in session
cookies as ``tv_session``):

    streaming                 real-time
    delayed_streaming_<secs>  delayed by that many seconds (900 = 15 min)
    endofday                  daily close only

Run from the repo root:

    python -m src.backend.scripts.check_quote_delay
    python -m src.backend.scripts.check_quote_delay NASDAQ:NVDA CBOE:VIX
"""

from __future__ import annotations

import collections
import json
import random
import re
import string
import sys
import time
import urllib.request

from src.backend import portfolio, quotes, tv_session

WS_URL = "wss://data.tradingview.com/socket.io/websocket?from=quote%2F&type=quote"
TOKEN_URL = "https://www.tradingview.com/quote_token/"
ORIGIN = "https://www.tradingview.com"
FIELDS = ["lp", "update_mode", "prev_close_price", "chp"]
BATCH = 40
TIMEOUT = 30


def _frame(payload: str) -> str:
    return f"~m~{len(payload)}~m~{payload}"


def _call(method: str, params: list) -> str:
    return _frame(json.dumps({"m": method, "p": params}))


def _auth_token(cookie: str) -> str:
    req = urllib.request.Request(TOKEN_URL, headers={
        "Cookie": cookie, "User-Agent": "Mozilla/5.0", "Referer": ORIGIN + "/",
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.load(resp)


def overview_symbols() -> list[str]:
    """Every ``EXCHANGE:SYMBOL`` the overview shows, minus the FRED series
    (published by FRED itself, end-of-day by nature, and unknown to TV)."""
    exchanges = {**dict(portfolio.load_holdings()), **quotes._load_symbol_exchanges()}
    return sorted(f"{e}:{s}" for s, e in exchanges.items() if e != "FRED")


def fetch_update_modes(symbols: list[str]) -> dict[str, dict]:
    import websocket  # websocket-client; only needed for this diagnostic

    cookie = tv_session.cookie_header()
    if not cookie:
        raise SystemExit(
            "No TradingView session cookies — the probe would report the "
            "anonymous entitlement, not yours. See tv_session.py."
        )
    ws = websocket.create_connection(WS_URL, timeout=10, header=[
        f"Origin: {ORIGIN}", "User-Agent: Mozilla/5.0", f"Cookie: {cookie}",
    ])
    ws.recv()  # server handshake must land before we send anything
    session = "qs_" + "".join(random.choices(string.ascii_lowercase, k=12))
    ws.send(_call("set_auth_token", [_auth_token(cookie)]))
    ws.send(_call("quote_create_session", [session]))
    ws.send(_call("quote_set_fields", [session, *FIELDS]))
    for i in range(0, len(symbols), BATCH):
        ws.send(_call("quote_add_symbols", [session, *symbols[i:i + BATCH]]))

    seen: dict[str, dict] = {}
    deadline = time.time() + TIMEOUT
    while time.time() < deadline and len(seen) < len(symbols):
        try:
            raw = ws.recv()
        except Exception:
            break
        for part in re.findall(r"~m~\d+~m~(.+?)(?=~m~\d+~m~|$)", raw):
            if part.startswith("~h~"):
                ws.send(_frame(part))  # heartbeat
                continue
            try:
                message = json.loads(part)
            except ValueError:
                continue
            if message.get("m") == "qsd":
                quote = message["p"][1]
                seen.setdefault(quote["n"], {}).update(quote.get("v") or {})
    ws.close()
    return seen


def main(argv: list[str]) -> int:
    symbols = argv[1:] or overview_symbols()
    quotes_by_symbol = fetch_update_modes(symbols)
    if not quotes_by_symbol:
        print("No quotes returned.")
        return 1

    counts = collections.Counter(
        v.get("update_mode") for v in quotes_by_symbol.values()
    )
    print(f"{len(quotes_by_symbol)}/{len(symbols)} symbols answered\n")
    for mode, count in counts.most_common():
        print(f"  {mode:<26} {count}")

    delayed = sorted(
        (s, v.get("update_mode"), v.get("lp"))
        for s, v in quotes_by_symbol.items()
        if (v.get("update_mode") or "streaming") != "streaming"
    )
    if delayed:
        print("\nNot real-time on this account:")
        for symbol, mode, last in delayed:
            secs = mode.rsplit("_", 1)[-1] if mode.startswith("delayed") else ""
            lag = f"{int(secs) // 60} min" if secs.isdigit() else mode
            print(f"  {symbol:<20} {lag:<10} last={last}")
    missing = sorted(set(symbols) - set(quotes_by_symbol))
    if missing:
        print(f"\nNo quote from TradingView (expected for licensed feeds): {missing}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
