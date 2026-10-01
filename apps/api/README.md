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

The full route table is in the root README.

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
