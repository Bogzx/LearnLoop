# api — Hono API (self-hosted)

The only backend service. Owns Postgres, exposes HTTP endpoints every other
artifact talks to. Single source of truth.

**Tech:** Hono + TypeScript, run via `docker compose up` from the repo root
(see `SELFHOSTING.md`). Any Postgres (bundled container, Neon, RDS).

**Layout** (`src/`):

| File | Role |
|---|---|
| `index.ts` | Entry point: env checks, startup migrations, listener, graceful shutdown |
| `app.ts` | The Hono app: CORS, body caps, tracing, auth and rate-limit middleware, `GET /`, route mounting, error handler |
| `http.ts` | Shared request plumbing: env type, tenant policy, rate limiting, prompt cap, skill-observation writes |
| `routes/score.ts` | `POST /score`, `POST /capture` |
| `routes/coach.ts` | `POST /coach` (teach → reveal loop) |
| `routes/assist.ts` | `POST /diff`, `POST /improve` |
| `routes/wiki.ts` | `/wiki/propose`, `/context`, `/examples`, `/search`, `/wiki/recent`, `/wiki/tree`, `/wiki/export` |
| `routes/prompts.ts` | `/prompts/proven`, `/prompts/pending`, `/prompts/:id/review` |
| `routes/metrics.ts` | `/skill-arc`, `/team/metrics` |
| `routes/teams.ts` | `/teams` (register, probe, rotate), `DELETE /team/data` |
| `routes/onboard.ts` | `/onboard/repo`, `/onboard/repo/full`, `/onboard/jobs/:id` |
| `gemini.ts` | The one Gemini client: retries, timeouts, Langfuse tracing, every LLM call |
| `wiki-bootstrap-job.ts` | The async three-pass rich bootstrap behind `/onboard/repo/full` |
| `db.ts` | `pg` pool, team resolution and registration |

## Routes

Every route except `GET /` and `POST /teams` needs `X-Team-Token` (the team
secret). `GET /` lists them all, and the integration suite fails if one listed
there has no test.

| Method + Path | What it does |
|---|---|
| `GET  /` | Health + endpoint catalog (unauth) |
| `POST /teams` | Register a team (unauth; gated by `TRAILHEAD_ADMIN_TOKEN` when set). Returns `{ team_id, name, secret }` once; `409` if the id is taken — the join flow |
| `POST /teams/rotate-secret` | New secret for the caller's team; the old credential stops working. Upgrades a legacy team |
| `GET  /teams` | Resolves the caller's own team. Never returns the secret — `{ name, id, legacy, team_id? }` (`id` is an opaque digest; `team_id` only for non-legacy teams) |
| `POST /score` | 5-dimension Gemini score; writes `skill_observation` rows with a 30 s per-dimension dedup window |
| `POST /coach` | Stateless teach→reveal coaching loop, capped at 5 rounds |
| `POST /capture` | Stores a `(prompt, response, outcome)` capture from any surface |
| `POST /wiki/propose` | Normalize + dedup an insight on `(node_id, body_normalized)`, increment `reinforcement_count`, promote `draft → durable` at ≥ 3 |
| `GET  /context?path=` | Ancestor walk: returns every wiki node whose path is a prefix of the file path, plus its durable learnings |
| `GET  /examples?path=` | Top graduated prompts for an ancestor of a file path |
| `GET  /prompts/proven` | The team's graduated prompts, filterable by score, path, topic |
| `GET  /prompts/pending` | Library candidates awaiting review (`TRAILHEAD_PROMOTION_MODE=review`) |
| `POST /prompts/:id/review` | `{ approve: true }` graduates a pending prompt, `false` discards it |
| `GET  /search?q=&scope=` | Substring search over rules, durable learnings and graduated prompts |
| `GET  /wiki/recent?since=ISO` | Polling endpoint for the VS Code wiki-toast surface |
| `POST /diff` | Picks the closest graduated team prompt by topic + ancestry, scores both prompts, asks Gemini to narrate the difference |
| `POST /improve` | Multi-turn Gemini-driven prompt rewrite, capped at 5 user replies |
| `GET  /skill-arc` | Time-series of per-dimension scores (powers the dashboard hero chart) |
| `GET  /team/metrics` | Snapshot: avg overall, reuse rate, durable count, draft count, active users |
| `GET  /wiki/tree` | Full node + learnings tree |
| `GET  /wiki/export` | The whole team wiki as one markdown document (`?drafts=true`, `?format=json`) |
| `POST /onboard/repo` | Bulk-upsert one node per path, idempotent, optional `initial_rules[path]` for seeding `body_md` |
| `POST /onboard/repo/full` | Async rich bootstrap: accepts a folder + file bundle (capped at 16 MB / 2 000 files / 32 KB per file), enqueues a `wiki_jobs` row, three-pass Gemini fan-out via `setImmediate` |
| `GET  /onboard/jobs/:id` | Per-path progress for a rich-bootstrap job |
| `DELETE /team/data` | Wipes the requesting team's data; demo team is protected unless `TRAILHEAD_ALLOW_DEMO_RESET=true` |

**Imports:** `packages/shared` (types), `packages/scoring` (prompts and pure
helpers), `packages/db` (schema).

## Tests

```bash
npm --workspace=apps/api test                 # unit tests, no database
```

Integration tests drive every route through `app.request()` against a real
Postgres, with two tenants, and assert that nothing crosses between them, plus
the `/score` persistence rules and the auth model (secrets, rotation, legacy
tokens). Gemini is stubbed in-process — no key, no network. The suite **wipes**
its database, so the name must end in `_it` or `_test`:

```bash
docker run -d --rm --name trailhead-it -p 55432:5432 \
  -e POSTGRES_USER=trailhead -e POSTGRES_PASSWORD=trailhead -e POSTGRES_DB=trailhead_it \
  postgres:16-alpine
TRAILHEAD_IT_DATABASE_URL=postgresql://trailhead:trailhead@127.0.0.1:55432/trailhead_it \
  npm --workspace=apps/api run test:integration
docker stop trailhead-it
```

Without `TRAILHEAD_IT_DATABASE_URL` the suite is skipped. CI runs it on every
PR against a Postgres service container. Its last test fails if an endpoint
listed in `GET /` has no integration coverage — add a test when you add a
route.
