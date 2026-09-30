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
