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

// All endpoints scope to a single team for the demo (spec §3 — hardcoded
// token). Resolve once on boot and cache. Bootstrapped by schema.sql.
export const DEMO_TEAM_ID = '11111111-1111-1111-1111-111111111111';

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
