-- Team secrets. Idempotent; safe to re-run. The API also applies these
-- statements at startup (ensureRecentMigrations in apps/api/src/app.ts).
--
-- Apply:  psql "$DATABASE_URL" -f packages/db/migrations/2026-09-30-team-secrets.sql
--
-- Before: teams.token was both the team's id and its only credential, and
-- `init` derived it as sha256(git remote URL) — computable by anyone who knew
-- the URL. After: the credential is a random server-minted secret; only its
-- SHA-256 is stored here. teams.token stays the primary key (every child
-- table references it) and becomes a non-secret team id.
--
-- Existing rows get secret_hash NULL and keep working as "legacy" teams while
-- TRAILHEAD_ACCEPT_LEGACY_TOKENS is on (the default). A team leaves legacy
-- mode when it gets a secret: `init --upgrade-legacy`, or
-- POST /teams/rotate-secret with the old token.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS secret_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS teams_secret_hash_key ON teams(secret_hash);

-- The demo team's secret is its (public) id.
UPDATE teams
   SET secret_hash = '6c8ef50b8ac11089af2feb7c77de7d069a75edb30e740d836417eb387e0e079b'
 WHERE token = 'trailhead_demo_acme_2026' AND secret_hash IS NULL;
