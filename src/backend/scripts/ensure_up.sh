#!/bin/bash
#
# ensure_up.sh — supervisor for the Market Pulse LaunchAgent.
#
# Makes sure the app servers (backend :8000 + frontend :5173) and the public
# ngrok tunnel are running, starting whatever is down. It is idempotent and
# SILENT when everything is already healthy (only writes to the log when it
# actually takes action), so it is safe to run both at login (RunAtLoad) and on
# a short interval (StartInterval) for crash / wake-from-sleep recovery.
#
# The underlying scripts it calls are themselves idempotent:
#   - market-pulse-server start   -> no-op if both ports are already listening
#   - start_tunnel.sh start       -> no-op if a tunnel is already up
#
# Run by the LaunchAgent as `/bin/zsh -c <this script>` so that ~/.zshenv is
# sourced first, giving the full PATH (node/npm live in ~/.local/bin, ngrok in
# /opt/homebrew/bin) that launchd's minimal default PATH would otherwise miss.
set -uo pipefail

REPO_ROOT="/Users/jianfuchen/projects/market-pulse"
SERVER_CMD="/Users/jianfuchen/mycmd/market-pulse-server"
TUNNEL_CMD="$REPO_ROOT/src/backend/scripts/start_tunnel.sh"
LSOF="/usr/sbin/lsof"
LOG="$REPO_ROOT/tmp/supervisor.log"
mkdir -p "$REPO_ROOT/tmp"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$LOG"; }

port_up()   { [ -n "$("$LSOF" -ti tcp:"$1" 2>/dev/null)" ]; }
tunnel_up() { curl -sS -m 3 "http://127.0.0.1:4040/api/tunnels" 2>/dev/null | grep -q '"public_url":"https'; }

# App servers (backend + frontend). market-pulse-server waits for readiness.
if ! { port_up 8000 && port_up 5173; }; then
  log "app servers not fully up (8000/5173) — running 'market-pulse-server start'"
  "$SERVER_CMD" start >>"$LOG" 2>&1
fi

# Public tunnel. The tunnel needs the frontend up first, which the step above
# guarantees (it blocks until the ports are listening).
if ! tunnel_up; then
  log "ngrok tunnel not up — running 'start_tunnel.sh start'"
  "$TUNNEL_CMD" start >>"$LOG" 2>&1
fi

exit 0
