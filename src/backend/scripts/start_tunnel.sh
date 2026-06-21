#!/usr/bin/env bash
#
# start_tunnel.sh — expose the local Market Pulse app on a temporary public ngrok URL.
#
# The Vite dev server (:5173) proxies /api to the FastAPI backend (:8000), so a single
# tunnel to the frontend port serves the whole app (UI + API + local duckdb data).
#
# Prerequisites:
#   - ngrok installed            (brew install ngrok)
#   - ngrok authtoken configured (ngrok config add-authtoken <TOKEN>)
#       get a free token at https://dashboard.ngrok.com/get-started/your-authtoken
#   - the app already running     (market-pulse-server, or backend + `npm run dev`)
#   - vite.config.ts allowedHosts must include '.ngrok-free.dev' / '.ngrok-free.app'
#     (already configured in this repo)
#
# Usage:
#   src/backend/scripts/start_tunnel.sh
#   FRONTEND_PORT=5173 BACKEND_PORT=8000 src/backend/scripts/start_tunnel.sh
#
# The tunnel stays up until you press Ctrl+C (which stops ngrok).

set -euo pipefail

FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
NGROK_API="http://127.0.0.1:4040/api/tunnels"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOG_DIR="$REPO_ROOT/tmp"
NGROK_LOG="$LOG_DIR/ngrok.log"
mkdir -p "$LOG_DIR"

# --- locate ngrok -----------------------------------------------------------
NGROK_BIN="${NGROK_BIN:-$(command -v ngrok || true)}"
if [[ -z "$NGROK_BIN" && -x /opt/homebrew/bin/ngrok ]]; then
  NGROK_BIN=/opt/homebrew/bin/ngrok
fi
if [[ -z "$NGROK_BIN" ]]; then
  echo "ERROR: ngrok not found. Install it:  brew install ngrok" >&2
  exit 1
fi

# --- check authtoken --------------------------------------------------------
if ! "$NGROK_BIN" config check >/dev/null 2>&1; then
  echo "ERROR: ngrok has no valid config/authtoken." >&2
  echo "  Get a free token: https://dashboard.ngrok.com/get-started/your-authtoken" >&2
  echo "  Then run:         $NGROK_BIN config add-authtoken <YOUR_TOKEN>" >&2
  exit 1
fi

# --- check the frontend is actually up (ngrok connects via localhost) -------
# Vite binds IPv6 localhost, so probe 'localhost' (not 127.0.0.1).
if ! curl -sS -m 4 -o /dev/null "http://localhost:${FRONTEND_PORT}/" 2>/dev/null; then
  echo "WARNING: nothing answering on http://localhost:${FRONTEND_PORT}/" >&2
  echo "  Start the app first (e.g. 'market-pulse-server'), then re-run this script." >&2
  echo "  Continuing anyway — ngrok will serve errors until the frontend is up." >&2
fi
if ! curl -sS -m 4 -o /dev/null "http://localhost:${BACKEND_PORT}/api/tickers/portfolio" 2>/dev/null; then
  echo "WARNING: backend not answering on http://localhost:${BACKEND_PORT}/ — /api calls will fail." >&2
fi

# --- start ngrok ------------------------------------------------------------
echo "Starting ngrok tunnel -> http://localhost:${FRONTEND_PORT} ..."
"$NGROK_BIN" http "$FRONTEND_PORT" --log=stdout --log-format=logfmt >"$NGROK_LOG" 2>&1 &
NGROK_PID=$!

cleanup() {
  echo
  echo "Stopping ngrok (pid $NGROK_PID) ..."
  kill "$NGROK_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- wait for the public URL (ngrok's local API; matches .dev/.app/.io) -----
PUBLIC_URL=""
for _ in $(seq 1 30); do
  # NB: grep exits non-zero until the URL appears; `|| true` keeps `set -e` from
  # aborting the poll loop on those expected early misses.
  PUBLIC_URL="$(curl -sS -m 3 "$NGROK_API" 2>/dev/null \
    | grep -oE '"public_url":"https://[^"]+"' \
    | sed -E 's/"public_url":"//; s/"$//' | head -1 || true)"
  [[ -n "$PUBLIC_URL" ]] && break
  if ! kill -0 "$NGROK_PID" 2>/dev/null; then
    echo "ERROR: ngrok exited early. Log tail:" >&2
    tail -n 15 "$NGROK_LOG" >&2
    exit 1
  fi
  sleep 1
done

if [[ -z "$PUBLIC_URL" ]]; then
  echo "ERROR: could not obtain ngrok public URL. Log tail:" >&2
  tail -n 15 "$NGROK_LOG" >&2
  exit 1
fi

# --- verify reachability through the tunnel ---------------------------------
APP_CODE="$(curl -sS -m 12 -H 'ngrok-skip-browser-warning: 1' -o /dev/null -w '%{http_code}' "$PUBLIC_URL/" 2>/dev/null || echo 000)"
API_CODE="$(curl -sS -m 12 -H 'ngrok-skip-browser-warning: 1' -o /dev/null -w '%{http_code}' "$PUBLIC_URL/api/tickers/portfolio" 2>/dev/null || echo 000)"

echo
echo "============================================================"
echo "  Market Pulse is live at:"
echo "    $PUBLIC_URL"
echo "------------------------------------------------------------"
echo "  app:  HTTP $APP_CODE      api:  HTTP $API_CODE"
echo "  inspector:  http://127.0.0.1:4040"
echo "  log:        $NGROK_LOG"
echo "------------------------------------------------------------"
echo "  Temporary URL — changes on restart. Public + no auth."
echo "  Keep this Mac awake with the app running. Ctrl+C to stop."
echo "============================================================"

# keep the tunnel alive in the foreground
wait "$NGROK_PID"
