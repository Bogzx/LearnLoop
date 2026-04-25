#!/usr/bin/env node
// Tiny ad-hoc checker. Edit the query, run `node packages/db/check.mjs`.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

for (const c of ['.env', '../../.env']) {
  const p = resolve(process.cwd(), c);
  if (existsSync(p)) { process.loadEnvFile(p); break; }
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const sql = process.argv[2] ?? `select id, name from teams`;
const r = await client.query(sql);
console.log(JSON.stringify(r.rows, null, 2));

await client.end();
