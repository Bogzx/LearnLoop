// READ-ONLY: list every prompt for the CS-Weekly-Item-Journal team.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

for (const candidate of ['.env', '../../.env', '../../../.env']) {
  const p = resolve(process.cwd(), candidate);
  if (existsSync(p)) { process.loadEnvFile(p); break; }
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const rows = await pool.query(
  `SELECT p.id, p.template, p.created_at, p.graduated_overall_score AS score, n.path
     FROM prompts p
     JOIN nodes n ON n.id = p.node_id
    WHERE n.team_token = $1
    ORDER BY p.created_at DESC`,
  ['repo_dbab62ba8d72ca37'],
);
console.log(`\n${rows.rowCount} prompt(s) for CS-Weekly-Item-Journal:\n`);
for (const r of rows.rows) {
  console.log(`  ${r.id}  ${r.created_at.toISOString()}  ${r.score}/10  path="${r.path}"`);
  console.log(`     ${JSON.stringify(r.template).slice(0, 220)}${r.template.length > 220 ? '…' : ''}`);
}
await pool.end();
