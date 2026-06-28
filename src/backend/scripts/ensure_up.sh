#!/bin/bash
#
# ensure_up.sh — long-running supervisor daemon for the Market Pulse LaunchAgent.
#
# IMPORTANT: this script must STAY RUNNING the whole time the app should be up.
# Under launchd, when a job's main process exits, launchd tears down the entire
# job — killing even nohup/disown'd children (the backend, frontend and ngrok).
# An earlier "start detached, then exit" version (RunAtLoad + StartInterval)
# therefore thrashed: every tick it started the servers, exited, and launchd
# immediately killed them again, so the public URL was offline almost always
# (ERR_NGROK_3200). Instead we run an infinite ensure-loop and let launchd keep
# THIS process alive (KeepAlive); the servers live in our process group and so
# survive as long as we do.
#
# It is idempotent — it (re)starts the app servers (backend :8000 + frontend
# :5173) and the ngrok tunnel only when they are down, and is silent in the log
# when everything is healthy. That gives crash and wake-from-sleep recovery
# within one interval (a sleeping Mac drops the tunnel; it comes back on wake).
#
# The underlying scripts it calls are themselves idempotent:
#   - market-pulse-server start   -> no-op if both ports are already listening
#   - start_tunnel.sh start       -> no-op if a tunnel is already up
#
# Started by the LaunchAgent as `/bin/zsh -c <this script>` so that ~/.zshenv is
# sourced first, giving the full PATH (node/npm live in ~/.local/bin, ngrok in
# /opt/homebrew/bin) that launchd's minimal default PATH would otherwise miss.
set -uo pipefail

REPO_ROOT="/Users/jianfuchen/projects/market-pulse"
SERVER_CMD="/Users/jianfuchen/mycmd/market-pulse-server"
TUNNEL_CMD="$REPO_ROOT/src/backend/scripts/start_tunnel.sh"
LSOF="/usr/sbin/lsof"
LOG="$REPO_ROOT/tmp/supervisor.log"
INTERVAL="${MP_SUPERVISOR_INTERVAL:-60}"   # seconds between health checks
mkdir -p "$REPO_ROOT/tmp"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$LOG"; }

port_up()   { [ -n "$("$LSOF" -ti tcp:"$1" 2>/dev/null)" ]; }
tunnel_up() { curl -sS -m 3 "http://127.0.0.1:4040/api/tunnels" 2>/dev/null | grep -q '"public_url":"https'; }

ensure_once() {
  # App servers (backend + frontend). market-pulse-server waits for readiness.
  if ! { port_up 8000 && port_up 5173; }; then
    log "app servers not fully up (8000/5173) — running 'market-pulse-server start'"
    "$SERVER_CMD" start >>"$LOG" 2>&1
  fi
  # Public tunnel. Needs the frontend up first, which the step above guarantees.
  if ! tunnel_up; then
    log "ngrok tunnel not up — running 'start_tunnel.sh start'"
    "$TUNNEL_CMD" start >>"$LOG" 2>&1
  fi
}

log "supervisor daemon started (pid $$, interval ${INTERVAL}s)"
while true; do
  ensure_once
  sleep "$INTERVAL"
done
