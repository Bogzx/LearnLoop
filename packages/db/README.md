# db — Postgres schema, migrations, seed data

Schema lives here as runnable SQL. Seed scripts populate the Acme Fintech
demo data. `apps/api` runs the schema on startup; admin scripts run the
seeds.

**Contents:**
- `schema.sql`         — 6-table schema (spec §4): `teams`, `nodes`,
  `learnings`, `prompts`, `captures`, `skill_observations`
- `seed/nodes.sql`     — 5 demo nodes for Acme Fintech
  (`src/api/`, `src/api/auth/`, `src/api/webhooks/`, `src/db/`,
  `src/utils/`) with `body_md` rules and conventions
- `seed/learnings.sql` — 15 learnings, mix of draft + durable
  (reinforcement_count >= 3)
- `seed/prompts.sql`   — 8 graduated prompts on common topics (retry,
  auth, webhook, db migration, error handling)
- `seed/captures.sql`  — 30 captures with outcomes
- `seed/skill-obs.sql` — ~50 skill_observations to make the arc chart
  look real before the demo even runs

**Why this is critical (§11):** "the most important pre-demo task."
Without realistic seed data, the curriculum is empty and nothing surfaces.
Allocate 3 dedicated hours.

**Spec refs:** §4 (schema), §11 (seeding plan)
