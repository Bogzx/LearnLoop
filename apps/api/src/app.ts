// The Hono app: middleware, the GET / catalog and the route modules (routes/),
// no listener. Imported by index.ts (which serves it) and by the integration
// tests (which call app.request() directly against a real Postgres). Importing
// this module opens the pg pool and requires DATABASE_URL and GEMINI_API_KEY.
import './env.ts';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { DEMO_TEAM_SECRET_HASH, DEMO_TEAM_TOKEN, isSecretTeamId, q, resolveTeam } from './db.ts';
import type { LimitName } from './rate-limit.ts';
import { randomUUID } from 'node:crypto';
import { langfuse, withTrace } from './langfuse.ts';
import { authPolicy, clientIp, opaqueTeamId, rateLimit, teamIdFromHeader, type AppEnv } from './http.ts';
import { scoreRoutes } from './routes/score.ts';
import { coachRoutes } from './routes/coach.ts';
import { wikiRoutes } from './routes/wiki.ts';
import { promptRoutes } from './routes/prompts.ts';
import { assistRoutes } from './routes/assist.ts';
import { metricsRoutes } from './routes/metrics.ts';
import { teamRoutes } from './routes/teams.ts';
import { onboardRoutes } from './routes/onboard.ts';

export const app = new Hono<AppEnv>();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'X-Team-Token', 'X-Admin-Token'],
    exposeHeaders: ['Deprecation', 'X-Trailhead-Warning', 'X-Request-Id', 'Retry-After'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  }),
);

// Request body caps, enforced while reading (Content-Length or streamed), so
// an oversized body is rejected before it is buffered and JSON-parsed. The
// per-field caps in the handlers (prompt length, bundle size…) still apply;
// these just bound memory. /onboard/repo/full carries a source bundle capped
// at 16 MB of file content, so it gets room for that plus JSON overhead.
// 2 MB: /improve can legitimately carry ~10 turns of up to 64K chars each.
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_BOOTSTRAP_BODY_BYTES = 24 * 1024 * 1024;
const tooLarge = (max: number) => (c: Context<AppEnv>) =>
  c.json({ error: 'payload_too_large', detail: `request body over ${max / (1024 * 1024)} MB` }, 413);
const defaultBodyLimit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge(MAX_BODY_BYTES) });
const bootstrapBodyLimit = bodyLimit({ maxSize: MAX_BOOTSTRAP_BODY_BYTES, onError: tooLarge(MAX_BOOTSTRAP_BODY_BYTES) });
app.use('*', (c, next) =>
  (c.req.path === '/onboard/repo/full' ? bootstrapBodyLimit : defaultBodyLimit)(c, next),
);

// Langfuse: one trace per HTTP request, stored in AsyncLocalStorage so
// gemini.ts can hang generations off it without us having to thread the
// trace handle through every function signature.
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || !langfuse) return next();
  const trace = langfuse.trace({
    name: `${c.req.method} ${c.req.path}`,
    // The team token is the tenant's only credential, so it never leaves this
    // process: traces carry the same non-replayable digest GET /teams returns.
    metadata: {
      team_id: teamIdFromHeader(c.req.header('x-team-token')),
      user_agent: c.req.header('user-agent') ?? null,
    },
  });
  await withTrace(trace, async () => {
    await next();
    trace.update({ output: { status: c.res.status } });
  });
});

// Auth middleware — multi-tenant. Resolves the X-Team-Token credential to a
// team (see resolveTeam in db.ts and the model in team-auth.ts) and attaches
// the team id to the request context.
//
// Unauthenticated: GET / (reachability probe) and POST /teams (registration,
// optionally gated by TRAILHEAD_ADMIN_TOKEN inside the handler).
const legacyWarned = new Set<string>();

app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || c.req.path === '/') return next();
  if (c.req.method === 'POST' && c.req.path === '/teams') return next();
  // /teams used to be exempt here so the popup could populate a Select-team
  // dropdown before any token was configured. That exemption published every
  // tenant's credential to the open internet. Clients now resolve their own
  // team by sending the token they already hold; GET / remains the
  // unauthenticated reachability probe.
  const token = c.req.header('x-team-token');
  if (!token) return c.json({ error: 'unauthorized', detail: 'missing X-Team-Token' }, 401);
  const policy = authPolicy();
  // GET /teams is how clients probe a credential ("is this token valid, and
  // is it legacy?"). A probe must not create a team, so auto-create is off
  // for it.
  const isProbe = c.req.method === 'GET' && c.req.path === '/teams';
  const team = await resolveTeam(token, { ...policy, autoCreate: policy.autoCreate && !isProbe });
  if (!team) {
    if (await isSecretTeamId(token)) {
      return c.json(
        {
          error: 'unauthorized',
          reason: 'team_id_not_secret',
          detail:
            'This is a team id, not its secret: the team authenticates with a server-minted secret ' +
            '(if this was an old repo_… token, a teammate has upgraded the team). Ask a teammate ' +
            'for the secret (their ./.trailhead-team) and run `init --team-token <secret>`.',
        },
        401,
      );
    }
    return c.json(
      { error: 'unauthorized', detail: 'unknown team token' },
      401,
    );
  }
  c.set('team_token', team.teamId);
  c.set('legacy_auth', team.legacy);
  if (team.legacy) {
    // Deprecated path: tell the client on every response, and the operator
    // once per team per process.
    c.header('Deprecation', 'true');
    c.header(
      'X-Trailhead-Warning',
      'legacy team token; run `init --upgrade-legacy` or POST /teams/rotate-secret to switch to a team secret',
    );
    if (!legacyWarned.has(team.teamId)) {
      legacyWarned.add(team.teamId);
      console.warn(
        `[auth] team ${opaqueTeamId(team.teamId)} authenticated with a legacy token — deprecated; ` +
          'it stops working when the team gets a secret or TRAILHEAD_ACCEPT_LEGACY_TOKENS=false',
      );
    }
  }
  await next();
});

// Rate limits for the routes that spend Gemini quota, checked after auth so
// the per-team bucket is keyed on the resolved team id (never the secret).
const LLM_ROUTES = new Set(['POST /score', 'POST /coach', 'POST /improve', 'POST /diff', 'POST /onboard/repo/full']);
app.use('*', async (c, next) => {
  const route = `${c.req.method} ${c.req.path}`;
  if (!LLM_ROUTES.has(route)) return next();
  const checks: Array<[LimitName, string]> = [
    ['llm_per_ip', clientIp(c)],
    ['llm_per_team', c.get('team_token')],
  ];
  if (route === 'POST /onboard/repo/full') checks.push(['bootstrap_per_team', c.get('team_token')]);
  const limited = rateLimit(c, checks);
  if (limited) return limited;
  await next();
});

app.get('/', (c) =>
  c.json({
    name: 'trailhead-api',
    status: 'ok',
    multi_tenant: true,
    auto_create_teams: authPolicy().autoCreate,
    accept_legacy_tokens: authPolicy().acceptLegacy,
    open_registration: authPolicy().adminToken === null,
    endpoints: [
      'POST /teams (register: returns the team secret once)',
      'POST /teams/rotate-secret',
      'POST /score',
      'POST /coach',
      'POST /capture',
      'POST /wiki/propose',
      'GET  /context?path=',
      'GET  /examples?path=',
      'GET  /prompts/proven?min_score=&path=&topic=&limit=',
      'GET  /search?q=&scope=',
      'GET  /prompts/pending (TRAILHEAD_PROMOTION_MODE=review)',
      'POST /prompts/:id/review',
      'GET  /wiki/recent?since=ISO',
      'POST /diff',
      'POST /improve',
      'GET  /teams (your team only; never returns tokens)',
      'GET  /skill-arc?user_id=&since=ISO',
      'GET  /team/metrics',
      'GET  /wiki/tree',
      'GET  /wiki/export?drafts=&format=',
      'POST /onboard/repo',
      'POST /onboard/repo/full',
      'GET  /onboard/jobs/:id',
      'DELETE /team/data',
    ],
  }),
);


// Routes, one module per area (src/routes/). Mounted after the middleware above,
// so every route gets auth, body caps, tracing and rate limits.
app.route('/', scoreRoutes);
app.route('/', coachRoutes);
app.route('/', wikiRoutes);
app.route('/', promptRoutes);
app.route('/', assistRoutes);
app.route('/', metricsRoutes);
app.route('/', teamRoutes);
app.route('/', onboardRoutes);

// Surface unhandled errors as 500 with a one-line shape clients can show.
// Unhandled errors → 500 with a short request id that also appears in the
// server log, so a report can be matched to its stack trace. The error
// message itself is NOT returned by default: it can carry Postgres internals
// or a whole upstream Gemini error body. Set TRAILHEAD_EXPOSE_ERRORS=true
// (local debugging) to include it as `detail` again.
app.onError((err, c) => {
  const requestId = randomUUID().slice(0, 8);
  console.error(`[trailhead-api] ${requestId} ${c.req.method} ${c.req.path}`, err);
  c.header('X-Request-Id', requestId);
  const body: { error: string; request_id: string; detail?: string } = {
    error: 'internal_error',
    request_id: requestId,
  };
  if (process.env.TRAILHEAD_EXPOSE_ERRORS === 'true') {
    body.detail = String((err as { message?: string }).message ?? err);
  }
  return c.json(body, 500);
});

// Lightweight startup migration. The full schema is applied via
// packages/db/migrate.mjs; this just guarantees columns introduced in
// recent commits exist before /coach reads or writes them, so a Railway
// auto-deploy doesn't 500 in the gap between the new image landing and
// the operator running migrate.mjs. Idempotent — every statement uses
// IF NOT EXISTS or is a no-op when the column already exists.
//
// Keep this list short. Anything beyond column adds belongs in
// schema.sql and should be applied via migrate.mjs.
export async function ensureRecentMigrations(): Promise<void> {
  await q(`ALTER TABLE prompts ADD COLUMN IF NOT EXISTS author_user_id TEXT`);
  // 2026-09-30 team secrets (packages/db/migrations/2026-09-30-team-secrets.sql).
  // Without the column every authenticated request 500s, so it is added here
  // as well as in schema.sql.
  await q(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS secret_hash TEXT`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS teams_secret_hash_key ON teams(secret_hash)`);
  await q(
    `UPDATE teams SET secret_hash = $2 WHERE token = $1 AND secret_hash IS NULL`,
    [DEMO_TEAM_TOKEN, DEMO_TEAM_SECRET_HASH],
  );
}
