# Self-hosting Trailhead

Trailhead is self-hosted. There is no hosted API and no account to sign up for —
you run the backend, and it is yours. The only external dependency is a Gemini
API key, and even that is optional while you try it out (offline mode, below).

Everything below assumes you are at the repo root.

---

## Prerequisites

| | |
|---|---|
| **Docker** | Docker Desktop, OrbStack, or Docker Engine with the Compose v2 plugin (`docker compose version`). |
| **A Gemini API key** | Free at <https://aistudio.google.com/apikey>. Optional for a first look: see [Try it without a key](#try-it-without-a-key-offline-mode). |
| **Node 22.6+** | Only needed to run the *clients* (browser extension, VS Code extension, MCP server, dashboard). The API itself runs entirely inside Docker. |

---

## Start the API

```bash
cp .env.example .env      # then open .env and set GEMINI_API_KEY=...
docker compose up
```

That's it. On the first run Compose will:

1. Start Postgres 16 on a named volume (`trailhead-pgdata`), so your data
   survives restarts.
2. Apply `packages/db/schema.sql` automatically — Postgres runs anything in
   `/docker-entrypoint-initdb.d` the first time it initialises a data
   directory, so there is no manual `psql` step.
3. Wait for Postgres to pass `pg_isready`, then start the API.

The API is then on **<http://localhost:3000>**. Check it:

```bash
curl http://localhost:3000
# {"name":"trailhead-api","status":"ok",...}
```

If `GEMINI_API_KEY` is missing (and `TRAILHEAD_LLM` is not `offline`), the API
refuses to start and logs what to set; Compose keeps restarting it until you
fix `.env`. It never quietly falls back to offline mode.

### Try it without a key (offline mode)

```bash
TRAILHEAD_LLM=offline docker compose up
```

Same stack, no model, nothing sent to Google:

- `/score` and `/coach` use the rule-based scorer in
  `packages/scoring/src/heuristic-score.mjs`. It reads surface features (file
  paths, identifiers, constraint and output phrasing), so it is a reasonable
  floor, not a substitute for the model; `apps/api/eval/README.md` has its
  numbers and known misses. Every response carries `"scorer": "heuristic"`,
  and coaching text ends with a note saying no model was involved.
- Coaching uses the static per-dimension templates (plus your team's library
  prompts when there are any). `/improve` asks the template question for each
  weak dimension and appends your answers; `/diff` names the biggest gap.
- The rich wiki bootstrap is unavailable (`503`); `bootstrap --minimal` works.
- `GET /` reports `"llm": "offline"`, and the API logs a warning at startup.
- Library promotion still applies its gate, but the confirming re-score is the
  same deterministic rules, so it confirms nothing. Set
  `TRAILHEAD_PROMOTION_MODE=review` if a team will rely on the library.

Run it in the background with `docker compose up -d`, and stop it with
`docker compose down`.

### Configuration

Every variable lives in `.env`, and every one except `GEMINI_API_KEY` has a
working default. See [`.env.example`](.env.example) for the annotated list. The
ones you are most likely to touch:

| Variable | Default | Why you'd change it |
|---|---|---|
| `GEMINI_API_KEY` | *(required unless offline)* | — |
| `TRAILHEAD_LLM` | `gemini` | `offline` to run with no model (see above). |
| `PORT` | `3000` | Something else already owns port 3000. Changing this means updating each client's API URL too. |
| `POSTGRES_PORT` | `5432` | You already run Postgres locally. |
| `DATABASE_URL` | *(the bundled Postgres)* | Use an external database (Neon, RDS) instead of the container. |
| `TRAILHEAD_ADMIN_TOKEN` | *(empty)* | Set it to restrict team registration to people you give it to. Do this before exposing the API. |
| `TRAILHEAD_DEMO_TEAM` | `on` (`off` when an admin token is set) | Turn the public demo team on or off explicitly. |
| `TRAILHEAD_ACCEPT_LEGACY_TOKENS` | `true` | Set `false` once every team has upgraded from a pre-2026-09-30 token. |
| `TRAILHEAD_AUTO_CREATE_TEAMS` | `false` | Legacy only: let unknown tokens create teams on the fly. Throwaway demos only. |

### Data management

```bash
docker compose down          # stop; data kept
docker compose down -v       # stop and DELETE the database volume
docker compose logs -f api   # follow API logs
docker compose up --build    # rebuild the API image after changing its source
```

The schema is only applied to a *fresh* volume. `schema.sql` is idempotent, so
if you need to re-apply it to an existing database:

```bash
docker compose exec -T postgres psql -U trailhead -d trailhead < packages/db/schema.sql
```

---

## Point the clients at it

Every client defaults to `http://localhost:3000`, so if you kept the default
`PORT` there is nothing to configure. If you changed `PORT`, or the API runs on
another machine, substitute your URL below.

### Browser extension

```bash
npm install
npm run build --workspace=apps/browser-ext
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select `apps/browser-ext/dist`.

The extension popup has an **API server** row showing exactly which URL it is
talking to, with a live connection check. Edit it there and press **Save** — the
change takes effect immediately on any open Claude.ai tab, no reload needed.

The manifest ships permission for `localhost` and `127.0.0.1`. Pointing the
extension at any other host triggers a one-time Chrome permission prompt when
you save; until it is granted, requests are refused with a console message
saying so. API calls are made by the extension's background service worker,
not by the Claude.ai page, so Chrome's Local Network Access protection
(which blocks public sites from calling `localhost`) doesn't get in the way.

### VS Code extension

Settings → search `trailhead.apiUrl` (or edit `settings.json`):

```jsonc
{
  "trailhead.apiUrl": "http://localhost:3000"
}
```

If the API is unreachable, the extension raises a notification naming the
setting rather than showing an empty sidebar.

### MCP server (Claude Code / Copilot)

The MCP package is not published to npm, so `npx trailhead-mcp` does not work.
Run the CLI by path from this clone (after `npm install` at the root). It acts
on the current directory, so run it from the repo you want coached:

```bash
cd /path/to/your/repo
node /path/to/LearnLoop/apps/mcp-server/bin/cli.mjs init --api-url http://localhost:3000
```

That registers the repo's team on the API, saves the team **secret** the
server mints in `./.trailhead-team` (added to `.gitignore`), and writes
`.mcp.json` (and `.vscode/mcp.json` for Copilot) pointing at that file — the
secret itself is never written into the MCP configs. You can also set
`TRAILHEAD_API_URL` in your environment instead of passing `--api-url`.

**Teammates join** rather than register. Their `init` proposes the same team id
(it is derived from the repo's remote URL, normalised so https and ssh clones
agree), the API answers "already registered", and `init` tells them to get the
secret from someone on the team — it is in that person's `.trailhead-team` —
and run:

```bash
node /path/to/LearnLoop/apps/mcp-server/bin/cli.mjs init --team-token trailhead_sk_...
```

Share the secret the way you'd share any credential (password manager, DM),
not in the repo. The same secret goes into the browser extension popup
(**Select team**) and VS Code (`trailhead.teamToken`, in *User* settings).

**Upgrading from a pre-2026-09-30 install.** Old installs use a token derived
from the git remote URL (`repo_…`). It keeps working while
`TRAILHEAD_ACCEPT_LEGACY_TOKENS=true` (the default) — responses carry a
`Deprecation` header and `init` prints a warning. To upgrade, one person runs
`init --upgrade-legacy` in the repo: the team keeps its data and gets a secret,
and the old token stops working for everyone, so share the new secret.
A teammate who then runs `init` without it is told to ask for the secret
(rather than getting a new, empty team).
Read [Security model](#security-model) before exposing the API beyond localhost.

Then seed the wiki from the repo:

```bash
node /path/to/LearnLoop/apps/mcp-server/bin/cli.mjs bootstrap
```

### Dashboard

```bash
npm run dev --workspace=apps/dashboard
```

Runs on <http://localhost:3001> and shows one team: the one whose secret is in
`TRAILHEAD_TEAM_TOKEN` (default: the public demo team), from the API at
`TRAILHEAD_API_URL` (default `http://localhost:3000`):

```bash
TRAILHEAD_API_URL=http://localhost:8080 \
TRAILHEAD_TEAM_TOKEN="$(cat /path/to/your/repo/.trailhead-team)" \
  npm run dev --workspace=apps/dashboard
```

Both are read on the server at runtime. The browser never gets the secret:
client-side charts go through the dashboard's own read-only proxy
(`/api/trailhead/*`, GET only). The API only has to be reachable from the
dashboard server, not from visitors. The old `NEXT_PUBLIC_API_URL` /
`NEXT_PUBLIC_TEAM_TOKEN` names still work as fallbacks but are deprecated.

---

## Security model

Each team has two things:

- a **team id** — public. For a repo it is `team_` + a hash of the normalised
  git remote URL, so every clone proposes the same one. Safe to print or share.
- a **team secret** (`trailhead_sk_…`) — the credential, sent as
  `X-Team-Token`. The API mints it when the team is registered
  (`POST /teams`, which `init` calls) and stores only its SHA-256. Holding it
  grants read on that team's wiki — which the rich bootstrap fills with
  summaries of your source code — and write on everything, including
  `DELETE /team/data`. Rotate it with `POST /teams/rotate-secret`.

The defaults are safe for a local setup because both ports are bound to
`127.0.0.1`. Before making the API reachable from anywhere else:

- **Set `TRAILHEAD_ADMIN_TOKEN`.** Registration is open otherwise: anyone who
  can reach the port can create teams and spend your Gemini quota, and can
  *squat* a repo's derived team id before the real team registers it. With it
  set, pass it to `init --admin-token` (or hand people pre-made secrets).
  Setting it also turns the public demo team off (below).
- **Turn legacy tokens off** (`TRAILHEAD_ACCEPT_LEGACY_TOKENS=false`) once every
  team has run `init --upgrade-legacy`. A legacy token is
  `repo_` + SHA-256 of the raw remote URL: anyone who knows or guesses the URL
  can compute it — and can then not only read, write and wipe the team but
  also call `POST /teams/rotate-secret` first and lock the real team out
  (recovery needs the operator: `UPDATE teams SET secret_hash = NULL WHERE
  token = 'repo_…'`, then upgrade again at once). So upgrade promptly. The API
  marks every response to a legacy token with `Deprecation: true` and logs the
  number of legacy teams at startup.
- **Keep `TRAILHEAD_AUTO_CREATE_TEAMS=false`** (the default). With it on, any
  string sent as a token creates a legacy team.
- **Don't commit `.trailhead-team`.** `init` adds it to `.gitignore`. The MCP
  configs it writes reference the file instead of containing the secret. Old
  configs that embed `TRAILHEAD_TEAM_TOKEN` still work — re-run `init` to
  switch them over.
- **A deployed dashboard is a read-only window on its team.** It keeps the
  secret server-side, but anyone who can open it can read that team's wiki and
  metrics through it. Put it behind your SSO/VPN if that matters.
- **The demo team's secret `trailhead_demo_acme_2026` is public** (it is in this
  repo). The demo team is protected from `DELETE /team/data` and from secret
  rotation, but not from writes or from spending your quota. It is **off by
  default once `TRAILHEAD_ADMIN_TOKEN` is set**: its secret then gets
  `401 demo_team_disabled`. `TRAILHEAD_DEMO_TEAM=on|off` overrides that either
  way, and `GET /` reports the current setting as `demo_team`.

**Rate limits.** The API limits the calls that cost you something, with
in-process token buckets (a limit of `N/W` allows a burst of N and refills at N
per W). Over the limit it answers `429` with `Retry-After`. The clients treat
that like any other API failure: coaching fails open and the prompt is sent
uncoached, and the MCP `coach` tool, the extension console and VS Code say why.

| Variable | Default | Limits |
|---|---|---|
| `TRAILHEAD_RL_REGISTER_PER_IP` | `10/1h` | `POST /teams` (registration) per client IP |
| `TRAILHEAD_RL_LLM_PER_TEAM` | `120/1m` | Gemini-backed routes (`/score`, `/coach`, `/improve`, `/diff`, `/onboard/repo/full`) per team |
| `TRAILHEAD_RL_LLM_PER_IP` | `120/1m` | the same routes per client IP, across teams |
| `TRAILHEAD_RL_BOOTSTRAP_PER_TEAM` | `6/1h` | `/onboard/repo/full` per team (each run fans out into many Gemini calls) |

Any of them can be `off`; `TRAILHEAD_RATE_LIMIT=off` disables all. Values use
`s`, `m` or `h` (`30/1m`, `5/10m`). Two caveats:

- **Single process.** Buckets live in the API process's memory. Several
  replicas each enforce their own limit (so the effective limit is N×), and a
  restart resets them. For a multi-replica deploy, put limits in your reverse
  proxy or move the buckets to a shared store such as Redis.
- **Client IP.** The per-IP key is the TCP peer address (IPv6 per /64, since
  one host can use a fresh address from its /64 for every request). Behind a
  reverse proxy that would be the proxy itself, so set
  `TRAILHEAD_TRUST_PROXY=true` to use the **last** `X-Forwarded-For` entry
  instead: the address your proxy appended. Earlier entries are whatever the
  client sent. This assumes exactly one proxy hop that appends to (or
  overwrites) the header, as nginx, Caddy and Traefik do. Leave it off without
  such a proxy, or clients could choose their own key. Under the default
  Docker setup every local client shares one address, which is fine for a
  single machine.
- **Memory.** Each limit keeps at most 50,000 client buckets. Past that, the
  least recently used are forgotten (those clients start with a full bucket),
  so a flood of distinct addresses can't grow memory without bound.

Request bodies are capped at 2 MB (24 MB for `/onboard/repo/full`) and
rejected with `413` before they are read into memory.

**Team-authored text is treated as untrusted.** Wiki rules, learnings and
library prompts are written by anyone holding the team secret, and they are
fed to LLMs: Gemini's system instructions (scoring, teaching, `/improve`), the
browser extension's context bundle in your Claude.ai messages, and Claude
Code / Copilot via the MCP tools. All three wrap that text in
`<team_content>` tags with a rule that it is reference data, and neutralise any
copy of the tag inside it so it can't close the fence early; coach reveals put
examples in a markdown fence the example can't break out of. That is a
mitigation, not a guarantee.

**Getting into the library is gated.** A `/coach` prompt is promoted only if
the *exact* average of its five scores is ≥ 7.0 and no dimension is below 5,
**and** an independent re-score without the team's wiki context agrees (one
extra Gemini call per candidate). Set `TRAILHEAD_PROMOTION_MODE=review` to also
require a teammate's approval: candidates wait in `GET /prompts/pending` until
someone calls `POST /prompts/:id/review` with `{"approve": true}` (or `false`
to discard). The default is `auto` so the library grows without admin work;
`review` trades that for a human check. Anyone with the team secret can
review — user ids are self-asserted, so "not the author" is a convention.

**Who is who.** Each client sends a `user_id` with scores and captures. It is a
random UUID generated once per install — browser extension (chrome.storage),
VS Code (`globalState`), MCP server (`~/.config/trailhead/user-id`) — and is not
derived from any account, hostname or git identity. It lets the team's server
chart one person's scores over time (`GET /skill-arc?user_id=…`, "active users"
on the dashboard), and anyone holding the team secret can read those per-id
scores. It is **on by default** because per-user progress is the product's
point; to opt out, untick *Send an anonymous per-install ID* in the extension
popup, set `trailhead.shareUserId: false` in VS Code, or
`TRAILHEAD_SHARE_USER_ID=false` for the MCP server — writes are then sent as
`anonymous` and only count toward team totals. (Before 2026-09-30 every client
sent the same `demo` id.)

Where prompts go: every scored prompt, any wiki context attached to it, and —
for the default rich `bootstrap` — the first 8,000 characters of up to 500
source files (5 levels deep) are sent to Google's Gemini API
using your `GEMINI_API_KEY` (in offline mode nothing is sent to Google). When
`LANGFUSE_*` keys are set, the same model
inputs and outputs are also sent to Langfuse. The browser extension's 👍/🤷/👎
chips store the prompt *and Claude's full reply* in the `captures` table.
`bootstrap` picks files by extension (so `.env` and key files are never read)
and skips anything git ignores (`git check-ignore`: nested `.gitignore`s,
`.git/info/exclude` and your global excludes all count). Outside a git repo
there is nothing to consult, so every matching file inside the walk depth is
uploaded.

---

## Troubleshooting

**The API restarts in a loop and logs "GEMINI_API_KEY not set"**
You skipped `cp .env.example .env`, or left the key blank. `.env` must be at the
repo root, next to `docker-compose.yml`. To try the stack without a key, set
`TRAILHEAD_LLM=offline` instead.

**API restarts in a loop / `DATABASE_URL not set`**
`DATABASE_URL` is set in your `.env` but points somewhere unreachable. Comment
it out to fall back to the bundled Postgres.

**Port already in use**
Change `PORT` (API) or `POSTGRES_PORT` (Postgres) in `.env`, then re-run
`docker compose up`. Remember to update the clients if you changed `PORT`.

**Clients show no data / "can't reach the API"**
Confirm `curl http://localhost:3000` answers. Each client names the exact
setting to fix in its own error message: the popup's **API server** row,
`trailhead.apiUrl`, `TRAILHEAD_API_URL`, or `NEXT_PUBLIC_API_URL`.

**Schema changes didn't apply**
`docker-entrypoint-initdb.d` only runs on a fresh volume. Either
`docker compose down -v` (destroys data) or pipe `schema.sql` through `psql` as
shown above.
