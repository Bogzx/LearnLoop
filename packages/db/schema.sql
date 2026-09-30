-- Trailhead schema — spec §4 (docs/superpowers/specs/2026-04-25-trailhead-design.md)
-- Eight tables: teams, nodes, learnings, prompts, captures, skill_observations,
-- wiki_jobs, wiki_job_paths. (The header said "six" from the original spec and
-- was never updated when the rich-bootstrap job tables landed.)
-- No events table (the Claude Code Stop hook replaces NOTIFY/LISTEN).
--
-- Apply against your Neon database:
--   psql "$DATABASE_URL" -f packages/db/schema.sql
-- Idempotent: every CREATE uses IF NOT EXISTS so re-running is safe.
--
-- Multi-tenant key: teams.token is the primary key (a stable string the
-- client sends as X-Team-Token, e.g. 'repo_9d01...'). Child tables use
-- team_token TEXT FK. The legacy UUID teams.id was retired in the
-- 2026-04-26 token-as-team-key refactor — see
-- packages/db/migrations/2026-04-26-token-as-team-key.sql for the data move.

-- pgcrypto provides gen_random_uuid() on Postgres < 13. Neon ships 16+ which
-- has it built-in, but the extension is still required to expose the function.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tenancy. `token` is the primary key and the TEAM ID (the column kept its
-- historical name). Since 2026-09-30 it is not a secret: the credential is a
-- server-minted secret whose SHA-256 lives in secret_hash, and clients send
-- the secret as X-Team-Token. Rows with secret_hash NULL are legacy teams,
-- whose id doubled as the credential; the API accepts those only while
-- TRAILHEAD_ACCEPT_LEGACY_TOKENS is on. See apps/api/src/team-auth.ts.
CREATE TABLE IF NOT EXISTS teams (
  token       TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  secret_hash TEXT
);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS secret_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS teams_secret_hash_key ON teams(secret_hash);

-- Wiki tree (one row per folder OR file path).
-- Folder paths end in '/'; file paths do not. Both shapes coexist after the
-- 2026-04-26 rich-bootstrap rollout (spec: docs/superpowers/specs/2026-04-26-
-- wiki-bootstrap-rich-design.md).
CREATE TABLE IF NOT EXISTS nodes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_token  TEXT NOT NULL REFERENCES teams(token),
  path        TEXT NOT NULL,                    -- e.g., 'src/api/auth/' OR 'src/api/auth/issue.ts'
  body_md     TEXT NOT NULL DEFAULT '',         -- the node.md content
  body_source TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'bootstrap'; protects user edits from --force re-runs
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_token, path)
);
-- NOTE: no separate (team_token, path) index here. The UNIQUE constraint above
-- already creates one with identical leading columns, so a second was pure
-- write amplification and wasted space. Dropped — see
-- migrations/2026-08-17-hot-path-indexes.sql.
DROP INDEX IF EXISTS idx_nodes_team_token_path;

-- Accumulated learnings (the "AI-managed" content)
CREATE TABLE IF NOT EXISTS learnings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id             UUID NOT NULL REFERENCES nodes(id),
  body                TEXT NOT NULL,           -- the prose insight
  body_normalized     TEXT NOT NULL,           -- lowercase, stripped — for dedup
  status              TEXT NOT NULL DEFAULT 'draft', -- draft | durable
  reinforcement_count INT  NOT NULL DEFAULT 1,
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_learnings_node_status     ON learnings(node_id, status);
CREATE INDEX IF NOT EXISTS idx_learnings_node_normalized ON learnings(node_id, body_normalized);

-- Graduated prompt templates (the curriculum)
CREATE TABLE IF NOT EXISTS prompts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id                  UUID NOT NULL REFERENCES nodes(id),
  template                 TEXT NOT NULL,                   -- the prompt itself
  topic                    TEXT,                            -- e.g., 'retry', 'auth', 'webhook'
  reuse_count              INT  NOT NULL DEFAULT 0,
  status                   TEXT NOT NULL DEFAULT 'graduated',
  author_user_id           TEXT,                            -- who promoted this prompt; nullable for legacy rows
  graduated_overall_score  INT  NOT NULL DEFAULT 7,         -- overall 0-10 at graduation; ≥7 by gate, default backfills legacy rows
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prompts_node_topic ON prompts(node_id, topic);
-- Idempotent add for installs that ran the table CREATE before this column existed.
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS graduated_overall_score INT NOT NULL DEFAULT 7;

-- Captured sessions
CREATE TABLE IF NOT EXISTS captures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_token        TEXT NOT NULL REFERENCES teams(token),
  surface           TEXT NOT NULL,             -- 'browser' | 'vscode' | 'mcp'
  user_prompt       TEXT NOT NULL,
  ai_response       TEXT,
  file_path         TEXT,
  outcome           TEXT,                      -- 'helpful' | 'mixed' | 'not'
  scored_dimensions JSONB,                     -- {goal_clarity: 8, ...}
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- GET /team/metrics runs
--   SELECT ... FROM captures WHERE team_token = $1 AND created_at > $2
-- and the dashboard polls it every 30s per open viewer. Without this the
-- table had no index beyond the PK, so every poll was a full sequential scan.
CREATE INDEX IF NOT EXISTS idx_captures_team_created ON captures(team_token, created_at DESC);

-- Skill arc data — driven by real /score writes (every browser/VS Code prompt).
-- prompt_hash backs the per-(user, dim, prompt-hash) 30s dedup window from
-- spec §19 risk register: "Cap to one observation per (user, dimension,
-- prompt-hash) within a 30s window."
CREATE TABLE IF NOT EXISTS skill_observations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_token  TEXT NOT NULL REFERENCES teams(token),
  user_id     TEXT NOT NULL,                     -- placeholder; no real users for demo
  dimension   TEXT NOT NULL,                     -- one of the 5 dimensions
  score       INT  NOT NULL,
  prompt_hash TEXT,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skill_obs_team_token_dim_ts ON skill_observations(team_token, dimension, ts);

-- The 30s dedup NOT EXISTS probe in writeSkillObservations (apps/api/src/index.ts)
-- filters on (team_token, user_id, dimension, prompt_hash, ts). The index above
-- leads with (team_token, dimension) and carries neither user_id nor
-- prompt_hash, so it could not serve that probe — and the probe runs five times
-- (once per dimension) on every single /score. This index matches it column for
-- column.
CREATE INDEX IF NOT EXISTS idx_skill_obs_dedup
  ON skill_observations(team_token, user_id, dimension, prompt_hash, ts DESC);

-- GET /skill-arc (WHERE team_token AND ts > $, ORDER BY ts) and the
-- COUNT(DISTINCT user_id) in GET /team/metrics. Neither filters on dimension,
-- so neither could use idx_skill_obs_team_token_dim_ts.
CREATE INDEX IF NOT EXISTS idx_skill_obs_team_ts ON skill_observations(team_token, ts);

-- Cheap-insurance index for the GET /wiki/recent polling query.
CREATE INDEX IF NOT EXISTS idx_learnings_last_seen_at ON learnings(last_seen_at DESC);

-- Rich-bootstrap async job header. One row per `trailhead-mcp bootstrap --rich`
-- invocation (or wiki_bootstrap mode='rich' tool call). The worker fans out
-- per-path Gemini calls and updates these counters.
CREATE TABLE IF NOT EXISTS wiki_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_token    TEXT NOT NULL REFERENCES teams(token),
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  paths_total   INT NOT NULL,
  paths_done    INT NOT NULL DEFAULT 0,
  paths_failed  INT NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wiki_jobs_team_token_created ON wiki_jobs(team_token, created_at DESC);

-- Per-path progress for a wiki_jobs row. `kind` lets the worker pick the
-- right LLM prompt template. ON DELETE CASCADE so an admin clearing old jobs
-- (future cron) doesn't leave orphans.
CREATE TABLE IF NOT EXISTS wiki_job_paths (
  job_id  UUID NOT NULL REFERENCES wiki_jobs(id) ON DELETE CASCADE,
  path    TEXT NOT NULL,
  kind    TEXT NOT NULL,                     -- 'folder' | 'file' | 'root'
  status  TEXT NOT NULL DEFAULT 'pending',   -- pending | running | done | failed
  error   TEXT,
  PRIMARY KEY (job_id, path)
);

-- Bootstrap the demo team. Idempotent on (token). Token mirrors the value the
-- legacy single-tenant build expected, so existing installs continue to work.
--
-- The demo team's secret is public on purpose: it is its own id, so
-- secret_hash = sha256('trailhead_demo_acme_2026') and the demo keeps working
-- with legacy tokens turned off. Keep in sync with DEMO_TEAM_SECRET_HASH in
-- apps/api/src/db.ts.
INSERT INTO teams (token, name, secret_hash)
VALUES ('trailhead_demo_acme_2026', 'Acme Fintech',
        '6c8ef50b8ac11089af2feb7c77de7d069a75edb30e740d836417eb387e0e079b')
ON CONFLICT (token) DO NOTHING;
UPDATE teams
   SET secret_hash = '6c8ef50b8ac11089af2feb7c77de7d069a75edb30e740d836417eb387e0e079b'
 WHERE token = 'trailhead_demo_acme_2026' AND secret_hash IS NULL;
