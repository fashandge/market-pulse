#!/usr/bin/env bash
#
# start_tunnel.sh — expose the local Market Pulse app on a temporary public ngrok URL.
#
# The Vite dev server (:5173) proxies /api to the FastAPI backend (:8000), so a single
# tunnel to the frontend port serves the whole app (UI + API + local duckdb data).
#
# The tunnel is started DETACHED (nohup + disown), so it keeps running after the
# launching shell exits. It survives until you stop it explicitly or the Mac sleeps.
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
#   src/backend/scripts/start_tunnel.sh            # start the tunnel (detached) and print the URL
#   src/backend/scripts/start_tunnel.sh status     # show the current public URL (if any)
#   src/backend/scripts/start_tunnel.sh stop        # stop the running tunnel
#   FRONTEND_PORT=5173 BACKEND_PORT=8000 src/backend/scripts/start_tunnel.sh

set -euo pipefail

FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
NGROK_API="http://127.0.0.1:4040/api/tunnels"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOG_DIR="$REPO_ROOT/tmp"
NGROK_LOG="$LOG_DIR/ngrok.log"
PID_FILE="$LOG_DIR/ngrok.pid"
mkdir -p "$LOG_DIR"

# --- helper: query ngrok's local API for the current public URL --------------
current_public_url() {
  curl -sS -m 3 "$NGROK_API" 2>/dev/null \
    | grep -oE '"public_url":"https://[^"]+"' \
    | sed -E 's/"public_url":"//; s/"$//' | head -1 || true
}

# --- locate ngrok -----------------------------------------------------------
NGROK_BIN="${NGROK_BIN:-$(command -v ngrok || true)}"
if [[ -z "$NGROK_BIN" && -x /opt/homebrew/bin/ngrok ]]; then
  NGROK_BIN=/opt/homebrew/bin/ngrok
fi

# --- subcommand: status ------------------------------------------------------
CMD="${1:-start}"
if [[ "$CMD" == "status" ]]; then
  URL="$(current_public_url)"
  if [[ -n "$URL" ]]; then
    echo "Tunnel is up: $URL"
    exit 0
  fi
  echo "No tunnel running (nothing answering on $NGROK_API)."
  exit 1
fi

# --- subcommand: stop --------------------------------------------------------
if [[ "$CMD" == "stop" ]]; then
  stopped=0
  if [[ -f "$PID_FILE" ]]; then
    PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null && stopped=1
    fi
    rm -f "$PID_FILE"
  fi
  # Fallback: kill any stray ngrok http agent (e.g. PID file lost).
  if pkill -f "ngrok http" 2>/dev/null; then stopped=1; fi
  if [[ "$stopped" == 1 ]]; then
    echo "Stopped ngrok tunnel."
  else
    echo "No ngrok tunnel was running."
  fi
  exit 0
fi

# === start ===================================================================
if [[ -z "$NGROK_BIN" ]]; then
  echo "ERROR: ngrok not found. Install it:  brew install ngrok" >&2
  exit 1
fi

# --- already running? --------------------------------------------------------
EXISTING_URL="$(current_public_url)"
if [[ -n "$EXISTING_URL" ]]; then
  echo "A tunnel is already running: $EXISTING_URL"
  echo "  Stop it first with:  $0 stop"
  exit 0
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

# --- start ngrok DETACHED ---------------------------------------------------
# nohup + disown so the tunnel outlives this shell. Output goes to NGROK_LOG.
echo "Starting ngrok tunnel -> http://localhost:${FRONTEND_PORT} (detached) ..."
nohup "$NGROK_BIN" http "$FRONTEND_PORT" --log=stdout --log-format=logfmt >"$NGROK_LOG" 2>&1 &
NGROK_PID=$!
disown "$NGROK_PID" 2>/dev/null || disown 2>/dev/null || true
echo "$NGROK_PID" > "$PID_FILE"

# --- wait for the public URL (ngrok's local API; matches .dev/.app/.io) -----
PUBLIC_URL=""
for _ in $(seq 1 30); do
  PUBLIC_URL="$(current_public_url)"
  [[ -n "$PUBLIC_URL" ]] && break
  if ! kill -0 "$NGROK_PID" 2>/dev/null; then
    echo "ERROR: ngrok exited early. Log tail:" >&2
    tail -n 15 "$NGROK_LOG" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
  sleep 1
done

if [[ -z "$PUBLIC_URL" ]]; then
  echo "ERROR: could not obtain ngrok public URL. Log tail:" >&2
  tail -n 15 "$NGROK_LOG" >&2
  kill "$NGROK_PID" 2>/dev/null || true
  rm -f "$PID_FILE"
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
echo "  pid:        $NGROK_PID  ($PID_FILE)"
echo "------------------------------------------------------------"
echo "  Running DETACHED — safe to close this shell."
echo "  Stop with:   $0 stop"
echo "  Temporary URL — changes on restart. Public + no auth."
echo "  Keep this Mac awake with the app running."
echo "============================================================"
