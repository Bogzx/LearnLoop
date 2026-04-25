#!/usr/bin/env node
// Apply packages/db/schema.sql against $DATABASE_URL. Idempotent (every CREATE
// uses IF NOT EXISTS). Run from repo root: `node packages/db/migrate.mjs`.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

for (const candidate of ['.env', '../../.env']) {
  const p = resolve(process.cwd(), candidate);
  if (existsSync(p)) { process.loadEnvFile(p); break; }
}
if (!process.env.DATABASE_URL && existsSync(resolve(repoRoot, '.env'))) {
  process.loadEnvFile(resolve(repoRoot, '.env'));
}

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

const schema = readFileSync(resolve(here, 'schema.sql'), 'utf8');

const client = new pg.Client({ connectionString: url });
await client.connect();

const ping = await client.query('select 1 as ok');
console.log(`connected: ${ping.rows[0].ok === 1 ? 'ok' : 'unexpected'}`);

await client.query(schema);
const tables = await client.query(`
  select table_name from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE'
   order by table_name
`);
console.log('tables:', tables.rows.map((r) => r.table_name).join(', '));

await client.end();
