# Operations: Running, Tunnel, Auto-Start

How the app is launched, exposed publicly, and kept alive. `CLAUDE.md` has the short rules; this file has the mechanics and the why.

## `market-pulse-server` and the cmux `NODE_OPTIONS` trap

**Prefer `market-pulse-server` (in `~/mycmd/`) over launching `uvicorn` by hand**, especially
when starting from inside a cmux/Claude Code terminal. cmux injects a transient
`NODE_OPTIONS=--require=…/cmux-claude-node-options/restore-node-options.cjs` shim into the shell;
once that temp file is cleaned up the env var dangles, so any `node` the backend spawns (the
Playwright driver behind `tv_session`, and vite) aborts with `MODULE_NOT_FOUND`. The visible symptom
is that **quotes go delayed**: `tv_session` can no longer launch the browser to read the logged-in
TradingView cookies, so `quotes.py` silently falls back to the anonymous (delayed) scanner endpoint.
Nothing 500s — the overview still renders, just minutes behind the tape on fast movers.
`market-pulse-server` self-heals this: it detects a cmux shell and drops
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

## Home Wi-Fi access

Other devices on the home Wi-Fi open `http://<Mac's LAN IP>:5173` (Vite prints it as `Network:` in
`tmp/frontend.log`). `vite.config.ts` sets `server.host: true` so Vite listens on the LAN; the backend
stays bound to 127.0.0.1 and is reached only through Vite's `/api` proxy. Nothing is on the public
internet. Chrome shows "Not secure" because it is plain HTTP; there is no login either, so anyone on
the Wi-Fi can open it. If that ever matters, `tailscale serve` (real HTTPS, own devices only) beats a
self-signed or mkcert certificate, which every device would have to trust.

The proxy runs with `xfwd: true`, appending the real client address to `X-Forwarded-For` — without it
every proxied request reaches the backend as 127.0.0.1. `is_local_request` (`main.py`) treats a request
as this Mac only when the Host is localhost/127.0.0.1/[::1] **and** the client plus every
`X-Forwarded-For` hop are loopback. The General tab's proposal-log panel (which launches a headless
`claude -p` with user-typed instructions) is served only to such requests: other devices see the
report's plain "Proposed log" list, and the log-proposals endpoints return 403. Opening the Mac's own
LAN IP from the Mac counts as a Wi-Fi device too — use `localhost:5173` there.

## Public access (temporary tunnel) — off by default

The public tunnel is **not** started by the supervisor any more (it was public with no auth). To
share the running app on a temporary public URL anyway, start it by hand and stop it after:

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

### Tunnel URL shows a blank page (ngrok free-tier interstitial)

**Symptom:** the ngrok URL loads an entirely empty page — no dashboard, no error — and reloading
does not help. The same URL works fine in a fresh browser profile.

**Fix (takes ~10 seconds):** in the affected browser, open DevTools (Cmd+Opt+J) →
**Application** → **Cookies**, delete everything for the ngrok host (the
`*.ngrok-free.dev` hostname from `start_tunnel.sh status`), then hard-reload with **Cmd+Shift+R**. The ngrok
warning page appears; click **Visit Site** and the dashboard loads. To confirm the diagnosis
first, open the **Console** — a blank page from this cause always shows a MIME-type error naming
`text/html` on a module script.

**Why it happens:** ngrok's free tier gates the whole site behind an abuse interstitial
(`ERR_NGROK_6024`), dismissed by a per-browser cookie. Without that cookie ngrok answers *every*
request with the interstitial — not just page loads, but `/src/main.tsx`, `/@vite/client` and
`/api/...` too — and it does so as **HTTP 200 with `content-type: text/html`**, so status codes
alone look healthy. When the browser has the document but no valid cookie, the JS modules come
back as HTML, Chrome's strict MIME checking refuses to execute them, React never mounts, and
`main.tsx` renders `<App/>` with no error boundary, so nothing reports the failure. A reload
repeats the identical sequence, which is why refreshing never clears it.

**Do not waste time checking the server** — this failure looks exactly like a dead backend but
isn't. `curl`ing the tunnel is misleading unless you inspect `content-type`, since the interstitial
returns 200; `curl -sD- -H 'ngrok-skip-browser-warning: 1'` bypasses it and shows the true response.

**Permanent fix:** remove the interstitial, either by upgrading to any paid ngrok plan (keeps the
static hostname) or by switching the tunnel to cloudflared, which has no interstitial —
`allowedHosts` already whitelists `.trycloudflare.com`. Note the DNS caveat above: some
routers/ISPs block `*.trycloudflare.com`. Adding an error boundary around `<App/>` would surface
this class of failure instead of showing a blank page.

## Auto-start on login (LaunchAgent)

A LaunchAgent keeps the app running without manual commands:

- `deploy/launchd/com.jianfuchen.market-pulse.plist` — symlinked into `~/Library/LaunchAgents/`.
- It runs `src/backend/scripts/ensure_up.sh`, a **long-running supervisor daemon** started at
  login (`RunAtLoad`) and kept alive by launchd (`KeepAlive`). The daemon loops forever,
  re-checking every 60s and (re)starting the app servers (`market-pulse-server`) only if they
  are down; it is silent in the log when everything is healthy. This gives login-start **plus**
  crash / wake-from-sleep recovery within ~a minute. It does not start the ngrok tunnel.
- It must NOT be a one-shot (`StartInterval`/`RunAtLoad`-then-exit): under launchd, when a job's
  main process exits, launchd kills the whole job — including the `nohup`/`disown`'d backend,
  frontend it just started. The daemon stays running so the servers (in its process
  group) stay up; `KeepAlive` only restarts the daemon itself if it ever dies.
- It runs via `/bin/zsh` so `~/.zshenv` supplies the full PATH (node/npm live in `~/.local/bin`)
  that launchd's minimal default PATH would otherwise miss.
- Logs: `tmp/supervisor.log` (actions only) and `tmp/launchd.{out,err}.log`.
- After editing `ensure_up.sh`, reload the running daemon with
  `launchctl kickstart -k gui/$(id -u)/com.jianfuchen.market-pulse` — the old loop keeps running otherwise.

Enable/disable:

```bash
launchctl load   ~/Library/LaunchAgents/com.jianfuchen.market-pulse.plist   # enable
launchctl unload ~/Library/LaunchAgents/com.jianfuchen.market-pulse.plist   # disable
```
