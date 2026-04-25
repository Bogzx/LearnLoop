import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type {
  CaptureRequest,
  CaptureResponse,
  ScoreRequest,
  ScoreResponse,
  WikiProposeRequest,
  WikiProposeResponse,
} from '@trailhead/shared';

// Load .env from cwd or repo root. Railway injects env vars directly, so this
// silently no-ops there. Node 20.12+/22 ships process.loadEnvFile natively.
for (const candidate of ['.env', '../../.env']) {
  const p = resolve(process.cwd(), candidate);
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

const TEAM_TOKEN = process.env.TEAM_TOKEN;
if (!TEAM_TOKEN) {
  console.error('TEAM_TOKEN not set. Copy .env.example -> .env at the repo root.');
  process.exit(1);
}

const app = new Hono();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'X-Team-Token'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }),
);

// Single hardcoded team token (spec §3). Health check is unauthenticated.
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || c.req.path === '/') return next();
  if (c.req.header('x-team-token') !== TEAM_TOKEN) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

app.get('/', (c) =>
  c.json({
    name: 'trailhead-api',
    status: 'ok',
    stub: true,
    endpoints: ['/score', '/capture', '/wiki/propose'],
  }),
);

// POST /score — hardcoded demo response. Real impl (spec §5): Haiku 5-dim scoring
// with prompt caching + skill_observation insert.
app.post('/score', async (c) => {
  await c.req.json<ScoreRequest>().catch(() => null);
  const res: ScoreResponse = {
    overall: 4,
    dimensions: {
      goal_clarity: 8,
      specificity: 4,
      context_loading: 2,
      constraint_articulation: 1,
      output_specification: 3,
    },
    missing: {
      context_loading: 'no file or function referenced',
      constraint_articulation: 'no constraints stated',
      output_specification: 'no return shape requested',
    },
  };
  return c.json(res);
});

// POST /capture — stub. Real impl: insert into captures (spec §4).
app.post('/capture', async (c) => {
  await c.req.json<CaptureRequest>().catch(() => null);
  const res: CaptureResponse = { id: '00000000-0000-0000-0000-000000000000' };
  return c.json(res);
});

// POST /wiki/propose — hardcoded `created`. Real impl (spec §7):
// normalize insight (lowercase, strip punctuation) -> exact-match dedup on
// (node_id, body_normalized) -> create draft / increment / promote at >= 3.
app.post('/wiki/propose', async (c) => {
  await c.req.json<WikiProposeRequest>().catch(() => null);
  const res: WikiProposeResponse = { action: 'created', current_count: 1 };
  return c.json(res);
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`trailhead-api stub listening on http://localhost:${info.port}`);
});
