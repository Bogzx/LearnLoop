// Postgres pool + small helpers. Single connection pool for the whole
// process. Uses the pooled DATABASE_URL from .env (Neon — sslmode=require).

import './env.ts';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set');
}

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Convenience wrapper that returns rows directly. Most queries here are
// single-result; the caller picks rows[0] or maps over rows[].
export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await pool.query<T>(text, params as never);
  return res.rows;
}

// The seeded demo team's token. Kept for the seed scripts and as a fallback
// target when env override puts the legacy single-tenant path in play. New
// code resolves the team per-request via ensureTeam().
export const DEMO_TEAM_TOKEN = 'trailhead_demo_acme_2026';

// Ensure a team row exists for the given token and return the token.
//
// Returns null when the token is unknown and autoCreate is false. When
// autoCreate is true, an unknown token spawns a new teams row; concurrent
// callers race-safely via ON CONFLICT DO NOTHING.
//
// Auto-create makes the API behave like "any X-Team-Token spawns its own
// team," which is the right policy for the hackathon's open-demo posture.
// Production deploys should set TRAILHEAD_AUTO_CREATE_TEAMS=false and
// register teams explicitly.
export async function ensureTeam(
  token: string,
  { autoCreate }: { autoCreate: boolean },
): Promise<string | null> {
  if (!token) return null;
  const existing = await q<{ token: string }>(
    'SELECT token FROM teams WHERE token = $1 LIMIT 1',
    [token],
  );
  if (existing.length) return existing[0]!.token;
  if (!autoCreate) return null;
  await q(
    `INSERT INTO teams (token, name) VALUES ($1, $2)
       ON CONFLICT (token) DO NOTHING`,
    [token, `team:${token.slice(0, 16)}`],
  );
  return token;
}

// Update teams.name to `name` only when the current name looks like the
// auto-create placeholder ('team:<token-prefix>') OR is empty. Bootstrap
// callers pass the human-readable repo name (e.g. 'Polihackwinners') so
// the dashboard / popup show the actual repo, not the hashed token. We
// preserve explicit renames (anything that isn't the placeholder) so a
// re-bootstrap doesn't clobber an operator's chosen label.
export async function applyTeamNameIfPlaceholder(
  teamToken: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await q(
    `UPDATE teams
        SET name = $2
      WHERE token = $1
        AND (name = '' OR name LIKE 'team:%')`,
    [teamToken, trimmed],
  );
}

// Get-or-create a node row for a path. Path is normalized to trailing
// slash by the caller (packages/scoring → normalizePath).
export async function upsertNode(teamToken: string, path: string): Promise<string> {
  const rows = await q<{ id: string }>(
    `INSERT INTO nodes (team_token, path) VALUES ($1, $2)
     ON CONFLICT (team_token, path) DO UPDATE SET path = EXCLUDED.path
     RETURNING id`,
    [teamToken, path],
  );
  return rows[0]!.id;
}

// Delete every row associated with a team. Wrapped in a transaction so a
// partial wipe doesn't leave orphan rows. The team itself is preserved so
// re-running tests with the same token continues to land in the same row.
export async function wipeTeamData(teamToken: string): Promise<{
  nodes: number;
  learnings: number;
  prompts: number;
  captures: number;
  observations: number;
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const learnings = await client.query(
      `DELETE FROM learnings
        WHERE node_id IN (SELECT id FROM nodes WHERE team_token = $1)`,
      [teamToken],
    );
    const prompts = await client.query(
      `DELETE FROM prompts
        WHERE node_id IN (SELECT id FROM nodes WHERE team_token = $1)`,
      [teamToken],
    );
    const captures = await client.query(
      'DELETE FROM captures WHERE team_token = $1',
      [teamToken],
    );
    const observations = await client.query(
      'DELETE FROM skill_observations WHERE team_token = $1',
      [teamToken],
    );
    const nodes = await client.query(
      'DELETE FROM nodes WHERE team_token = $1',
      [teamToken],
    );
    await client.query('COMMIT');
    return {
      nodes: nodes.rowCount ?? 0,
      learnings: learnings.rowCount ?? 0,
      prompts: prompts.rowCount ?? 0,
      captures: captures.rowCount ?? 0,
      observations: observations.rowCount ?? 0,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
