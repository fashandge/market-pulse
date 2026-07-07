# Operations: Running, Tunnel, Auto-Start

How the app is launched, exposed publicly, and kept alive. `CLAUDE.md` has the short rules; this file has the mechanics and the why.

## `market-pulse-server` and the cmux `NODE_OPTIONS` trap

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

Manual alternative (two terminals):

```bash
# Terminal 1 - Backend (port 8000)
cd /Users/jianfuchen/projects/market-pulse
/opt/homebrew/Caskroom/miniconda/base/envs/ml/bin/python -m uvicorn src.backend.main:app --reload

# Terminal 2 - Frontend (port 5173)
cd /Users/jianfuchen/projects/market-pulse/src/frontend
npm run dev
```

## Public access (temporary tunnel)

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

## Auto-start on login (LaunchAgent)

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
