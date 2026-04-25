# api — Hono API (Railway)

The only backend service. Owns Postgres, exposes HTTP endpoints every other
artifact talks to. Single source of truth.

**Tech:** Hono + TypeScript on Railway. Postgres via Neon.

**Endpoints (spec §3):**
- `POST /score`        — 5-dim Haiku score; writes skill_observation inline
- `POST /capture`      — store conversation + outcome
- `GET  /context`      — HCL bundle (path-walked, spec §8)
- `GET  /examples`     — team-anchored prompts for a path
- `POST /diff`         — Prompt Diff synthesis (Sonnet)
- `POST /wiki/propose` — autonomous wiki update with normalize + dedup + counter

**Imports:** `packages/shared` (types), `packages/scoring` (Haiku/Sonnet
prompts), `packages/db` (schema).

**Spec refs:** §3, §4, §5, §10
