#!/usr/bin/env node
// Demo data for the public demo team, "Acme Fintech" — a fictional team.
// EVERYTHING here is synthetic: the wiki, the prompts and the activity.
// Idempotent — safe to re-run; re-running also moves the activity window to
// "the last six days" again, since the dashboard only shows the last seven.
//
//   - 5 wiki nodes, 4 durable + 2 draft learnings, 4 graduated prompts
//   - prompt activity for three made-up users (demo-ana, demo-marco,
//     demo-lina): 48 scored prompts each, about one every three hours over
//     the last 6 days, written as skill_observations whose scores drift
//     upwards (deterministic, no randomness at runtime), so the skill-arc
//     chart (last 24 h) and the 7-day team metrics both have something to show
//   - 18 captures with outcomes, so the team metrics are not all zero
//
// Run from repo root: `node packages/db/seed.mjs`, or with the compose stack:
// `docker compose --profile demo up` (the `seed` service runs it once).

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

// --- synthetic activity ---------------------------------------------------------

const DIMS = ['goal_clarity', 'specificity', 'context_loading', 'constraint_articulation', 'output_specification'];
// Where each made-up user starts per dimension, and how far they move in six days.
const USERS = [
  { id: 'demo-ana',   start: [5, 4, 3, 2, 3], gain: [3, 3, 4, 4, 4] },
  { id: 'demo-marco', start: [6, 5, 5, 3, 2], gain: [2, 2, 3, 4, 5] },
  { id: 'demo-lina',  start: [4, 3, 2, 2, 2], gain: [4, 4, 5, 3, 4] },
];
const DAYS = 6;
const PROMPTS_PER_USER = 48;
// Marks seeded captures, which have no user column, so a re-run replaces them.
const CAPTURE_MARK = '(synthetic demo capture, written by packages/db/seed.mjs)';
const CAPTURE_PROMPTS = [
  ['browser', 'In src/api/webhooks/handler.ts, retry failed deliveries with exponential backoff; keep it idempotent on event_id. Return only the diff.', 'src/api/webhooks/handler.ts'],
  ['mcp', 'Add a 15-minute access token to src/api/auth/issue.ts signed with JWT_SECRET; HS256 only. Return the issueToken function.', 'src/api/auth/issue.ts'],
  ['vscode', 'Wrap src/api/orders/list.ts in structured error handling; never leak stack traces. Return the whole file.', 'src/api/orders/list.ts'],
  ['browser', 'fix the retry', null],
  ['mcp', 'Why is the Stripe webhook signature check failing in src/api/webhooks/stripe.ts?', 'src/api/webhooks/stripe.ts'],
  ['vscode', 'make the auth code cleaner', null],
];
const OUTCOMES = ['helpful', 'helpful', 'helpful', 'mixed', 'helpful', 'not'];

// Small deterministic PRNG (mulberry32), fixed seed: same data on every run.
function prng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticObservations(now) {
  const rand = prng(2026);
  const rows = [];
  const span = DAYS * 24 * 3600_000 - 30 * 60_000; // oldest ~6 days ago, newest 30 min ago
  USERS.forEach((u, n) => {
    for (let k = 0; k < PROMPTS_PER_USER; k++) {
      const progress = k / (PROMPTS_PER_USER - 1);
      // evenly spaced, oldest first; users offset by an hour so buckets mix
      const ts = new Date(now - 30 * 60_000 - (1 - progress) * span - n * 3600_000);
      const hash = `demo-seed-${u.id}-${k}`;
      DIMS.forEach((dim, i) => {
        const noise = Math.round((rand() - 0.5) * 2.4);
        const score = Math.max(0, Math.min(10, Math.round(u.start[i] + u.gain[i] * progress) + noise));
        rows.push([u.id, dim, score, hash, ts.toISOString()]);
      });
    }
  });
  return rows;
}

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

  // 4) Activity — replaced wholesale on every run, so it always covers the
  // last six days.
  const now = Date.now();
  await client.query(
    `DELETE FROM skill_observations WHERE team_token = $1 AND user_id LIKE 'demo-%'`,
    [DEMO_TEAM_TOKEN],
  );
  const obs = syntheticObservations(now);
  for (let i = 0; i < obs.length; i += 100) {
    const chunk = obs.slice(i, i + 100);
    await client.query(
      `INSERT INTO skill_observations (team_token, user_id, dimension, score, prompt_hash, ts)
       VALUES ${chunk.map((_, j) => `($1, $${j * 5 + 2}, $${j * 5 + 3}, $${j * 5 + 4}, $${j * 5 + 5}, $${j * 5 + 6})`).join(', ')}`,
      [DEMO_TEAM_TOKEN, ...chunk.flat()],
    );
  }

  await client.query(
    `DELETE FROM captures WHERE team_token = $1 AND ai_response = $2`,
    [DEMO_TEAM_TOKEN, CAPTURE_MARK],
  );
  for (let i = 0; i < 18; i++) {
    const [surface, prompt, filePath] = CAPTURE_PROMPTS[i % CAPTURE_PROMPTS.length];
    await client.query(
      `INSERT INTO captures (team_token, surface, user_prompt, ai_response, file_path, outcome, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [DEMO_TEAM_TOKEN, surface, prompt, CAPTURE_MARK, filePath, OUTCOMES[i % OUTCOMES.length],
       new Date(now - (i * 7 + 3) * 3600_000).toISOString()],
    );
  }

  await client.query('COMMIT');
  const counts = await client.query(`
    SELECT
      (SELECT count(*) FROM nodes      WHERE team_token = $1)                              AS nodes,
      (SELECT count(*) FROM learnings  WHERE node_id IN (SELECT id FROM nodes WHERE team_token = $1)) AS learnings,
      (SELECT count(*) FROM prompts    WHERE node_id IN (SELECT id FROM nodes WHERE team_token = $1)) AS prompts,
      (SELECT count(*) FROM skill_observations WHERE team_token = $1)                      AS observations,
      (SELECT count(*) FROM captures   WHERE team_token = $1)                              AS captures
  `, [DEMO_TEAM_TOKEN]);
  console.log('seeded:', counts.rows[0]);
} catch (e) {
  await client.query('ROLLBACK');
  console.error(e);
  process.exit(1);
} finally {
  await client.end();
}
