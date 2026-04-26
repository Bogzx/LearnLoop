-- Trailhead schema — spec §4 (docs/superpowers/specs/2026-04-25-trailhead-design.md)
-- Six tables. No events table (the Claude Code Stop hook replaces NOTIFY/LISTEN).
--
-- Apply against your Neon database:
--   psql "$DATABASE_URL" -f packages/db/schema.sql
-- Idempotent: every CREATE uses IF NOT EXISTS so re-running is safe.

-- pgcrypto provides gen_random_uuid() on Postgres < 13. Neon ships 16+ which
-- has it built-in, but the extension is still required to expose the function.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tenancy
CREATE TABLE IF NOT EXISTS teams (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL,
  token TEXT UNIQUE                              -- X-Team-Token value; nullable on legacy rows
);
-- Backfill the column on databases that were created before multi-tenant.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS token TEXT;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teams_token_key'
  ) THEN
    ALTER TABLE teams ADD CONSTRAINT teams_token_key UNIQUE (token);
  END IF;
END $$;

-- Wiki tree (one row per folder OR file path).
-- Folder paths end in '/'; file paths do not. Both shapes coexist after the
-- 2026-04-26 rich-bootstrap rollout (spec: docs/superpowers/specs/2026-04-26-
-- wiki-bootstrap-rich-design.md).
CREATE TABLE IF NOT EXISTS nodes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id),
  path        TEXT NOT NULL,                    -- e.g., 'src/api/auth/' OR 'src/api/auth/issue.ts'
  body_md     TEXT NOT NULL DEFAULT '',         -- the node.md content
  body_source TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'bootstrap'; protects user edits from --force re-runs
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, path)
);
CREATE INDEX IF NOT EXISTS idx_nodes_team_path ON nodes(team_id, path);
-- Backfill the column on databases that pre-date rich bootstrap.
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS body_source TEXT NOT NULL DEFAULT 'manual';

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
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id         UUID NOT NULL REFERENCES nodes(id),
  template        TEXT NOT NULL,                   -- the prompt itself
  topic           TEXT,                            -- e.g., 'retry', 'auth', 'webhook'
  reuse_count     INT  NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'graduated',
  author_user_id  TEXT,                            -- who promoted this prompt; nullable for legacy rows
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prompts_node_topic ON prompts(node_id, topic);
-- Backfill column on databases that pre-date the self-author filter.
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS author_user_id TEXT;

-- Captured sessions
CREATE TABLE IF NOT EXISTS captures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           UUID NOT NULL REFERENCES teams(id),
  surface           TEXT NOT NULL,             -- 'browser' | 'vscode' | 'mcp'
  user_prompt       TEXT NOT NULL,
  ai_response       TEXT,
  file_path         TEXT,
  outcome           TEXT,                      -- 'helpful' | 'mixed' | 'not'
  scored_dimensions JSONB,                     -- {goal_clarity: 8, ...}
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Skill arc data — driven by real /score writes (every browser/VS Code prompt).
-- prompt_hash backs the per-(user, dim, prompt-hash) 30s dedup window from
-- spec §19 risk register: "Cap to one observation per (user, dimension,
-- prompt-hash) within a 30s window."
CREATE TABLE IF NOT EXISTS skill_observations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id),
  user_id     TEXT NOT NULL,                     -- placeholder; no real users for demo
  dimension   TEXT NOT NULL,                     -- one of the 5 dimensions
  score       INT  NOT NULL,
  prompt_hash TEXT,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE skill_observations ADD COLUMN IF NOT EXISTS prompt_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_skill_obs_team_dim_ts ON skill_observations(team_id, dimension, ts);

-- Cheap-insurance index for the GET /wiki/recent polling query.
CREATE INDEX IF NOT EXISTS idx_learnings_last_seen_at ON learnings(last_seen_at DESC);

-- Rich-bootstrap async job header. One row per `trailhead-mcp bootstrap --rich`
-- invocation (or wiki_bootstrap mode='rich' tool call). The worker fans out
-- per-path Gemini calls and updates these counters.
CREATE TABLE IF NOT EXISTS wiki_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES teams(id),
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  paths_total   INT NOT NULL,
  paths_done    INT NOT NULL DEFAULT 0,
  paths_failed  INT NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wiki_jobs_team_created ON wiki_jobs(team_id, created_at DESC);

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

-- Bootstrap the demo team. Hardcoded UUID so every artifact can reference it
-- without first reading the row back. Idempotent on (id). Token mirrors the
-- value the legacy single-tenant build expected, so existing installs continue
-- to work after the multi-tenant cutover.
INSERT INTO teams (id, name, token)
VALUES ('11111111-1111-1111-1111-111111111111', 'Acme Fintech', 'trailhead_demo_acme_2026')
ON CONFLICT (id) DO UPDATE
  SET token = COALESCE(teams.token, EXCLUDED.token);
