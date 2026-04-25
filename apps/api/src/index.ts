import './env.ts';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type {
  CaptureRequest,
  CaptureResponse,
  ContextNode,
  ContextResponse,
  DiffRequest,
  DiffResponse,
  Dimension,
  DimensionScores,
  ExamplesItem,
  ExamplesResponse,
  OnboardRepoRequest,
  OnboardRepoResponse,
  ScoreRequest,
  ScoreResponse,
  SkillArcObservation,
  SkillArcResponse,
  TeamMetricsResponse,
  WikiProposeRequest,
  WikiProposeResponse,
  WikiRecentItem,
  WikiRecentResponse,
  WikiTreeLearning,
  WikiTreeNode,
  WikiTreeResponse,
} from '@trailhead/shared';
import { DIMENSIONS } from '@trailhead/shared';
import { ancestorPaths, normalize, normalizePath } from '@trailhead/scoring';
import { DEMO_TEAM_ID, q, upsertNode } from './db.ts';
import { extractTopic, overallScore, scorePrompt, synthesizeDiff } from './gemini.ts';

const TEAM_TOKEN = process.env.TEAM_TOKEN;
if (!TEAM_TOKEN) {
  console.error('TEAM_TOKEN not set. Copy .env.example -> .env at the repo root.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

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
    endpoints: [
      'POST /score',
      'POST /capture',
      'POST /wiki/propose',
      'GET  /context?path=',
      'GET  /examples?path=',
      'GET  /wiki/recent?since=ISO',
      'POST /diff',
      'GET  /skill-arc?user_id=&since=ISO',
      'GET  /team/metrics',
      'GET  /wiki/tree',
      'POST /onboard/repo',
    ],
  }),
);

// ----- POST /score -----------------------------------------------------------
// Live 5-dim Gemini score; writes 5 skill_observation rows (one per dimension)
// with a 30s dedup window per (team, user, dimension, prompt-hash) per spec
// §19 risk register. Fails closed (returns 500 on Gemini error) — the browser
// extension fails open on its side so the user is never blocked.

function simpleHash(s: string): string {
  // Tiny non-crypto hash for the skill_observation dedup key. Collisions
  // are harmless here — they'd just suppress one extra row.
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h.toString(16);
}

app.post('/score', async (c) => {
  const body = await c.req.json<ScoreRequest>().catch(() => null);
  if (!body || typeof body.prompt !== 'string' || typeof body.user_id !== 'string') {
    return c.json({ error: 'bad_request' }, 400);
  }

  const result = await scorePrompt({ prompt: body.prompt, file_path: body.file_path });
  const overall = overallScore(result.dimensions);

  // Skill_observation writes — 5 rows per call, with per-(user, dim,
  // prompt-hash) 30s dedup per spec §19. Same prompt re-scored within the
  // window is suppressed; different prompts always write.
  const promptHash = simpleHash(body.prompt);
  await q(
    `INSERT INTO skill_observations (team_id, user_id, dimension, score, prompt_hash)
     SELECT i.team_id, i.user_id, i.dimension, i.score, i.prompt_hash
       FROM ( VALUES
         ${DIMENSIONS.map((_, i) =>
           `($1::uuid, $2::text, $${3 + i * 2}::text, $${4 + i * 2}::int, $13::text)`
         ).join(',\n         ')}
       ) AS i(team_id, user_id, dimension, score, prompt_hash)
      WHERE NOT EXISTS (
        SELECT 1 FROM skill_observations s
         WHERE s.team_id     = i.team_id
           AND s.user_id     = i.user_id
           AND s.dimension   = i.dimension
           AND s.prompt_hash = i.prompt_hash
           AND s.ts          > NOW() - INTERVAL '30 seconds'
      )`,
    [
      DEMO_TEAM_ID,
      body.user_id,
      ...DIMENSIONS.flatMap((d) => [d, result.dimensions[d]]),
      promptHash,
    ],
  );

  const res: ScoreResponse = {
    overall,
    dimensions: result.dimensions,
    missing: result.missing,
  };
  return c.json(res);
});

// ----- POST /capture ---------------------------------------------------------
app.post('/capture', async (c) => {
  const body = await c.req.json<CaptureRequest>().catch(() => null);
  if (!body || typeof body.user_prompt !== 'string' || typeof body.user_id !== 'string') {
    return c.json({ error: 'bad_request' }, 400);
  }
  const surface = body.surface;
  if (surface !== 'browser' && surface !== 'vscode' && surface !== 'mcp') {
    return c.json({ error: 'bad_surface' }, 400);
  }

  const rows = await q<{ id: string }>(
    `INSERT INTO captures
       (team_id, surface, user_prompt, ai_response, file_path, outcome, scored_dimensions)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      DEMO_TEAM_ID,
      surface,
      body.user_prompt,
      body.ai_response ?? null,
      body.file_path ?? null,
      body.outcome ?? null,
      body.scored_dimensions ? JSON.stringify(body.scored_dimensions) : null,
    ],
  );
  const res: CaptureResponse = { id: rows[0]!.id };
  return c.json(res);
});

// ----- POST /wiki/propose ----------------------------------------------------
// Normalize → dedup on (node_id, body_normalized) → increment count → promote
// to durable at >= 3. Idempotent: repeated calls for the same insight only
// reinforce the existing draft.

app.post('/wiki/propose', async (c) => {
  const body = await c.req.json<WikiProposeRequest>().catch(() => null);
  if (!body || typeof body.node_path !== 'string' || typeof body.insight !== 'string') {
    return c.json({ error: 'bad_request' }, 400);
  }
  if (!body.insight.trim()) return c.json({ error: 'empty_insight' }, 400);

  const path = normalizePath(body.node_path);
  const nodeId = await upsertNode(DEMO_TEAM_ID, path);
  const bodyNormalized = normalize(body.insight);

  const existing = await q<{
    id: string; reinforcement_count: number; status: 'draft' | 'durable';
  }>(
    `SELECT id, reinforcement_count, status
       FROM learnings
      WHERE node_id = $1 AND body_normalized = $2
      LIMIT 1`,
    [nodeId, bodyNormalized],
  );

  let action: WikiProposeResponse['action'];
  let currentCount: number;
  let promotedToDurable = false;

  if (existing.length === 0) {
    const inserted = await q<{ reinforcement_count: number }>(
      `INSERT INTO learnings (node_id, body, body_normalized)
       VALUES ($1, $2, $3)
       RETURNING reinforcement_count`,
      [nodeId, body.insight.trim(), bodyNormalized],
    );
    action = 'created';
    currentCount = inserted[0]!.reinforcement_count;
  } else {
    const row = existing[0]!;
    const updated = await q<{ reinforcement_count: number; status: 'draft' | 'durable' }>(
      `UPDATE learnings
          SET reinforcement_count = reinforcement_count + 1,
              last_seen_at = NOW(),
              status = CASE WHEN reinforcement_count + 1 >= 3 THEN 'durable' ELSE status END
        WHERE id = $1
        RETURNING reinforcement_count, status`,
      [row.id],
    );
    const after = updated[0]!;
    currentCount = after.reinforcement_count;
    promotedToDurable = row.status === 'draft' && after.status === 'durable';
    action = promotedToDurable ? 'promoted' : 'reinforced';
  }

  const res: WikiProposeResponse = {
    action,
    current_count: currentCount,
    ...(promotedToDurable ? { promoted_to_durable: true } : {}),
  };
  return c.json(res);
});

// ----- GET /context?path= ----------------------------------------------------
// HCL ancestor walk: every node whose path is a prefix of the file path,
// shallow → deep, plus its top durable learnings.

app.get('/context', async (c) => {
  const filePath = c.req.query('path') ?? '';
  if (!filePath) return c.json({ error: 'missing_path' }, 400);

  const ancestors = ancestorPaths(filePath);
  if (ancestors.length === 0) {
    const res: ContextResponse = { nodes: [] };
    return c.json(res);
  }

  const rows = await q<{
    path: string; body_md: string; learning_body: string | null; reinforcement_count: number | null;
  }>(
    `SELECT n.path, n.body_md, l.body AS learning_body, l.reinforcement_count
       FROM nodes n
       LEFT JOIN learnings l
              ON l.node_id = n.id
             AND l.status = 'durable'
      WHERE n.team_id = $1
        AND n.path = ANY($2::text[])
      ORDER BY length(n.path) ASC, n.path ASC,
               COALESCE(l.reinforcement_count, 0) DESC`,
    [DEMO_TEAM_ID, ancestors],
  );

  const byPath = new Map<string, ContextNode>();
  for (const r of rows) {
    let node = byPath.get(r.path);
    if (!node) {
      node = { path: r.path, body_md: r.body_md, durable_learnings: [] };
      byPath.set(r.path, node);
    }
    if (r.learning_body) {
      node.durable_learnings.push({
        body: r.learning_body,
        reinforcement_count: r.reinforcement_count ?? 0,
      });
    }
  }

  const res: ContextResponse = {
    nodes: ancestors
      .map((p) => byPath.get(p))
      .filter((n): n is ContextNode => Boolean(n)),
  };
  return c.json(res);
});

// ----- GET /examples?path= ---------------------------------------------------
app.get('/examples', async (c) => {
  const filePath = c.req.query('path') ?? '';
  if (!filePath) return c.json({ error: 'missing_path' }, 400);
  const limit = Math.max(1, Math.min(10, Number(c.req.query('limit') ?? 3)));
  const ancestors = ancestorPaths(filePath);

  const rows = await q<{
    template: string; topic: string | null; reuse_count: number; node_path: string;
  }>(
    `SELECT p.template, p.topic, p.reuse_count, n.path AS node_path
       FROM prompts p
       JOIN nodes n ON n.id = p.node_id
      WHERE n.team_id = $1
        AND n.path = ANY($2::text[])
        AND p.status = 'graduated'
      ORDER BY p.reuse_count DESC, length(n.path) DESC
      LIMIT $3`,
    [DEMO_TEAM_ID, ancestors, limit],
  );

  const res: ExamplesResponse = { items: rows.map((r): ExamplesItem => ({
    template: r.template,
    topic: r.topic,
    reuse_count: r.reuse_count,
    node_path: r.node_path,
  })) };
  return c.json(res);
});

// ----- GET /wiki/recent?since=ISO --------------------------------------------
app.get('/wiki/recent', async (c) => {
  const sinceParam = c.req.query('since');
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 60 * 60 * 1000);
  if (Number.isNaN(since.getTime())) return c.json({ error: 'bad_since' }, 400);
  const limit = Math.max(1, Math.min(200, Number(c.req.query('limit') ?? 50)));

  const rows = await q<{
    id: string;
    node_path: string;
    body: string;
    status: 'draft' | 'durable';
    reinforcement_count: number;
    last_seen_at: Date;
    created_at: Date;
  }>(
    `SELECT l.id, n.path AS node_path, l.body, l.status,
            l.reinforcement_count, l.last_seen_at, l.created_at
       FROM learnings l
       JOIN nodes n ON n.id = l.node_id
      WHERE n.team_id = $1
        AND l.last_seen_at > $2
      ORDER BY l.last_seen_at DESC
      LIMIT $3`,
    [DEMO_TEAM_ID, since.toISOString(), limit],
  );

  const res: WikiRecentResponse = {
    items: rows.map((r): WikiRecentItem => ({
      id: r.id,
      node_path: r.node_path,
      body: r.body,
      status: r.status,
      reinforcement_count: r.reinforcement_count,
      last_seen_at: r.last_seen_at.toISOString(),
      created_at: r.created_at.toISOString(),
    })),
  };
  return c.json(res);
});

// ----- POST /diff ------------------------------------------------------------
// Find the closest graduated prompt in the same path/topic ancestry, score
// both, and have Gemma narrate the differences. Spec §10.

app.post('/diff', async (c) => {
  const body = await c.req.json<DiffRequest>().catch(() => null);
  if (!body || typeof body.user_prompt !== 'string' || typeof body.user_id !== 'string') {
    return c.json({ error: 'bad_request' }, 400);
  }

  const ancestors = body.file_path ? ancestorPaths(body.file_path) : [''];
  const topic = await extractTopic(body.user_prompt);

  // Prefer same-topic + same-ancestry. Fall back to any topic in ancestry.
  // Final fallback: any graduated prompt in this team.
  let candidate = (
    await q<{ template: string; topic: string | null; node_path: string }>(
      `SELECT p.template, p.topic, n.path AS node_path
         FROM prompts p
         JOIN nodes n ON n.id = p.node_id
        WHERE n.team_id = $1
          AND p.status = 'graduated'
          AND p.topic = $2
          AND n.path = ANY($3::text[])
        ORDER BY p.reuse_count DESC, length(n.path) DESC
        LIMIT 1`,
      [DEMO_TEAM_ID, topic, ancestors],
    )
  )[0];
  if (!candidate) {
    candidate = (
      await q<{ template: string; topic: string | null; node_path: string }>(
        `SELECT p.template, p.topic, n.path AS node_path
           FROM prompts p
           JOIN nodes n ON n.id = p.node_id
          WHERE n.team_id = $1
            AND p.status = 'graduated'
            AND n.path = ANY($2::text[])
          ORDER BY p.reuse_count DESC, length(n.path) DESC
          LIMIT 1`,
        [DEMO_TEAM_ID, ancestors],
      )
    )[0];
  }
  if (!candidate) {
    candidate = (
      await q<{ template: string; topic: string | null; node_path: string }>(
        `SELECT p.template, p.topic, n.path AS node_path
           FROM prompts p
           JOIN nodes n ON n.id = p.node_id
          WHERE n.team_id = $1 AND p.status = 'graduated'
          ORDER BY p.reuse_count DESC
          LIMIT 1`,
        [DEMO_TEAM_ID],
      )
    )[0];
  }
  if (!candidate) {
    return c.json({ error: 'no_team_prompts_available' }, 404);
  }

  // Sequential, not parallel: Gemini's free tier serialises requests per
  // API key in practice — concurrent Flash calls slow each other to a
  // crawl. Sequential keeps total /diff latency below 10s.
  const userScore = await scorePrompt({ prompt: body.user_prompt, file_path: body.file_path });
  const teamScore = await scorePrompt({ prompt: candidate.template, file_path: candidate.node_path });
  const narrative = await synthesizeDiff({
    user_prompt: body.user_prompt,
    user_scores: userScore.dimensions as DimensionScores,
    team_prompt: candidate.template,
    team_scores: teamScore.dimensions as DimensionScores,
  });

  const res: DiffResponse = {
    user: {
      prompt: body.user_prompt,
      overall: overallScore(userScore.dimensions),
      dimensions: userScore.dimensions,
    },
    team: {
      prompt: candidate.template,
      overall: overallScore(teamScore.dimensions),
      dimensions: teamScore.dimensions,
      node_path: candidate.node_path,
      topic: candidate.topic,
    },
    narrative,
  };
  return c.json(res);
});

// ----- GET /skill-arc?user_id=&since=ISO -------------------------------------
// Time-series of per-dimension scores for the dashboard hero chart. Drives
// the §13 close beat (live tick during demo). Defaults: any user, last 7
// days. Capped at 5000 rows to keep the chart responsive.

app.get('/skill-arc', async (c) => {
  const userIdParam = c.req.query('user_id');
  const sinceParam = c.req.query('since');
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(since.getTime())) return c.json({ error: 'bad_since' }, 400);
  const limit = Math.max(1, Math.min(5000, Number(c.req.query('limit') ?? 1000)));

  const rows = userIdParam
    ? await q<{ dimension: Dimension; score: number; ts: Date }>(
        `SELECT dimension, score, ts
           FROM skill_observations
          WHERE team_id = $1 AND user_id = $2 AND ts > $3
          ORDER BY ts ASC
          LIMIT $4`,
        [DEMO_TEAM_ID, userIdParam, since.toISOString(), limit],
      )
    : await q<{ dimension: Dimension; score: number; ts: Date }>(
        `SELECT dimension, score, ts
           FROM skill_observations
          WHERE team_id = $1 AND ts > $2
          ORDER BY ts ASC
          LIMIT $3`,
        [DEMO_TEAM_ID, since.toISOString(), limit],
      );

  const res: SkillArcResponse = {
    observations: rows.map((r): SkillArcObservation => ({
      dimension: r.dimension,
      score: r.score,
      ts: r.ts.toISOString(),
    })),
  };
  return c.json(res);
});

// ----- GET /team/metrics -----------------------------------------------------
// Snapshot for the dashboard /team page. All cheap aggregate counts; no
// time-series. Reuse rate is captures with outcome='helpful' over total
// captures (proxy for "team's prompts work" until we have the real
// graduated-prompt-match metric).

app.get('/team/metrics', async (c) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [obs, learnings, captures, users] = await Promise.all([
    q<{ avg_overall: number | null; total_obs: number }>(
      `SELECT AVG(score)::float AS avg_overall, COUNT(*)::int AS total_obs
         FROM skill_observations
        WHERE team_id = $1 AND ts > $2`,
      [DEMO_TEAM_ID, sevenDaysAgo],
    ),
    q<{ durable_count: number; draft_count: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE l.status = 'durable')::int AS durable_count,
         COUNT(*) FILTER (WHERE l.status = 'draft')::int   AS draft_count
         FROM learnings l
         JOIN nodes n ON n.id = l.node_id
        WHERE n.team_id = $1`,
      [DEMO_TEAM_ID],
    ),
    q<{ total: number; helpful: number }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE outcome = 'helpful')::int AS helpful
         FROM captures
        WHERE team_id = $1 AND created_at > $2`,
      [DEMO_TEAM_ID, sevenDaysAgo],
    ),
    q<{ active_users: number }>(
      `SELECT COUNT(DISTINCT user_id)::int AS active_users
         FROM skill_observations
        WHERE team_id = $1 AND ts > $2`,
      [DEMO_TEAM_ID, sevenDaysAgo],
    ),
  ]);

  const obsRow = obs[0]!;
  const learningsRow = learnings[0]!;
  const capturesRow = captures[0]!;
  const usersRow = users[0]!;

  const res: TeamMetricsResponse = {
    avg_overall: obsRow.avg_overall ? Math.round(obsRow.avg_overall * 10) / 10 : 0,
    reuse_rate: capturesRow.total > 0 ? capturesRow.helpful / capturesRow.total : 0,
    durable_count: learningsRow.durable_count,
    draft_count: learningsRow.draft_count,
    total_obs: obsRow.total_obs,
    active_users: usersRow.active_users,
  };
  return c.json(res);
});

// ----- GET /wiki/tree --------------------------------------------------------
// Full node list for the dashboard /wiki page. One row per node with its
// learnings split into durable vs draft. Sort by path (prefix-friendly).

app.get('/wiki/tree', async (c) => {
  const rows = await q<{
    node_id: string;
    path: string;
    body_md: string;
    learning_id: string | null;
    learning_body: string | null;
    learning_status: 'draft' | 'durable' | null;
    reinforcement_count: number | null;
  }>(
    `SELECT n.id AS node_id, n.path, n.body_md,
            l.id AS learning_id, l.body AS learning_body,
            l.status AS learning_status, l.reinforcement_count
       FROM nodes n
       LEFT JOIN learnings l ON l.node_id = n.id
      WHERE n.team_id = $1
      ORDER BY n.path ASC,
               COALESCE(l.reinforcement_count, 0) DESC`,
    [DEMO_TEAM_ID],
  );

  const byPath = new Map<string, WikiTreeNode>();
  for (const r of rows) {
    let node = byPath.get(r.path);
    if (!node) {
      node = { path: r.path, body_md: r.body_md, durable_learnings: [], draft_learnings: [] };
      byPath.set(r.path, node);
    }
    if (r.learning_id && r.learning_body && r.learning_status) {
      const learning: WikiTreeLearning = {
        id: r.learning_id,
        body: r.learning_body,
        status: r.learning_status,
        reinforcement_count: r.reinforcement_count ?? 0,
      };
      if (r.learning_status === 'durable') node.durable_learnings.push(learning);
      else node.draft_learnings.push(learning);
    }
  }

  const res: WikiTreeResponse = { nodes: Array.from(byPath.values()) };
  return c.json(res);
});

// ----- POST /onboard/repo ----------------------------------------------------
// Bootstrap a team wiki by upserting one node per path. Idempotent: re-running
// with the same paths is a no-op (the existing node row is left untouched).
// `initial_rules[path]` lets the caller seed `body_md` for any/all of the
// supplied paths — useful when the caller has, say, scanned a repo's existing
// CLAUDE.md or copied conventions from another tool.
//
// Spec ref:
//   docs/superpowers/specs/2026-04-25-demo-completion-design.md §C.1
//   docs/superpowers/specs/2026-04-25-mcp-plugin-ux-design.md (bootstrap UX
//     follow-up — wired through wiki_bootstrap MCP tool + `trailhead-mcp
//     bootstrap` CLI subcommand).

const ONBOARD_MAX_PATHS = 200;

app.post('/onboard/repo', async (c) => {
  const body = await c.req.json<OnboardRepoRequest>().catch(() => null);
  if (!body || !Array.isArray(body.paths)) {
    return c.json({ error: 'bad_request', detail: 'paths: string[] required' }, 400);
  }
  if (body.paths.length === 0) {
    return c.json({ error: 'bad_request', detail: 'paths must not be empty' }, 400);
  }
  if (body.paths.length > ONBOARD_MAX_PATHS) {
    return c.json(
      { error: 'too_many_paths', detail: `max ${ONBOARD_MAX_PATHS} paths per request` },
      400,
    );
  }
  const initialRules =
    body.initial_rules && typeof body.initial_rules === 'object' && !Array.isArray(body.initial_rules)
      ? body.initial_rules
      : {};

  // Normalize + dedupe paths so we don't issue duplicate inserts inside one
  // request (the UNIQUE constraint would catch it but the per-row upsert
  // round-trip is wasted).
  const seen = new Set<string>();
  const normalized: { raw: string; path: string }[] = [];
  for (const raw of body.paths) {
    if (typeof raw !== 'string') continue;
    const path = normalizePath(raw);
    if (!path) continue;                  // empty string after normalization — skip
    if (seen.has(path)) continue;
    seen.add(path);
    normalized.push({ raw, path });
  }

  if (normalized.length === 0) {
    return c.json({ error: 'bad_request', detail: 'no valid paths after normalization' }, 400);
  }

  const nodes: { path: string; id: string }[] = [];
  let nodes_created = 0;

  for (const { raw, path } of normalized) {
    // body_md from initial_rules — match against either the normalized form
    // or the caller's raw string so callers don't need to pre-normalize keys.
    const seedBody =
      typeof initialRules[path] === 'string'
        ? initialRules[path]
        : typeof initialRules[raw] === 'string'
          ? initialRules[raw]
          : '';

    // xmax = 0 in the RETURNING row means the tuple was newly inserted (PG
    // marks it 0 on fresh inserts; ON CONFLICT updates set xmax to the
    // current xid). Lets us count creates without a second query.
    const rows = await q<{ id: string; inserted: boolean }>(
      `INSERT INTO nodes (team_id, path, body_md)
         VALUES ($1, $2, $3)
       ON CONFLICT (team_id, path) DO UPDATE
         SET body_md = CASE
               WHEN $3 <> '' AND nodes.body_md = '' THEN $3
               ELSE nodes.body_md
             END,
             updated_at = NOW()
       RETURNING id, (xmax = 0) AS inserted`,
      [DEMO_TEAM_ID, path, seedBody],
    );
    const row = rows[0]!;
    if (row.inserted) nodes_created += 1;
    nodes.push({ path, id: row.id });
  }

  const res: OnboardRepoResponse = { nodes_created, nodes };
  return c.json(res);
});

// Surface unhandled errors as 500 with a one-line shape clients can show.
app.onError((err, c) => {
  console.error('[trailhead-api]', err);
  return c.json({ error: 'internal_error', detail: String((err as { message?: string }).message ?? err) }, 500);
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`trailhead-api listening on http://localhost:${info.port}`);
});

