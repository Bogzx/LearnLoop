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

// The seeded demo team. Kept for the seed scripts and as a fallback target
// when env override puts the legacy single-tenant path in play. New code
// resolves team_id per-request via teamIdForToken().
export const DEMO_TEAM_ID = '11111111-1111-1111-1111-111111111111';
export const DEMO_TEAM_TOKEN = 'trailhead_demo_acme_2026';

// In-memory cache for token→team_id. Populated lazily on first request and
// kept for the lifetime of the process. Tokens are immutable once issued and
// the cardinality of distinct teams is small (hackathon scale), so a Map
// without eviction is fine.
const tokenCache = new Map<string, string>();

// Resolve a team token to its team_id. Returns null when the token is
// unknown and autoCreate is false. When autoCreate is true, an unknown
// token spawns a new teams row and the new id is cached + returned.
//
// Auto-create makes the API behave like "any X-Team-Token spawns its own
// team," which is the right policy for the hackathon's open-demo posture.
// Production deploys should set TRAILHEAD_AUTO_CREATE_TEAMS=false and
// register teams explicitly.
export async function teamIdForToken(
  token: string,
  { autoCreate }: { autoCreate: boolean },
): Promise<string | null> {
  if (!token) return null;
  const cached = tokenCache.get(token);
  if (cached) return cached;

  const rows = await q<{ id: string }>(
    'SELECT id FROM teams WHERE token = $1 LIMIT 1',
    [token],
  );
  if (rows.length) {
    tokenCache.set(token, rows[0]!.id);
    return rows[0]!.id;
  }

  if (!autoCreate) return null;

  // Auto-create. Name defaults to a derived label; the operator can rename
  // later via SQL if they want a friendlier display in the dashboard.
  const created = await q<{ id: string }>(
    `INSERT INTO teams (name, token) VALUES ($1, $2)
       ON CONFLICT (token) DO UPDATE SET token = EXCLUDED.token
     RETURNING id`,
    [`team:${token.slice(0, 16)}`, token],
  );
  const id = created[0]!.id;
  tokenCache.set(token, id);
  return id;
}

// Get-or-create a node row for a path. Path is normalized to trailing
// slash by the caller (packages/scoring → normalizePath).
export async function upsertNode(teamId: string, path: string): Promise<string> {
  const rows = await q<{ id: string }>(
    `INSERT INTO nodes (team_id, path) VALUES ($1, $2)
     ON CONFLICT (team_id, path) DO UPDATE SET path = EXCLUDED.path
     RETURNING id`,
    [teamId, path],
  );
  return rows[0]!.id;
}

// Delete every row associated with a team. Wrapped in a transaction so a
// partial wipe doesn't leave orphan rows. The team itself is preserved so
// re-running tests with the same token continues to land in the same id.
export async function wipeTeamData(teamId: string): Promise<{
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
        WHERE node_id IN (SELECT id FROM nodes WHERE team_id = $1)`,
      [teamId],
    );
    const prompts = await client.query(
      `DELETE FROM prompts
        WHERE node_id IN (SELECT id FROM nodes WHERE team_id = $1)`,
      [teamId],
    );
    const captures = await client.query(
      'DELETE FROM captures WHERE team_id = $1',
      [teamId],
    );
    const observations = await client.query(
      'DELETE FROM skill_observations WHERE team_id = $1',
      [teamId],
    );
    const nodes = await client.query(
      'DELETE FROM nodes WHERE team_id = $1',
      [teamId],
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
