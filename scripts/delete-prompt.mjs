// One-off DELETE for the prompt(s) the user confirmed.
// Run from apps/api so node resolves `pg`:
//   cd apps/api && node ../../scripts/delete-prompt.mjs

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

for (const candidate of ['.env', '../../.env', '../../../.env']) {
  const p = resolve(process.cwd(), candidate);
  if (existsSync(p)) { process.loadEnvFile(p); break; }
}

const PROMPT_IDS = [
  '9fd05c5f-346f-42f5-8548-f087c251ad15',
  '2e9bb4d8-1e1d-49c9-ba95-e92174fd69a5',
];
const EXPECTED_TEAM = 'repo_dbab62ba8d72ca37';
const EXPECTED_TEMPLATE_PREFIX = 'I want to improve the create case to output differently';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(
      `SELECT p.id, p.template, n.team_token
         FROM prompts p
         JOIN nodes n ON n.id = p.node_id
        WHERE p.id = ANY($1::uuid[])`,
      [PROMPT_IDS],
    );
    if (before.rowCount !== PROMPT_IDS.length) {
      throw new Error(`expected ${PROMPT_IDS.length} rows, found ${before.rowCount}`);
    }
    for (const row of before.rows) {
      if (row.team_token !== EXPECTED_TEAM) {
        throw new Error(`team_token mismatch on ${row.id}: expected ${EXPECTED_TEAM}, got ${row.team_token}`);
      }
      if (!row.template.startsWith(EXPECTED_TEMPLATE_PREFIX)) {
        throw new Error(`template prefix mismatch on ${row.id} — refusing to delete`);
      }
    }

    const del = await client.query(
      `DELETE FROM prompts WHERE id = ANY($1::uuid[])`,
      [PROMPT_IDS],
    );
    console.log(`deleted ${del.rowCount} row(s) from prompts`);

    await client.query('COMMIT');

    const after = await client.query(
      `SELECT id FROM prompts WHERE id = ANY($1::uuid[])`,
      [PROMPT_IDS],
    );
    if (after.rowCount !== 0) throw new Error('rows still present after commit');
    console.log('verified: rows no longer present');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

main()
  .catch((e) => { console.error('FAILED:', e.message); process.exit(1); })
  .finally(() => pool.end());
