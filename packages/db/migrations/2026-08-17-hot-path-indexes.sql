-- Hot-path indexes. Idempotent; safe to re-run.
--
-- Apply:  psql "$DATABASE_URL" -f packages/db/migrations/2026-08-17-hot-path-indexes.sql
--
-- Three problems this fixes, all found by reading the actual query predicates
-- in apps/api/src/index.ts against the indexes that existed:
--
-- 1. `captures` had no index beyond its primary key, yet GET /team/metrics
--    filters it on (team_token, created_at) and the dashboard polls that
--    endpoint every 30 seconds for every open viewer. Every poll was a full
--    sequential scan of the table.
--
-- 2. The /score dedup probe filters skill_observations on
--    (team_token, user_id, dimension, prompt_hash, ts). The only index led
--    with (team_token, dimension) and carried neither user_id nor
--    prompt_hash, so it could not be used — and that probe runs once per
--    dimension, five times per /score call.
--
-- 3. `idx_nodes_team_token_path` duplicated the UNIQUE (team_token, path)
--    constraint on the same table, which already maintains an index with the
--    same leading columns. Two indexes, one useful.
--
-- Note on production: these are plain CREATE INDEX statements, which take an
-- ACCESS EXCLUSIVE-blocking-writes lock for the duration of the build. At the
-- current data volume that is milliseconds. On a large table, run these with
-- CREATE INDEX CONCURRENTLY instead (which cannot run inside a transaction
-- block, so it must be executed statement-by-statement).

CREATE INDEX IF NOT EXISTS idx_captures_team_created
  ON captures(team_token, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_skill_obs_dedup
  ON skill_observations(team_token, user_id, dimension, prompt_hash, ts DESC);

CREATE INDEX IF NOT EXISTS idx_skill_obs_team_ts
  ON skill_observations(team_token, ts);

DROP INDEX IF EXISTS idx_nodes_team_token_path;
