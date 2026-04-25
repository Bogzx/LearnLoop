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
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL
);

-- Wiki tree (one row per folder/path)
CREATE TABLE IF NOT EXISTS nodes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES teams(id),
  path       TEXT NOT NULL,                    -- e.g., 'src/api/auth/'
  body_md    TEXT NOT NULL DEFAULT '',         -- the node.md content
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, path)
);
CREATE INDEX IF NOT EXISTS idx_nodes_team_path ON nodes(team_id, path);

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
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id     UUID NOT NULL REFERENCES nodes(id),
  template    TEXT NOT NULL,                   -- the prompt itself
  topic       TEXT,                            -- e.g., 'retry', 'auth', 'webhook'
  reuse_count INT  NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'graduated',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prompts_node_topic ON prompts(node_id, topic);

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

-- Skill arc data — driven by real /score writes (every browser/VS Code prompt)
CREATE TABLE IF NOT EXISTS skill_observations (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id   UUID NOT NULL REFERENCES teams(id),
  user_id   TEXT NOT NULL,                     -- placeholder; no real users for demo
  dimension TEXT NOT NULL,                     -- one of the 5 dimensions
  score     INT  NOT NULL,
  ts        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skill_obs_team_dim_ts ON skill_observations(team_id, dimension, ts);
