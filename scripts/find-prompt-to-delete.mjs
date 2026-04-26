// One-off: locate the prompt the user wants to delete.
// READ-ONLY. No DELETE happens here — that's a second script.
//
// Run from apps/api so node resolves `pg`:
//   cd apps/api && node ../../scripts/find-prompt-to-delete.mjs

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

for (const candidate of ['.env', '../../.env', '../../../.env']) {
  const p = resolve(process.cwd(), candidate);
  if (existsSync(p)) { process.loadEnvFile(p); break; }
}

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function main() {
  const teams = await pool.query(
    `SELECT token, name FROM teams
      WHERE LOWER(name) LIKE '%cs%weekly%'
         OR LOWER(name) LIKE '%weekly%journal%'
         OR LOWER(name) LIKE '%item%journal%'
         OR LOWER(name) LIKE '%journal%'
      ORDER BY name`,
  );
  console.log(`\n=== Teams matching the description (${teams.rowCount}) ===`);
  for (const r of teams.rows) console.log(`  ${r.token}   ${JSON.stringify(r.name)}`);

  const prompts = await pool.query(
    `SELECT p.id,
            p.template,
            p.topic,
            p.graduated_overall_score,
            p.reuse_count,
            p.created_at,
            p.author_user_id,
            n.path  AS node_path,
            n.team_token,
            t.name  AS team_name
       FROM prompts p
       JOIN nodes n ON n.id = p.node_id
       JOIN teams t ON t.token = n.team_token
      WHERE LOWER(p.template) LIKE '%improve the create case%'
         OR LOWER(p.template) LIKE '%create case to output%'
         OR LOWER(p.template) LIKE '%create_case%'
         OR (LOWER(p.template) LIKE '%create case%'
             AND (LOWER(p.template) LIKE '%output%'
                  OR LOWER(p.template) LIKE '%json%'
                  OR LOWER(p.template) LIKE '%csv%'))
      ORDER BY p.created_at DESC`,
  );

  console.log(`\n=== Prompts matching the chain (${prompts.rowCount}) ===`);
  for (const r of prompts.rows) {
    console.log('---');
    console.log(`  id           ${r.id}`);
    console.log(`  team         ${JSON.stringify(r.team_name)}  (${r.team_token})`);
    console.log(`  node_path    ${r.node_path}`);
    console.log(`  topic        ${r.topic}`);
    console.log(`  score/reuse  ${r.graduated_overall_score}/10  reuse=${r.reuse_count}`);
    console.log(`  created_at   ${r.created_at.toISOString()}`);
    console.log(`  author       ${r.author_user_id ?? '(null)'}`);
    console.log(`  template     ${JSON.stringify(r.template).slice(0, 400)}${r.template.length > 400 ? '…' : ''}`);
  }
  console.log('');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => pool.end());
