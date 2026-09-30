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
| `TRAILHEAD_AUTO_CREATE_TEAMS` | `true` | Set `false` to stop unknown team tokens from creating teams on the fly. |

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

That writes `.mcp.json` (and `.vscode/mcp.json` for Copilot) with
`TRAILHEAD_API_URL` set, and derives a team token from your git remote so
teammates cloning the same repo land in the same team. You can also set
`TRAILHEAD_API_URL` in your environment instead. Read
[Security model](#security-model) before exposing the API beyond localhost.

Then seed the wiki from the repo:

```bash
node /path/to/LearnLoop/apps/mcp-server/bin/cli.mjs bootstrap
```

### Dashboard

```bash
npm run dev --workspace=apps/dashboard
```

Runs on <http://localhost:3001> and reads the API at `NEXT_PUBLIC_API_URL`,
defaulting to `http://localhost:3000`. To point elsewhere:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev --workspace=apps/dashboard
```

`NEXT_PUBLIC_*` values are baked in at build time, so a **deployed** dashboard
must set `NEXT_PUBLIC_API_URL` before `next build`, and the API must be
reachable from the visitor's browser. When it isn't set, the Teams page says so
and names the variable.

---

## Security model

The API has one credential: the team token sent as `X-Team-Token`. Holding it
grants read on that team's wiki — which the rich bootstrap fills with summaries
of your source code — and write on everything, including `DELETE /team/data`.
Tenants are isolated from each other only by knowing different tokens.

The defaults are safe **because** both ports are bound to `127.0.0.1`. Before
you make the API reachable from anywhere else, know that:

- **Remote-derived tokens are guessable.** `init` derives the token as `repo_` +
  the first 16 hex chars of SHA-256 of `git remote get-url origin`. Anyone who
  knows (or guesses) a repo's URL can compute it. On a shared server, create
  tokens with `init --team-token "$(openssl rand -hex 16)"` and share them out of
  band.
- **`init` writes the token in plain text** into `.mcp.json` and
  `.vscode/mcp.json`. Don't commit those files if the token matters.
- **Set `TRAILHEAD_AUTO_CREATE_TEAMS=false`.** With it on, any string creates a
  tenant, so anyone who can reach the port can spend your Gemini quota.
- **A deployed dashboard publishes its token.** The dashboard renders
  `NEXT_PUBLIC_TEAM_TOKEN` into its `?team=` links, and the charts call the API
  from the visitor's browser with it in `X-Team-Token`. Treat a public
  dashboard as making that team world-readable and -writable.
- **The demo token `trailhead_demo_acme_2026` is public** (it is in this repo).
  The demo team is protected from `DELETE /team/data` but not from writes.

Where prompts go: every scored prompt, any wiki context attached to it, and —
for the default rich `bootstrap` — the first 8,000 characters of up to 500
source files (5 levels deep) are sent to Google's Gemini API
using your `GEMINI_API_KEY`. When `LANGFUSE_*` keys are set, the same model
inputs and outputs are also sent to Langfuse. The browser extension's 👍/🤷/👎
chips store the prompt *and Claude's full reply* in the `captures` table.
`bootstrap` picks files by extension (so `.env` and key files are never read)
but does not read `.gitignore`, so a gitignored `.ts`/`.py`/… file inside the
walk depth is uploaded too.

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
