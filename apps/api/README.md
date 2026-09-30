# api — Hono API (self-hosted)

The only backend service. Owns Postgres, exposes HTTP endpoints every other
artifact talks to. Single source of truth.

**Tech:** Hono + TypeScript, run via `docker compose up` from the repo root
(see `SELFHOSTING.md`). Any Postgres (bundled container, Neon, RDS).

**Endpoints (spec §3 — partial; the full, current table is in the root README):**
- `POST /score`        — 5-dim Gemini score; writes skill_observation inline
- `POST /capture`      — store conversation + outcome
- `GET  /context`      — HCL bundle (path-walked, spec §8)
- `GET  /examples`     — team-anchored prompts for a path
- `POST /diff`         — Prompt Diff synthesis (Gemini)
- `POST /wiki/propose` — autonomous wiki update with normalize + dedup + counter

**Imports:** `packages/shared` (types), `packages/scoring` (Gemini
prompts), `packages/db` (schema).

**Spec refs:** §3, §4, §5, §10

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
