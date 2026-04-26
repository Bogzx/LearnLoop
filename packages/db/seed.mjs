#!/usr/bin/env node
// Minimal Acme Fintech seed for the demo. Idempotent — safe to re-run.
// 5 nodes with body_md, 4 durable + 2 draft learnings, 4 graduated prompts.
// Run from repo root: `node packages/db/seed.mjs`.
//
// Full §11 seed (15 learnings, 30 captures, 50 skill_observations) is
// deferred — this is just enough that /context, /examples, and /wiki/recent
// return non-empty during smoke tests.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

for (const c of ['.env', '../../.env']) {
  const p = resolve(process.cwd(), c);
  if (existsSync(p)) { process.loadEnvFile(p); break; }
}

const DEMO_TEAM_TOKEN = 'trailhead_demo_acme_2026';

const NODES = [
  { path: '',                  body_md: '# Acme Fintech engineering wiki\n\nReusable rules and patterns. Owned by the team, surfaced by Trailhead.' },
  { path: 'src/',              body_md: '# src/\n\nDefault: TypeScript strict, ESM modules.' },
  { path: 'src/api/',          body_md: '# API conventions\n\n- All requests authenticated via X-Team-Token header.\n- Errors return JSON `{error, detail}`.\n- Never block the user on background work.' },
  { path: 'src/api/auth/',     body_md: '# Auth\n\n- Tokens issued by `auth/issue.ts`.\n- 15 minute expiry, refresh via `auth/refresh.ts`.' },
  { path: 'src/api/webhooks/', body_md: '# Webhook handlers\n\n- All webhooks must be idempotent on `event_id`.\n- Retry with exponential backoff + jitter.\n- 5xx → retry, 4xx → ack and drop.' },
];

const LEARNINGS = [
  { node_path: 'src/api/webhooks/', body: 'We always use exponential backoff with jitter for webhook retries.', count: 4, status: 'durable' },
  { node_path: 'src/api/webhooks/', body: 'Webhook handlers must be idempotent on event_id.',                       count: 5, status: 'durable' },
  { node_path: 'src/api/auth/',     body: 'Auth tokens expire after 15 minutes; refresh via auth/refresh.ts.',      count: 3, status: 'durable' },
  { node_path: 'src/api/',          body: 'Errors are returned as JSON {error, detail} with the right HTTP status.',count: 3, status: 'durable' },
  { node_path: 'src/api/webhooks/', body: 'Stripe webhook secrets live in env, never in code.',                     count: 1, status: 'draft' },
  { node_path: 'src/api/auth/',     body: 'Use bcrypt cost 12 for password hashing.',                                count: 2, status: 'draft' },
];

const PROMPTS = [
  { node_path: 'src/api/webhooks/', topic: 'retry',
    template: 'In src/api/webhooks/handler.ts, fix the retry loop so failed deliveries are retried with exponential backoff and jitter. Constraints: must remain idempotent on event_id; max 5 attempts; cap delay at 60s. Return only the updated handleRetry function, no surrounding context.',
    reuse_count: 7 },
  { node_path: 'src/api/webhooks/', topic: 'webhook',
    template: 'Add a Stripe webhook handler at src/api/webhooks/stripe.ts that verifies the signature using STRIPE_WEBHOOK_SECRET, ACKs 2xx responses, and routes events to handlers/{type}.ts. Constraint: idempotent on event_id, drop duplicates silently. Return the file contents only.',
    reuse_count: 5 },
  { node_path: 'src/api/auth/', topic: 'auth',
    template: 'In src/api/auth/issue.ts, generate a 15-minute access token signed with JWT_SECRET. Constraint: payload must include user_id, team_token, iat, exp; algorithm HS256. Return only the issueToken function with its imports.',
    reuse_count: 6 },
  { node_path: 'src/api/', topic: 'error_handling',
    template: 'Wrap the route in src/api/orders/list.ts with structured error handling: log via logger.ts, return JSON {error, detail} with the right HTTP status (400/401/404/500). Constraint: never leak stack traces. Return the entire updated route file.',
    reuse_count: 4 },
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query('BEGIN');
try {
  // 1) Nodes
  for (const n of NODES) {
    await client.query(
      `INSERT INTO nodes (team_token, path, body_md)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_token, path) DO UPDATE SET body_md = EXCLUDED.body_md,
                                                 updated_at = NOW()`,
      [DEMO_TEAM_TOKEN, n.path, n.body_md],
    );
  }

  // 2) Learnings — keyed by (node_id, body_normalized) for idempotency.
  // Resolve node_id first so the INSERT/UPDATE doesn't need a CTE (which
  // confuses Postgres parameter inference for $3..$6).
  for (const l of LEARNINGS) {
    const norm = l.body.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const { rows: nrows } = await client.query(
      `SELECT id FROM nodes WHERE team_token = $1 AND path = $2`,
      [DEMO_TEAM_TOKEN, l.node_path],
    );
    const nodeId = nrows[0]?.id;
    if (!nodeId) throw new Error(`missing node ${l.node_path}`);

    const { rows: existing } = await client.query(
      `SELECT id FROM learnings WHERE node_id = $1 AND body_normalized = $2`,
      [nodeId, norm],
    );
    if (existing.length === 0) {
      await client.query(
        `INSERT INTO learnings (node_id, body, body_normalized, status, reinforcement_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [nodeId, l.body, norm, l.status, l.count],
      );
    } else {
      await client.query(
        `UPDATE learnings
            SET status = $1, reinforcement_count = $2, last_seen_at = NOW()
          WHERE id = $3`,
        [l.status, l.count, existing[0].id],
      );
    }
  }

  // 3) Prompts — keyed by (node_id, template) for idempotency
  for (const p of PROMPTS) {
    const { rows: nrows } = await client.query(
      `SELECT id FROM nodes WHERE team_token = $1 AND path = $2`,
      [DEMO_TEAM_TOKEN, p.node_path],
    );
    const nodeId = nrows[0]?.id;
    if (!nodeId) throw new Error(`missing node ${p.node_path}`);

    const { rows: existing } = await client.query(
      `SELECT id FROM prompts WHERE node_id = $1 AND template = $2`,
      [nodeId, p.template],
    );
    if (existing.length === 0) {
      await client.query(
        `INSERT INTO prompts (node_id, template, topic, reuse_count, status)
         VALUES ($1, $2, $3, $4, 'graduated')`,
        [nodeId, p.template, p.topic, p.reuse_count],
      );
    } else {
      await client.query(
        `UPDATE prompts SET reuse_count = $1, topic = $2 WHERE id = $3`,
        [p.reuse_count, p.topic, existing[0].id],
      );
    }
  }

  await client.query('COMMIT');
  const counts = await client.query(`
    SELECT
      (SELECT count(*) FROM nodes      WHERE team_token = $1)                              AS nodes,
      (SELECT count(*) FROM learnings  WHERE node_id IN (SELECT id FROM nodes WHERE team_token = $1)) AS learnings,
      (SELECT count(*) FROM prompts    WHERE node_id IN (SELECT id FROM nodes WHERE team_token = $1)) AS prompts
  `, [DEMO_TEAM_TOKEN]);
  console.log('seeded:', counts.rows[0]);
} catch (e) {
  await client.query('ROLLBACK');
  console.error(e);
  process.exit(1);
} finally {
  await client.end();
}
