// Postgres pool + small helpers. Single connection pool for the whole
// process. Uses the pooled DATABASE_URL from .env (Neon — sslmode=require).

import './env.ts';
import pg from 'pg';
import { hashSecret, mintSecret } from './team-auth.ts';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set');
}

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// An idle pooled client can be dropped by the server (Neon suspends idle
// computes; any Postgres restart does it). pg then emits 'error' on the pool,
// and with no listener Node treats it as unhandled and kills the process.
// The pool discards the broken client and opens a new one on the next query,
// so logging is all that's needed.
pool.on('error', (err) => {
  console.warn('[db] idle client error (discarded; the pool reconnects on next use):', err.message);
});

// Convenience wrapper that returns rows directly. Most queries here are
// single-result; the caller picks rows[0] or maps over rows[].
export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await pool.query<T>(text, params as never);
  return res.rows;
}

// The seeded demo team's id. It is also, deliberately, the demo team's public
// secret: schema.sql stores sha256('trailhead_demo_acme_2026') as its
// secret_hash, so the demo keeps working with TRAILHEAD_ACCEPT_LEGACY_TOKENS
// off. Anyone can read and write the demo team; that is what it is for.
export const DEMO_TEAM_TOKEN = 'trailhead_demo_acme_2026';
// sha256('trailhead_demo_acme_2026') — kept in sync with schema.sql.
export const DEMO_TEAM_SECRET_HASH =
  '6c8ef50b8ac11089af2feb7c77de7d069a75edb30e740d836417eb387e0e079b';

export interface ResolvedTeam {
  /** teams.token — the team id every child row is keyed on. Not a secret. */
  teamId: string;
  /** True when the caller authenticated with a legacy id-as-credential. */
  legacy: boolean;
}

// Resolve an X-Team-Token credential to a team. See team-auth.ts for the model.
//
//   1. Secret: sha256(credential) matches teams.secret_hash.
//   2. Legacy (acceptLegacy): credential equals teams.token of a team that has
//      NO secret yet. A team that has a secret is never reachable by its id —
//      that is what makes its id safe to publish.
//   3. Legacy auto-create (acceptLegacy && autoCreate): an unknown credential
//      spawns a legacy team keyed on it. RETURNING decides success, so a
//      credential that collides with an existing team's id (for instance a
//      secret team's public id) does NOT authenticate as that team.
export async function resolveTeam(
  credential: string,
  { acceptLegacy, autoCreate }: { acceptLegacy: boolean; autoCreate: boolean },
): Promise<ResolvedTeam | null> {
  if (!credential) return null;
  const bySecret = await q<{ token: string }>(
    'SELECT token FROM teams WHERE secret_hash = $1 LIMIT 1',
    [hashSecret(credential)],
  );
  if (bySecret.length) return { teamId: bySecret[0]!.token, legacy: false };
  if (!acceptLegacy) return null;

  const legacy = await q<{ token: string }>(
    'SELECT token FROM teams WHERE token = $1 AND secret_hash IS NULL LIMIT 1',
    [credential],
  );
  if (legacy.length) return { teamId: legacy[0]!.token, legacy: true };
  if (!autoCreate) return null;

  const created = await q<{ token: string }>(
    `INSERT INTO teams (token, name) VALUES ($1, $2)
       ON CONFLICT (token) DO NOTHING
     RETURNING token`,
    [credential, `team:${credential.slice(0, 16)}`],
  );
  if (created.length) return { teamId: created[0]!.token, legacy: true };
  // Lost a race against another auto-create of the same legacy token: fine,
  // as long as that row is still secret-less.
  const raced = await q<{ token: string }>(
    'SELECT token FROM teams WHERE token = $1 AND secret_hash IS NULL LIMIT 1',
    [credential],
  );
  return raced.length ? { teamId: raced[0]!.token, legacy: true } : null;
}

// Create a team with a freshly minted secret. Returns the secret (the only
// time it is ever available) or null when the id is taken.
export async function registerTeam(
  teamId: string,
  name: string,
): Promise<{ teamId: string; name: string; secret: string } | null> {
  const secret = mintSecret();
  const rows = await q<{ token: string; name: string }>(
    `INSERT INTO teams (token, name, secret_hash) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO NOTHING
     RETURNING token, name`,
    [teamId, name, hashSecret(secret)],
  );
  return rows.length ? { teamId: rows[0]!.token, name: rows[0]!.name, secret } : null;
}

// Replace a team's secret. For a legacy team this is the upgrade: from now on
// its id stops working as a credential.
export async function rotateTeamSecret(teamId: string): Promise<string> {
  const secret = mintSecret();
  await q('UPDATE teams SET secret_hash = $2 WHERE token = $1', [teamId, hashSecret(secret)]);
  return secret;
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

// Rich-bootstrap jobs run in-process (setImmediate in /onboard/repo/full), so
// a restart kills them mid-flight and leaves wiki_jobs rows 'running' forever
// — the CLI and MCP tool then poll until their own deadline. At startup no
// job can still be running in this process, so mark leftovers failed with a
// reason the client shows. Single-process assumption, like the rate limiter:
// with several API replicas this would fail another replica's live jobs.
export async function failInterruptedJobs(): Promise<number> {
  const reason = 'interrupted: the API restarted while this job was running — re-run bootstrap';
  const jobs = await q<{ id: string }>(
    `UPDATE wiki_jobs
        SET status = 'failed', finished_at = NOW(), error = $1
      WHERE status IN ('pending', 'running')
      RETURNING id`,
    [reason],
  );
  if (jobs.length) {
    await q(
      `UPDATE wiki_job_paths SET status = 'failed', error = $2
        WHERE job_id = ANY($1::uuid[]) AND status IN ('pending', 'running')`,
      [jobs.map((j) => j.id), reason],
    );
  }
  return jobs.length;
}
