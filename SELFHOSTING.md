# Self-hosting Trailhead

Trailhead is self-hosted. There is no hosted API and no account to sign up for —
you run the backend, and it is yours. The only external dependency is a Gemini
API key.

Everything below assumes you are at the repo root.

---

## Prerequisites

| | |
|---|---|
| **Docker** | Docker Desktop, OrbStack, or Docker Engine with the Compose v2 plugin (`docker compose version`). |
| **A Gemini API key** | Free at <https://aistudio.google.com/apikey>. |
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

If `GEMINI_API_KEY` is missing, `docker compose up` stops immediately and tells
you so — it will not start a stack that cannot score a prompt.

Run it in the background with `docker compose up -d`, and stop it with
`docker compose down`.

### Configuration

Every variable lives in `.env`, and every one except `GEMINI_API_KEY` has a
working default. See [`.env.example`](.env.example) for the annotated list. The
ones you are most likely to touch:

| Variable | Default | Why you'd change it |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | — |
| `PORT` | `3000` | Something else already owns port 3000. Changing this means updating each client's API URL too. |
| `POSTGRES_PORT` | `5432` | You already run Postgres locally. |
| `DATABASE_URL` | *(the bundled Postgres)* | Use an external database (Neon, RDS) instead of the container. |
| `TRAILHEAD_ADMIN_TOKEN` | *(empty)* | Set it to restrict team registration to people you give it to. Do this before exposing the API. |
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
you save.

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
- **Turn legacy tokens off** (`TRAILHEAD_ACCEPT_LEGACY_TOKENS=false`) once every
  team has run `init --upgrade-legacy`. A legacy token is
  `repo_` + SHA-256 of the raw remote URL: anyone who knows or guesses the URL
  can compute it. The API marks every response to one with `Deprecation: true`.
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
  rotation, but not from writes.

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
- **Client IP.** The per-IP key is the TCP peer address. Behind a reverse
  proxy that would be the proxy itself, so set `TRAILHEAD_TRUST_PROXY=true` to
  use the first `X-Forwarded-For` entry instead — only when a proxy you
  control sets that header, or clients could choose their own key. Under the
  default Docker setup every local client shares one address, which is fine
  for a single machine.

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
using your `GEMINI_API_KEY`. When `LANGFUSE_*` keys are set, the same model
inputs and outputs are also sent to Langfuse. The browser extension's 👍/🤷/👎
chips store the prompt *and Claude's full reply* in the `captures` table.
`bootstrap` picks files by extension (so `.env` and key files are never read)
and skips anything git ignores (`git check-ignore`: nested `.gitignore`s,
`.git/info/exclude` and your global excludes all count). Outside a git repo
there is nothing to consult, so every matching file inside the walk depth is
uploaded.

---

## Troubleshooting

**`docker compose up` exits with "required variable GEMINI_API_KEY is missing"**
You skipped `cp .env.example .env`, or left the key blank. `.env` must be at the
repo root, next to `docker-compose.yml`.

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
