-- One-time migration: switch teams from UUID `id` PK to TEXT `token` PK,
-- and rename child FKs from `team_id UUID` to `team_token TEXT`.
--
-- Why: the API used a process-local Map<token,uuid> cache to translate
-- tokens to UUIDs on every request. The cache existed only because the
-- token wasn't the PK. Making the token the PK eliminates the indirection
-- and the cache.
--
-- Apply against $DATABASE_URL once:
--   psql "$DATABASE_URL" -f packages/db/migrations/2026-04-26-token-as-team-key.sql
--
-- Idempotent inside a single transaction. Safe to re-run after a successful
-- apply (every step uses IF EXISTS / IF NOT EXISTS guards).
--
-- ASSUMES every existing FK row has a non-null teams.token to backfill from.
-- That has been true since the multi-tenant cutover. If you have legacy
-- pre-multi-tenant rows whose teams.token is NULL, fix those first.

BEGIN;

-- 1. Add team_token columns alongside team_id
ALTER TABLE nodes              ADD COLUMN IF NOT EXISTS team_token TEXT;
ALTER TABLE captures           ADD COLUMN IF NOT EXISTS team_token TEXT;
ALTER TABLE skill_observations ADD COLUMN IF NOT EXISTS team_token TEXT;
ALTER TABLE wiki_jobs          ADD COLUMN IF NOT EXISTS team_token TEXT;

-- 2. Backfill from teams join
UPDATE nodes n              SET team_token = t.token FROM teams t WHERE t.id = n.team_id              AND n.team_token IS NULL;
UPDATE captures c           SET team_token = t.token FROM teams t WHERE t.id = c.team_id           AND c.team_token IS NULL;
UPDATE skill_observations s SET team_token = t.token FROM teams t WHERE t.id = s.team_id AND s.team_token IS NULL;
UPDATE wiki_jobs w          SET team_token = t.token FROM teams t WHERE t.id = w.team_id          AND w.team_token IS NULL;

-- 3. Drop old FKs + team_id columns
ALTER TABLE nodes              DROP CONSTRAINT IF EXISTS nodes_team_id_fkey,              DROP COLUMN IF EXISTS team_id;
ALTER TABLE captures           DROP CONSTRAINT IF EXISTS captures_team_id_fkey,           DROP COLUMN IF EXISTS team_id;
ALTER TABLE skill_observations DROP CONSTRAINT IF EXISTS skill_observations_team_id_fkey, DROP COLUMN IF EXISTS team_id;
ALTER TABLE wiki_jobs          DROP CONSTRAINT IF EXISTS wiki_jobs_team_id_fkey,          DROP COLUMN IF EXISTS team_id;

-- 4. NOT NULL on team_token for child tables
ALTER TABLE nodes              ALTER COLUMN team_token SET NOT NULL;
ALTER TABLE captures           ALTER COLUMN team_token SET NOT NULL;
ALTER TABLE skill_observations ALTER COLUMN team_token SET NOT NULL;
ALTER TABLE wiki_jobs          ALTER COLUMN team_token SET NOT NULL;

-- 5. Swap teams PK: drop UUID id, promote token
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_pkey;
ALTER TABLE teams DROP COLUMN IF EXISTS id;
ALTER TABLE teams ALTER COLUMN token SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'teams_pkey'
       AND conrelid = 'teams'::regclass
  ) THEN
    ALTER TABLE teams ADD PRIMARY KEY (token);
  END IF;
END $$;
-- The legacy UNIQUE(token) constraint becomes redundant once token is PK.
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_token_key;

-- 6. Re-add FKs on team_token
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nodes_team_token_fkey') THEN
    ALTER TABLE nodes ADD CONSTRAINT nodes_team_token_fkey FOREIGN KEY (team_token) REFERENCES teams(token);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'captures_team_token_fkey') THEN
    ALTER TABLE captures ADD CONSTRAINT captures_team_token_fkey FOREIGN KEY (team_token) REFERENCES teams(token);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skill_observations_team_token_fkey') THEN
    ALTER TABLE skill_observations ADD CONSTRAINT skill_observations_team_token_fkey FOREIGN KEY (team_token) REFERENCES teams(token);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wiki_jobs_team_token_fkey') THEN
    ALTER TABLE wiki_jobs ADD CONSTRAINT wiki_jobs_team_token_fkey FOREIGN KEY (team_token) REFERENCES teams(token);
  END IF;
END $$;

-- 7. Re-create the (team, ...) child indexes on the new column
DROP INDEX IF EXISTS idx_nodes_team_path;
DROP INDEX IF EXISTS idx_skill_obs_team_dim_ts;
DROP INDEX IF EXISTS idx_wiki_jobs_team_created;
CREATE INDEX IF NOT EXISTS idx_nodes_team_token_path        ON nodes(team_token, path);
CREATE INDEX IF NOT EXISTS idx_skill_obs_team_token_dim_ts  ON skill_observations(team_token, dimension, ts);
CREATE INDEX IF NOT EXISTS idx_wiki_jobs_team_token_created ON wiki_jobs(team_token, created_at DESC);

-- 8. Re-create the nodes UNIQUE on the new column. The old constraint name
-- was nodes_team_id_path_key (auto-generated from columns). Drop it if it
-- survived the column drop, then add the new one.
ALTER TABLE nodes DROP CONSTRAINT IF EXISTS nodes_team_id_path_key;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'nodes_team_token_path_key' AND conrelid = 'nodes'::regclass
  ) THEN
    ALTER TABLE nodes ADD CONSTRAINT nodes_team_token_path_key UNIQUE (team_token, path);
  END IF;
END $$;

COMMIT;
