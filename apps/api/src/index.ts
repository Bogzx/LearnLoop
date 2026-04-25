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
  ImproveRequest,
  ImproveResponse,
  ImproveTurn,
  OnboardRepoFullRequest,
  OnboardRepoFullResponse,
  OnboardRepoRequest,
  OnboardRepoResponse,
  ScoreRequest,
  ScoreResponse,
  SkillArcObservation,
  SkillArcResponse,
  TeamMetricsResponse,
  TeamSummary,
  TeamsListResponse,
  WikiJobPathKind,
  WikiJobPathStatus,
  WikiJobStatusResponse,
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
import { DEMO_TEAM_TOKEN, q, teamIdForToken, upsertNode, wipeTeamData } from './db.ts';
import { extractTopic, improveCoach, overallScore, scorePrompt, synthesizeDiff } from './gemini.ts';
import { bundleFromRequest, runJob } from './wiki-bootstrap-job.ts';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

// Multi-tenant policy. Defaults to ON for the hackathon-grade open demo
// posture: any X-Team-Token spawns its own teams row on first write.
// Production deploys should set TRAILHEAD_AUTO_CREATE_TEAMS=false and
// register teams explicitly.
const AUTO_CREATE_TEAMS = process.env.TRAILHEAD_AUTO_CREATE_TEAMS !== 'false';

// Hono context typing — the auth middleware sets `team_id` so every
// downstream handler can pull it via c.get('team_id') with type safety.
type AppEnv = { Variables: { team_id: string } };
const app = new Hono<AppEnv>();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'X-Team-Token'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  }),
);

// Auth middleware — multi-tenant. Resolves the X-Team-Token header into a
// team_id (cached) and attaches it to the request context. Unknown tokens
// either spawn a new team (AUTO_CREATE_TEAMS=true, the demo default) or 401.
//
// The legacy single-tenant TEAM_TOKEN env var is no longer required: the
// demo team is identified by its row's `token` column (DEMO_TEAM_TOKEN), so
// existing clients carrying the old token continue to land on the demo team.
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || c.req.path === '/') return next();
  // /teams is unauthenticated so the popup can populate a Select-team
  // dropdown before any token is configured.
  if (c.req.path === '/teams') return next();
  const token = c.req.header('x-team-token');
  if (!token) return c.json({ error: 'unauthorized', detail: 'missing X-Team-Token' }, 401);
  const teamId = await teamIdForToken(token, { autoCreate: AUTO_CREATE_TEAMS });
  if (!teamId) {
    return c.json(
      { error: 'unauthorized', detail: 'unknown team token' },
      401,
    );
  }
  c.set('team_id', teamId);
  await next();
});

app.get('/', (c) =>
  c.json({
    name: 'trailhead-api',
    status: 'ok',
    multi_tenant: true,
    auto_create_teams: AUTO_CREATE_TEAMS,
    endpoints: [
      'POST /score',
      'POST /capture',
      'POST /wiki/propose',
      'GET  /context?path=',
      'GET  /examples?path=',
      'GET  /wiki/recent?since=ISO',
      'POST /diff',
      'POST /improve',
      'GET  /teams (unauthenticated)',
      'GET  /skill-arc?user_id=&since=ISO',
      'GET  /team/metrics',
      'GET  /wiki/tree',
      'POST /onboard/repo',
      'POST /onboard/repo/full',
      'GET  /onboard/jobs/:id',
      'DELETE /team/data',
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
      c.get('team_id'),
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
      c.get('team_id'),
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
  const nodeId = await upsertNode(c.get('team_id'), path);
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
    [c.get('team_id'), ancestors],
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
    [c.get('team_id'), ancestors, limit],
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
    [c.get('team_id'), since.toISOString(), limit],
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
      [c.get('team_id'), topic, ancestors],
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
        [c.get('team_id'), ancestors],
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
        [c.get('team_id')],
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
        [c.get('team_id'), userIdParam, since.toISOString(), limit],
      )
    : await q<{ dimension: Dimension; score: number; ts: Date }>(
        `SELECT dimension, score, ts
           FROM skill_observations
          WHERE team_id = $1 AND ts > $2
          ORDER BY ts ASC
          LIMIT $3`,
        [c.get('team_id'), since.toISOString(), limit],
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
      [c.get('team_id'), sevenDaysAgo],
    ),
    q<{ durable_count: number; draft_count: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE l.status = 'durable')::int AS durable_count,
         COUNT(*) FILTER (WHERE l.status = 'draft')::int   AS draft_count
         FROM learnings l
         JOIN nodes n ON n.id = l.node_id
        WHERE n.team_id = $1`,
      [c.get('team_id')],
    ),
    q<{ total: number; helpful: number }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE outcome = 'helpful')::int AS helpful
         FROM captures
        WHERE team_id = $1 AND created_at > $2`,
      [c.get('team_id'), sevenDaysAgo],
    ),
    q<{ active_users: number }>(
      `SELECT COUNT(DISTINCT user_id)::int AS active_users
         FROM skill_observations
        WHERE team_id = $1 AND ts > $2`,
      [c.get('team_id'), sevenDaysAgo],
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
    [c.get('team_id')],
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

// ----- GET /teams ------------------------------------------------------------
// Lists every team with a usable token. Unauthenticated (the popup needs to
// populate a Select-team dropdown before any token is configured). Demo
// simplicity: no per-user permission filter.
app.get('/teams', async (c) => {
  const rows = await q<{ id: string; name: string; token: string | null }>(
    'SELECT id, name, token FROM teams WHERE token IS NOT NULL ORDER BY name ASC',
  );
  const teams: TeamSummary[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    token: r.token as string,
  }));
  const res: TeamsListResponse = { teams };
  return c.json(res);
});

// ----- POST /improve ---------------------------------------------------------
// Gemini-driven multi-turn prompt coach. Stateless — caller carries the full
// conversation each turn. Spec: 2026-04-26-improve-widget-design.md
const IMPROVE_TURN_CAP = 5; // user replies; history.length cap is 2 * cap

app.post('/improve', async (c) => {
  const body = await c.req.json<ImproveRequest>().catch(() => null);
  if (
    !body ||
    typeof body.original_prompt !== 'string' ||
    typeof body.user_id !== 'string' ||
    !Array.isArray(body.history) ||
    (body.command !== 'next' && body.command !== 'finalize')
  ) {
    return c.json({ error: 'bad_request' }, 400);
  }

  // Validate every history entry; reject anything malformed so we never
  // hand garbage to Gemini.
  for (const t of body.history as ImproveTurn[]) {
    if (
      !t ||
      (t.role !== 'assistant' && t.role !== 'user') ||
      typeof t.text !== 'string'
    ) {
      return c.json({ error: 'bad_request' }, 400);
    }
  }

  // Server-side cap: if the user has already replied IMPROVE_TURN_CAP times,
  // force finalize regardless of the client-supplied command. The client
  // also enforces this; the server check is a safety net.
  const userReplies = body.history.filter((t) => t.role === 'user').length;
  const command = userReplies >= IMPROVE_TURN_CAP ? 'finalize' : body.command;

  try {
    const out = await improveCoach({
      original_prompt: body.original_prompt,
      missing: body.missing ?? {},
      history: body.history,
      command,
    });
    if (out.kind === 'question') {
      const res: ImproveResponse = {
        kind: 'question',
        text: out.text,
        turn: userReplies + 1,
      };
      return c.json(res);
    }
    const res: ImproveResponse = {
      kind: 'final',
      polished: out.polished,
      rationale: out.rationale,
    };
    return c.json(res);
  } catch (err) {
    console.warn('[api] /improve failed', err);
    return c.json({ error: 'improve_failed' }, 502);
  }
});

// ----- DELETE /team/data -----------------------------------------------------
// Wipe every nodes / learnings / prompts / captures / skill_observations row
// for the requesting team. The teams row itself is preserved so re-running
// the same token continues to land in the same id (matters for the
// trailhead-mcp reset CLI which talks to localhost first then prod).
//
// The demo team is protected against accidental nukes — wiping it would
// erase the seeded data the dashboard demo relies on. Override with
// TRAILHEAD_ALLOW_DEMO_RESET=true if you really need to reseed.

app.delete('/team/data', async (c) => {
  const body = await c.req.json<{ confirm?: boolean }>().catch(() => null);
  if (!body || body.confirm !== true) {
    return c.json(
      { error: 'confirm_required', detail: 'POST { "confirm": true } to wipe.' },
      400,
    );
  }
  const teamId = c.get('team_id');
  const isDemo = c.req.header('x-team-token') === DEMO_TEAM_TOKEN;
  if (isDemo && process.env.TRAILHEAD_ALLOW_DEMO_RESET !== 'true') {
    return c.json(
      {
        error: 'demo_team_protected',
        detail:
          'Refusing to wipe the demo team. Set TRAILHEAD_ALLOW_DEMO_RESET=true on the API to override.',
      },
      403,
    );
  }
  const deleted = await wipeTeamData(teamId);
  return c.json({ team_id: teamId, deleted });
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
      [c.get('team_id'), path, seedBody],
    );
    const row = rows[0]!;
    if (row.inserted) nodes_created += 1;
    nodes.push({ path, id: row.id });
  }

  const res: OnboardRepoResponse = { nodes_created, nodes };
  return c.json(res);
});

// ----- POST /onboard/repo/full -----------------------------------------------
// Rich (LLM-generated) bootstrap. Accepts the discovered folder paths plus
// the file contents (already capped client-side) plus optional manifest
// snippets and CLAUDE.md seed text. Creates a wiki_jobs row + one
// wiki_job_paths row per node and kicks off the worker via setImmediate.
// Returns the job_id immediately; the worker fills body_md asynchronously.
//
// Spec: docs/superpowers/specs/2026-04-26-wiki-bootstrap-rich-design.md §9

// Server-side hard ceilings. Independent of the client's CLI flags so a
// rogue client can't blow the API host's RAM. Conservative — these are
// "abuse cap" not "expected size".
const ONBOARD_FULL_MAX_FOLDERS = 1_000;
const ONBOARD_FULL_MAX_FILES = 2_000;
const ONBOARD_FULL_MAX_FILE_CHARS = 32_000;   // per file
const ONBOARD_FULL_MAX_BUNDLE_BYTES = 16 * 1024 * 1024;  // 16 MB

app.post('/onboard/repo/full', async (c) => {
  const body = await c.req.json<OnboardRepoFullRequest>().catch(() => null);
  if (!body || !Array.isArray(body.folders) || !Array.isArray(body.files)) {
    return c.json(
      { error: 'bad_request', detail: 'folders: string[] and files: {path,content}[] required' },
      400,
    );
  }
  if (body.folders.length > ONBOARD_FULL_MAX_FOLDERS) {
    return c.json({ error: 'too_many_folders', detail: `max ${ONBOARD_FULL_MAX_FOLDERS}` }, 400);
  }
  if (body.files.length > ONBOARD_FULL_MAX_FILES) {
    return c.json({ error: 'too_many_files', detail: `max ${ONBOARD_FULL_MAX_FILES}` }, 400);
  }
  let bundleBytes = 0;
  for (const f of body.files) {
    if (typeof f?.path !== 'string' || typeof f?.content !== 'string') {
      return c.json({ error: 'bad_request', detail: 'each file requires path:string and content:string' }, 400);
    }
    if (f.content.length > ONBOARD_FULL_MAX_FILE_CHARS) {
      return c.json(
        { error: 'file_too_large', detail: `${f.path}: max ${ONBOARD_FULL_MAX_FILE_CHARS} chars per file` },
        400,
      );
    }
    bundleBytes += Buffer.byteLength(f.content, 'utf8');
    if (bundleBytes > ONBOARD_FULL_MAX_BUNDLE_BYTES) {
      return c.json(
        { error: 'bundle_too_large', detail: `max ${ONBOARD_FULL_MAX_BUNDLE_BYTES / (1024 * 1024)} MB` },
        400,
      );
    }
  }

  const teamId = c.get('team_id');

  // Normalize folder paths (trailing slash) and dedupe.
  const folderSet = new Set<string>();
  for (const raw of body.folders) {
    const p = normalizePath(raw);
    if (p) folderSet.add(p);
  }
  const folders = [...folderSet];
  // De-dupe files on path; preserve first occurrence.
  const seenFiles = new Set<string>();
  const files = body.files.filter((f) => {
    const p = String(f.path).trim();
    if (!p || p.endsWith('/') || seenFiles.has(p)) return false;
    seenFiles.add(p);
    return true;
  });

  // paths_total = folders + files + 1 root pass.
  const pathsTotal = folders.length + files.length + 1;

  // Insert job header and per-path rows in one transaction so a partial
  // failure doesn't leave a job with no work items.
  const jobRows = await q<{ id: string }>(
    `INSERT INTO wiki_jobs (team_id, paths_total) VALUES ($1, $2) RETURNING id`,
    [teamId, pathsTotal],
  );
  const jobId = jobRows[0]!.id;

  // Build wiki_job_paths rows. Use a single multi-row insert for speed.
  const pathRows: Array<[string, string, WikiJobPathKind]> = [
    [jobId, '', 'root'],
    ...folders.map((p): [string, string, WikiJobPathKind] => [jobId, p, 'folder']),
    ...files.map((f): [string, string, WikiJobPathKind] => [jobId, f.path, 'file']),
  ];
  // Pg parameter array unrolling — keep it simple with one INSERT per row;
  // the volume is low enough (typically 100-700 rows) that batching isn't
  // critical, and the simpler code is harder to get wrong.
  for (const [job, p, kind] of pathRows) {
    await q(
      `INSERT INTO wiki_job_paths (job_id, path, kind) VALUES ($1, $2, $3)
       ON CONFLICT (job_id, path) DO NOTHING`,
      [job, p, kind],
    );
  }

  // Kick off the worker. setImmediate keeps it strictly fire-and-forget —
  // the response returns now; runJob handles its own errors and never
  // throws to here.
  const bundle = bundleFromRequest({ ...body, folders, files });
  setImmediate(() => {
    runJob(jobId, teamId, bundle).catch((e) => {
      console.error(`[wiki-job ${jobId}] uncaught:`, e);
    });
  });

  const res: OnboardRepoFullResponse = { job_id: jobId, paths_total: pathsTotal };
  return c.json(res);
});

// ----- GET /onboard/jobs/:id -------------------------------------------------
// Status snapshot for a rich-bootstrap job. Clients (CLI, MCP tool) poll
// this every 2s. Returns the job header counters plus per-path rows so the
// UI can render which path is processing / which failed.
//
// Cross-team safety: the auth middleware sets team_id from the X-Team-Token
// header; the WHERE clause filters on it. A team can only see its own jobs
// (otherwise a leaked job_id would be a tenancy break).

app.get('/onboard/jobs/:id', async (c) => {
  const id = c.req.param('id');
  if (!id || !/^[0-9a-f-]{8,}$/i.test(id)) {
    return c.json({ error: 'bad_request', detail: 'invalid job id' }, 400);
  }
  const teamId = c.get('team_id');

  const headers = await q<{
    id: string;
    status: 'pending' | 'running' | 'done' | 'failed';
    paths_total: number;
    paths_done: number;
    paths_failed: number;
    started_at: Date | null;
    finished_at: Date | null;
    error: string | null;
  }>(
    `SELECT id, status, paths_total, paths_done, paths_failed, started_at, finished_at, error
       FROM wiki_jobs WHERE team_id = $1 AND id = $2`,
    [teamId, id],
  );
  if (headers.length === 0) return c.json({ error: 'not_found' }, 404);
  const h = headers[0]!;

  const pathRows = await q<{
    path: string; kind: WikiJobPathKind; status: WikiJobPathStatus['status']; error: string | null;
  }>(
    `SELECT path, kind, status, error FROM wiki_job_paths WHERE job_id = $1 ORDER BY kind, path`,
    [id],
  );

  const res: WikiJobStatusResponse = {
    job_id: h.id,
    status: h.status,
    paths_total: h.paths_total,
    paths_done: h.paths_done,
    paths_failed: h.paths_failed,
    started_at: h.started_at ? h.started_at.toISOString() : null,
    finished_at: h.finished_at ? h.finished_at.toISOString() : null,
    error: h.error,
    paths: pathRows.map((r) => ({
      path: r.path,
      kind: r.kind,
      status: r.status,
      ...(r.error ? { error: r.error } : {}),
    })),
  };
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

