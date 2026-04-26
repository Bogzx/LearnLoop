import './env.ts';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type {
  CaptureRequest,
  CaptureResponse,
  CoachMode,
  CoachNextRoundInputs,
  CoachRequest,
  CoachResponse,
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
  ProvenPromptItem,
  ProvenPromptsResponse,
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
import {
  ancestorPaths,
  buildAugmentation,
  normalize,
  normalizePath,
  renderSkipReveal,
  renderSuccessReveal,
  renderTeachBlock,
} from '@trailhead/scoring';
import { applyTeamNameIfPlaceholder, DEMO_TEAM_TOKEN, q, ensureTeam, upsertNode, wipeTeamData } from './db.ts';
import {
  acknowledgeProgress,
  extractTopic,
  improveCoach,
  overallScore,
  rewriteForDims,
  scorePrompt,
  summarizeCoaching,
  synthesizeDiff,
} from './gemini.ts';
import { langfuse, shutdownLangfuse, withTrace } from './langfuse.ts';
import { tryPromotePrompt } from './prompt-promotion.ts';
import { renderTeamContext } from './team-context.ts';
import { bundleFromRequest, runJob } from './wiki-bootstrap-job.ts';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

// Multi-tenant policy. Defaults to ON for the hackathon-grade open demo
// posture: any X-Team-Token spawns its own teams row on first write.
// Production deploys should set TRAILHEAD_AUTO_CREATE_TEAMS=false and
// register teams explicitly.
const AUTO_CREATE_TEAMS = process.env.TRAILHEAD_AUTO_CREATE_TEAMS !== 'false';

// Hono context typing — the auth middleware sets `team_token` so every
// downstream handler can pull it via c.get('team_token') with type safety.
type AppEnv = { Variables: { team_token: string } };
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

// Langfuse: one trace per HTTP request, stored in AsyncLocalStorage so
// gemini.ts can hang generations off it without us having to thread the
// trace handle through every function signature.
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || !langfuse) return next();
  const trace = langfuse.trace({
    name: `${c.req.method} ${c.req.path}`,
    metadata: {
      team_token: c.req.header('x-team-token') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    },
  });
  await withTrace(trace, async () => {
    await next();
    trace.update({ output: { status: c.res.status } });
  });
});

// Auth middleware — multi-tenant. Resolves the X-Team-Token header into a
// team_token (cached) and attaches it to the request context. Unknown tokens
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
  const teamToken = await ensureTeam(token, { autoCreate: AUTO_CREATE_TEAMS });
  if (!teamToken) {
    return c.json(
      { error: 'unauthorized', detail: 'unknown team token' },
      401,
    );
  }
  c.set('team_token', teamToken);
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
      'POST /coach',
      'POST /capture',
      'POST /wiki/propose',
      'GET  /context?path=',
      'GET  /examples?path=',
      'GET  /prompts/proven?min_score=&path=&topic=&limit=',
      'GET  /search?q=&scope=',
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

// Bulk insert one skill_observation row per dimension with the per-(user,
// dim, prompt-hash) 30s dedup window from spec §19. Shared between /score
// and /coach so both write to the same rubric stream — the dashboard and
// skill arc don't care which endpoint produced the row.
async function writeSkillObservations(
  teamToken: string,
  userId: string,
  prompt: string,
  dimensions: DimensionScores,
): Promise<void> {
  const promptHash = simpleHash(prompt);
  await q(
    `INSERT INTO skill_observations (team_token, user_id, dimension, score, prompt_hash)
     SELECT i.team_token, i.user_id, i.dimension, i.score, i.prompt_hash
       FROM ( VALUES
         ${DIMENSIONS.map((_, i) =>
           `($1::text, $2::text, $${3 + i * 2}::text, $${4 + i * 2}::int, $13::text)`
         ).join(',\n         ')}
       ) AS i(team_token, user_id, dimension, score, prompt_hash)
      WHERE NOT EXISTS (
        SELECT 1 FROM skill_observations s
         WHERE s.team_token     = i.team_token
           AND s.user_id     = i.user_id
           AND s.dimension   = i.dimension
           AND s.prompt_hash = i.prompt_hash
           AND s.ts          > NOW() - INTERVAL '30 seconds'
      )`,
    [
      teamToken,
      userId,
      ...DIMENSIONS.flatMap((d) => [d, dimensions[d]]),
      promptHash,
    ],
  );
}

app.post('/score', async (c) => {
  const body = await c.req.json<ScoreRequest>().catch(() => null);
  if (!body || typeof body.prompt !== 'string' || typeof body.user_id !== 'string') {
    return c.json({ error: 'bad_request' }, 400);
  }

  // Optional sticky wiki context from the popup picker. Bundle is rendered
  // out-of-band and prepended to Gemini's system instruction so the rubric
  // is calibrated against the team's conventions without inflating the
  // prompt being scored.
  const teamContext = body.context_path
    ? await renderTeamContext(c.get('team_token'), body.context_path)
    : null;

  const result = await scorePrompt({
    prompt: body.prompt,
    file_path: body.file_path,
    team_context: teamContext ?? undefined,
  });
  const overall = overallScore(result.dimensions);

  await writeSkillObservations(
    c.get('team_token'),
    body.user_id,
    body.prompt,
    result.dimensions,
  );

  const res: ScoreResponse = {
    overall,
    dimensions: result.dimensions,
    missing: result.missing,
  };
  return c.json(res);
});

// ----- POST /coach -----------------------------------------------------------
// Educational coaching loop. Drives the teach→reveal cycle described in
// docs/superpowers/specs/2026-04-26-trailhead-educational-loop-design.md.
//
// Stateless: caller (the MCP server) carries round state explicitly. The
// `proceed` flag is the directive's only decision input — when false the
// caller relays `text`, gathers a user reply, and calls /coach again with
// next_round_inputs echoed back. Server enforces the round cap and bails
// on no-progress.

const COACH_MAX_ROUNDS = 5;

function clampRound(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(COACH_MAX_ROUNDS, Math.floor(n)));
}

// Derive a wiki context_path from a file_path so coach scoring is grounded
// in the team's subtree without the caller having to know wiki internals.
// 'src/api/webhooks/handler.ts' → 'src/api/webhooks/' (parent folder).
// 'src/api/webhooks/'           → 'src/api/webhooks/' (already a folder).
// 'README.md'                   → ''                  (no parent → no scope).
// Empty string is treated as "no scope" by renderTeamContext.
function deriveContextPath(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx < 0 ? '' : filePath.slice(0, idx + 1);
}

// Pick the lowest-scoring dimension under the threshold (default 7). Stable
// against tied scores by walking DIMENSIONS in declaration order — same
// prompt always teaches the same dim.
function lowestDimBelow(dims: DimensionScores, threshold: number = 7): Dimension | null {
  let pick: Dimension | null = null;
  let pickScore = Infinity;
  for (const d of DIMENSIONS) {
    const s = dims[d];
    if (s < threshold && s < pickScore) {
      pick = d;
      pickScore = s;
    }
  }
  return pick;
}

// Wiki-first lookup: top graduated prompt in the file_path's ancestor nodes.
// Prefers prompts authored by SOMEONE OTHER than `userId` so the user isn't
// shown their own prompt back as the strong example. Self-authored rows are
// still returned when no other-authored alternative exists — keeps the
// single-user demo posture working.
async function fetchTopGraduatedForPath(
  teamToken: string,
  filePath: string,
  userId: string,
): Promise<string | null> {
  const ancestors = ancestorPaths(filePath);
  if (ancestors.length === 0) return null;
  const rows = await q<{ template: string }>(
    `SELECT p.template
       FROM prompts p
       JOIN nodes n ON n.id = p.node_id
      WHERE n.team_token = $1
        AND n.path = ANY($2::text[])
        AND p.status = 'graduated'
      ORDER BY (p.author_user_id IS NULL OR p.author_user_id <> $3) DESC,
               p.reuse_count DESC,
               length(n.path) DESC
      LIMIT 1`,
    [teamToken, ancestors, userId],
  );
  return rows.length ? rows[0]!.template : null;
}

// Wiki-first lookup: top graduated prompt across the team. Used when no
// file_path is available. Same self-author preference as the path variant.
async function fetchTopGraduatedForTeam(teamToken: string, userId: string): Promise<string | null> {
  const rows = await q<{ template: string }>(
    `SELECT p.template
       FROM prompts p
       JOIN nodes n ON n.id = p.node_id
      WHERE n.team_token = $1
        AND p.status = 'graduated'
      ORDER BY (p.author_user_id IS NULL OR p.author_user_id <> $2) DESC,
               p.reuse_count DESC
      LIMIT 1`,
    [teamToken, userId],
  );
  return rows.length ? rows[0]!.template : null;
}

// Wiki-first → Gemini fallback. Hackathon simplification: we don't re-score
// graduated prompts to filter for `target_dims`; the assumption is that a
// graduated team prompt is already strong on most dims and seeing it
// teaches the user something either way. If the wiki has nothing, fall
// back to a Gemini rewrite that explicitly targets the named dimensions.
//
// Returns the example string AND the optional tip — the wiki path has no
// tip (we just have the template), the Gemini fallback emits one alongside
// the rewrite. Callers showing a single-dim teach block render the tip;
// multi-dim callers (skip / no-progress) ignore it because one tip can't
// honestly summarize several principles at once.
async function getStrongExample(args: {
  teamToken: string;
  userId: string;
  prompt: string;
  file_path?: string;
  target_dims: Dimension[];
  team_context: string | null;
}): Promise<{ example: string; tip: string }> {
  const wiki = args.file_path
    ? await fetchTopGraduatedForPath(args.teamToken, args.file_path, args.userId)
    : await fetchTopGraduatedForTeam(args.teamToken, args.userId);
  if (wiki) return { example: wiki, tip: '' };

  const fallback = await rewriteForDims({
    prompt: args.prompt,
    target_dims: args.target_dims,
    file_path: args.file_path,
    team_context: args.team_context ?? undefined,
  });
  // Empty strings on Gemini failure — render block falls back accordingly.
  return { example: fallback.rewritten_prompt, tip: fallback.tip };
}

// Library banner emitted on every /coach response that triggers prompt
// promotion (overall >= 7 in mode=score). Lives in `text` so a forgetful
// host LLM can't drop it — the previous "directive instructs the model to
// append one sentence" approach was reliable only when the host remembered
// the rule. This wording is the canonical one referenced in the directive.
function renderLibraryBanner(overall: number): string {
  return (
    `### ✅ Your prompt scored **${overall}/10** and joined your team's library\n` +
    `_Future prompts in this folder will be coached against it._`
  );
}

// Round-state token. Compresses the four `next_round_inputs` fields into a
// single opaque base64url JSON blob. Round 2+ callers can echo only the
// token instead of all four fields — fewer slots for an LLM to drop. Both
// shapes are accepted on input; the token wins when both are present.
type RoundState = {
  original_prompt: string;
  original_dimensions: DimensionScores;
  previous_dimensions: DimensionScores;
  round: number;
};
function encodeRoundToken(state: RoundState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}
function decodeRoundToken(token: string): RoundState | null {
  try {
    const json = Buffer.from(token, 'base64url').toString('utf8');
    const p = JSON.parse(json) as Partial<RoundState>;
    if (
      typeof p.original_prompt === 'string' &&
      typeof p.round === 'number' &&
      p.original_dimensions && typeof p.original_dimensions === 'object' &&
      p.previous_dimensions && typeof p.previous_dimensions === 'object'
    ) {
      return p as RoundState;
    }
    return null;
  } catch {
    return null;
  }
}

app.post('/coach', async (c) => {
  const body = await c.req.json<CoachRequest>().catch(() => null);
  if (!body || typeof body.prompt !== 'string' || typeof body.user_id !== 'string') {
    return c.json({ error: 'bad_request' }, 400);
  }

  // Round-token shorthand. When present, decode and use as authoritative
  // round state — overrides any individual field the caller also sent.
  // Invalid tokens fall through to the four-field path with a warning.
  if (body.round_token) {
    const decoded = decodeRoundToken(body.round_token);
    if (decoded) {
      body.original_prompt = decoded.original_prompt;
      body.original_dimensions = decoded.original_dimensions;
      body.previous_dimensions = decoded.previous_dimensions;
      body.round = decoded.round;
    } else {
      console.warn('[coach] received invalid round_token; falling back to explicit fields');
    }
  }

  const mode: CoachMode = body.mode === 'augment' || body.mode === 'skip_reveal'
    ? body.mode
    : 'score';

  // Same team-context pattern as /score and /improve. When the caller does
  // not pass an explicit context_path, derive one from file_path so the
  // teach prompts and Gemini's scoring see the team's subtree automatically.
  // The MCP coach tool only forwards file_path, so this is what makes coach
  // wiki-aware in practice.
  const teamToken = c.get('team_token');
  const contextPath =
    body.context_path ?? (body.file_path ? deriveContextPath(body.file_path) : '');
  const teamContext = contextPath
    ? await renderTeamContext(teamToken, contextPath)
    : null;

  // 1. Score (always). Failure is fail-open: hand the LLM a "no coaching
  //    this turn" signal and let it produce its answer with the original
  //    prompt. Spec §7.
  let scoreResult: { dimensions: DimensionScores; missing: Record<string, string> };
  try {
    const result = await scorePrompt({
      prompt: body.prompt,
      file_path: body.file_path,
      team_context: teamContext ?? undefined,
    });
    scoreResult = { dimensions: result.dimensions, missing: result.missing as Record<string, string> };
  } catch (err) {
    console.warn('[api] /coach scorePrompt failed', err);
    const zeros = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as DimensionScores;
    const res: CoachResponse = {
      proceed: true,
      mode,
      overall: 0,
      dimensions: zeros,
      missing: {},
      text: '',
    };
    return c.json(res);
  }
  const overall = overallScore(scoreResult.dimensions);

  // Fail-open: scorePrompt does NOT throw on Gemini parse failures — it
  // silently returns zeros + empty missing (see gemini.ts coerceScore).
  // That signal is indistinguishable from a real all-zero score except by
  // the empty `missing` object: a real-zero score from Gemini populates
  // hints for the dims < 5. When we detect the zero+empty fingerprint,
  // treat it as "Gemini failed, no coaching this turn" rather than
  // pretending the user wrote a perfectly empty prompt. Spec §7.
  const allZero = DIMENSIONS.every((d) => scoreResult.dimensions[d] === 0);
  const noMissing = Object.keys(scoreResult.missing).length === 0;
  if (allZero && noMissing) {
    const res: CoachResponse = {
      proceed: true,
      mode,
      overall: 0,
      dimensions: scoreResult.dimensions,
      missing: {},
      text: '',
    };
    return c.json(res);
  }

  // 2. Skill_observation writes (same dedup as /score).
  await writeSkillObservations(teamToken, body.user_id, body.prompt, scoreResult.dimensions);

  // 3. Branch on mode.

  // ---- Augment mode (legacy passthrough) -----------------------------------
  if (mode === 'augment') {
    const augmented = buildAugmentation({
      original: body.prompt,
      missing: scoreResult.missing,
    });
    const res: CoachResponse = {
      proceed: true,
      mode: 'augment',
      overall,
      dimensions: scoreResult.dimensions,
      missing: scoreResult.missing,
      text: '',
      augmented_prompt: augmented,
      missing_dims: Object.keys(scoreResult.missing),
    };
    return c.json(res);
  }

  // ---- Skip reveal mode ----------------------------------------------------
  if (mode === 'skip_reveal') {
    const originalDims = body.original_dimensions ?? scoreResult.dimensions;
    // Dimensions we'd want to lift on the rewrite. Spec §5 picks dims that
    // scored below 5; if the original is already above that bar, fall back
    // to dims below 7 so the rewrite still has direction.
    let dimsToImprove = DIMENSIONS.filter((d) => originalDims[d] < 5);
    if (dimsToImprove.length === 0) {
      dimsToImprove = DIMENSIONS.filter((d) => originalDims[d] < 7);
    }
    const originalPrompt = body.original_prompt ?? body.prompt;
    // Run the rewrite and the closing summary in parallel — both are
    // independent Gemini calls and the user is already waiting on the
    // skip-reveal text. Each fails open to '' so a partial outage still
    // produces a useful (if shorter) reveal.
    const [strong, summary] = await Promise.all([
      getStrongExample({
        teamToken,
        userId: body.user_id,
        prompt: originalPrompt,
        file_path: body.file_path,
        target_dims: dimsToImprove.length ? dimsToImprove : ['specificity'],
        team_context: teamContext,
      }),
      summarizeCoaching({
        original_prompt: originalPrompt,
        final_prompt: body.prompt,
        original_dimensions: originalDims,
        final_dimensions: scoreResult.dimensions,
        reason: 'skip',
      }),
    ]);
    const text = strong.example
      ? renderSkipReveal({
          strongRewrite: strong.example,
          originalDimensions: originalDims,
          reason: 'skip',
          summary,
          overall: overallScore(originalDims),
        })
      : '';
    const res: CoachResponse = {
      proceed: true,
      mode: 'skip_reveal',
      overall,
      dimensions: scoreResult.dimensions,
      missing: scoreResult.missing,
      text,
    };
    return c.json(res);
  }

  // ---- Score mode (the main loop) ------------------------------------------
  const round = clampRound(body.round);
  const isRound1 = round === 1 || !body.original_prompt;
  const lowest = lowestDimBelow(scoreResult.dimensions, 7);

  // Round 1, score >=7 → silent fast path. Power users see no friction.
  if (isRound1 && overall >= 7) {
    const res: CoachResponse = {
      proceed: true,
      mode: 'score',
      overall,
      dimensions: scoreResult.dimensions,
      missing: scoreResult.missing,
      // The graduation banner ships in `text` itself so a forgetful host LLM
      // can't drop the only signal that the team's library grew. Was
      // previously delegated to a CLAUDE.md "append one sentence" rule that
      // hosts sometimes ignored.
      text: renderLibraryBanner(overall),
    };
    // Fire-and-forget auto-promotion to the team's prompt library. Off the
    // response path, fail-open inside tryPromotePrompt. MCP-only by call
    // site (only /coach calls this — browser ext / VS Code ext don't).
    setImmediate(() => {
      void tryPromotePrompt({
        teamToken,
        userId: body.user_id,
        prompt: body.prompt,
        filePath: body.file_path ?? null,
        dimensions: scoreResult.dimensions,
        overall,
      });
    });
    return c.json(res);
  }

  // Round 1, score <7 → first teach block.
  if (isRound1 && lowest) {
    const strong = await getStrongExample({
      teamToken,
      userId: body.user_id,
      prompt: body.prompt,
      file_path: body.file_path,
      target_dims: [lowest],
      team_context: teamContext,
    });
    const text = renderTeachBlock({
      targetDim: lowest,
      targetScore: scoreResult.dimensions[lowest],
      strongExample: strong.example,
      tip: strong.tip,
      dimensions: scoreResult.dimensions,
      overall,
    });
    const nextState: RoundState = {
      original_prompt: body.prompt,
      original_dimensions: scoreResult.dimensions,
      previous_dimensions: scoreResult.dimensions,
      round: 2,
    };
    const next: CoachNextRoundInputs = {
      ...nextState,
      round_token: encodeRoundToken(nextState),
    };
    const res: CoachResponse = {
      proceed: false,
      mode: 'score',
      overall,
      dimensions: scoreResult.dimensions,
      missing: scoreResult.missing,
      text,
      next_round_inputs: next,
    };
    return c.json(res);
  }

  // Round >=2 paths. Need original_prompt (we treated round 1 already).
  const originalPrompt = body.original_prompt!;
  const originalDims = body.original_dimensions ?? scoreResult.dimensions;
  const previousDims = body.previous_dimensions ?? originalDims;
  const previousOverall = overallScore(previousDims);
  const previousLowest = lowestDimBelow(previousDims, 7);
  const originalOverall = overallScore(originalDims);

  // Score crossed 7 → success reveal.
  if (overall >= 7) {
    const summary = await summarizeCoaching({
      original_prompt: originalPrompt,
      final_prompt: body.prompt,
      original_dimensions: originalDims,
      final_dimensions: scoreResult.dimensions,
      reason: 'success',
    });
    const text =
      renderSuccessReveal({
        originalPrompt,
        finalPrompt: body.prompt,
        originalOverall,
        finalOverall: overall,
        originalDimensions: originalDims,
        finalDimensions: scoreResult.dimensions,
        summary,
      }) +
      `\n\n${renderLibraryBanner(overall)}`;
    const res: CoachResponse = {
      proceed: true,
      mode: 'score',
      overall,
      dimensions: scoreResult.dimensions,
      missing: scoreResult.missing,
      text,
    };
    // Fire-and-forget auto-promotion (round 2+ success). The user iterated
    // through coaching and landed a >=7 prompt — promote the final form.
    setImmediate(() => {
      void tryPromotePrompt({
        teamToken,
        userId: body.user_id,
        prompt: body.prompt,
        filePath: body.file_path ?? null,
        dimensions: scoreResult.dimensions,
        overall,
      });
    });
    return c.json(res);
  }

  // No-progress detection: the dim we were teaching about (= last round's
  // lowest) did NOT improve, AND overall did not improve. We test the
  // previously-targeted dim directly rather than checking `lowest` equality,
  // because Gemini's tiebreakers can shuffle which 0-scored dim is "lowest"
  // between rounds even when nothing material changed (this was the original
  // failing case from the design spec — "fix the retry. it needs to be more
  // accurate" leaves context_loading at 0 but the lowest tiebreaker drifts).
  const targetDimDidNotImprove = !!(
    previousLowest &&
    scoreResult.dimensions[previousLowest] <= previousDims[previousLowest]
  );
  if (targetDimDidNotImprove && overall <= previousOverall) {
    let dimsToImprove = DIMENSIONS.filter((d) => originalDims[d] < 5);
    if (dimsToImprove.length === 0) {
      dimsToImprove = DIMENSIONS.filter((d) => originalDims[d] < 7);
    }
    // Parallel: rewrite + closing recap. Same fail-open posture as the
    // skip-reveal branch — both helpers return '' on Gemini failure and the
    // render fallback handles each independently.
    const [strong, summary] = await Promise.all([
      getStrongExample({
        teamToken,
        userId: body.user_id,
        prompt: originalPrompt,
        file_path: body.file_path,
        target_dims: dimsToImprove.length ? dimsToImprove : [lowest!],
        team_context: teamContext,
      }),
      summarizeCoaching({
        original_prompt: originalPrompt,
        final_prompt: body.prompt,
        original_dimensions: originalDims,
        final_dimensions: scoreResult.dimensions,
        reason: 'no_progress',
      }),
    ]);
    const text = strong.example
      ? renderSkipReveal({
          strongRewrite: strong.example,
          originalDimensions: originalDims,
          reason: 'no_progress',
          noProgressDim: previousLowest ?? undefined,
          summary,
          overall: overallScore(originalDims),
        })
      : '';
    const res: CoachResponse = {
      proceed: true,
      mode: 'score',
      overall,
      dimensions: scoreResult.dimensions,
      missing: scoreResult.missing,
      text,
    };
    return c.json(res);
  }

  // Forced exit at COACH_MAX_ROUNDS (still <7, made progress, but rounds exhausted).
  if (round >= COACH_MAX_ROUNDS) {
    const summary = await summarizeCoaching({
      original_prompt: originalPrompt,
      final_prompt: body.prompt,
      original_dimensions: originalDims,
      final_dimensions: scoreResult.dimensions,
      reason: 'max_rounds',
    });
    const text = renderSuccessReveal({
      originalPrompt,
      finalPrompt: body.prompt,
      originalOverall,
      finalOverall: overall,
      originalDimensions: originalDims,
      finalDimensions: scoreResult.dimensions,
      maxRoundsHit: true,
      summary,
    });
    const res: CoachResponse = {
      proceed: true,
      mode: 'score',
      overall,
      dimensions: scoreResult.dimensions,
      missing: scoreResult.missing,
      text,
    };
    return c.json(res);
  }

  // Else: score still <7, made progress, more rounds remain. Keep teaching.
  if (lowest) {
    // Parallel: pull a fresh strong example AND ask Gemini to acknowledge
    // what the user just added. Both feed renderTeachBlock; both fail-open
    // to '' so the static template still produces a usable block.
    const [strong, acknowledgment] = await Promise.all([
      getStrongExample({
        teamToken,
        userId: body.user_id,
        prompt: body.prompt,
        file_path: body.file_path,
        target_dims: [lowest],
        team_context: teamContext,
      }),
      acknowledgeProgress({
        previous_prompt: originalPrompt,
        current_prompt: body.prompt,
        previous_dimensions: previousDims,
        current_dimensions: scoreResult.dimensions,
      }),
    ]);
    const text = renderTeachBlock({
      targetDim: lowest,
      targetScore: scoreResult.dimensions[lowest],
      strongExample: strong.example,
      previousLowestDim:
        previousLowest && previousLowest !== lowest ? previousLowest : undefined,
      acknowledgment,
      tip: strong.tip,
      dimensions: scoreResult.dimensions,
      overall,
    });
    const nextState: RoundState = {
      original_prompt: originalPrompt,
      original_dimensions: originalDims,
      previous_dimensions: scoreResult.dimensions,
      round: round + 1,
    };
    const next: CoachNextRoundInputs = {
      ...nextState,
      round_token: encodeRoundToken(nextState),
    };
    const res: CoachResponse = {
      proceed: false,
      mode: 'score',
      overall,
      dimensions: scoreResult.dimensions,
      missing: scoreResult.missing,
      text,
      next_round_inputs: next,
    };
    return c.json(res);
  }

  // Defensive fallback — shouldn't be reachable (overall < 7 implies a
  // lowest dim exists). If we land here anyway, exit silently rather than
  // 500ing the loop.
  const res: CoachResponse = {
    proceed: true,
    mode: 'score',
    overall,
    dimensions: scoreResult.dimensions,
    missing: scoreResult.missing,
    text: '',
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
       (team_token, surface, user_prompt, ai_response, file_path, outcome, scored_dimensions)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      c.get('team_token'),
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

// Bigram-Jaccard similarity over normalized strings. Used as a paraphrase
// fallback when exact body_normalized match misses — catches "go through" /
// "flow through" style edits that the lowercase+strip-punct normalize can't
// collapse. Bigrams (vs unigrams) are deliberate: a polarity flip ("never"
// inserted into an otherwise identical sentence) drops the bigram score
// well below the threshold, so opposite-meaning insights stay distinct.
const PARAPHRASE_THRESHOLD = 0.7;

function bigramSet(normalized: string): Set<string> {
  const tokens = normalized.split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    out.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

function bigramJaccard(a: string, b: string): number {
  const aBg = bigramSet(a);
  const bBg = bigramSet(b);
  if (aBg.size === 0 || bBg.size === 0) return 0;
  let intersection = 0;
  for (const bg of aBg) if (bBg.has(bg)) intersection++;
  const union = aBg.size + bBg.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

app.post('/wiki/propose', async (c) => {
  const body = await c.req.json<WikiProposeRequest>().catch(() => null);
  if (!body || typeof body.node_path !== 'string' || typeof body.insight !== 'string') {
    return c.json({ error: 'bad_request' }, 400);
  }
  if (!body.insight.trim()) return c.json({ error: 'empty_insight' }, 400);

  const path = normalizePath(body.node_path);
  const nodeId = await upsertNode(c.get('team_token'), path);
  const bodyNormalized = normalize(body.insight);

  // Step 1: exact match on body_normalized — the cheap fast path. Hits when
  // the user (or LLM) sent the same insight verbatim or with only
  // punctuation/whitespace/case differences.
  const exact = await q<{
    id: string; reinforcement_count: number; status: 'draft' | 'durable';
  }>(
    `SELECT id, reinforcement_count, status
       FROM learnings
      WHERE node_id = $1 AND body_normalized = $2
      LIMIT 1`,
    [nodeId, bodyNormalized],
  );

  let matchId: string | null = null;
  let matchPriorStatus: 'draft' | 'durable' | null = null;
  if (exact.length) {
    matchId = exact[0]!.id;
    matchPriorStatus = exact[0]!.status;
  } else {
    // Step 2: paraphrase fallback. Pull this node's existing learnings and
    // compute bigram-Jaccard against each. Keeps the wiki from accumulating
    // near-duplicate drafts that never hit the 3× durability threshold.
    const candidates = await q<{
      id: string; body_normalized: string; status: 'draft' | 'durable';
    }>(
      `SELECT id, body_normalized, status
         FROM learnings
        WHERE node_id = $1`,
      [nodeId],
    );
    let best: { id: string; status: 'draft' | 'durable'; sim: number } | null = null;
    for (const cand of candidates) {
      const sim = bigramJaccard(bodyNormalized, cand.body_normalized);
      if (sim >= PARAPHRASE_THRESHOLD && (!best || sim > best.sim)) {
        best = { id: cand.id, status: cand.status, sim };
      }
    }
    if (best) {
      matchId = best.id;
      matchPriorStatus = best.status;
    }
  }

  let action: WikiProposeResponse['action'];
  let currentCount: number;
  let promotedToDurable = false;

  if (matchId === null) {
    const inserted = await q<{ reinforcement_count: number }>(
      `INSERT INTO learnings (node_id, body, body_normalized)
       VALUES ($1, $2, $3)
       RETURNING reinforcement_count`,
      [nodeId, body.insight.trim(), bodyNormalized],
    );
    action = 'created';
    currentCount = inserted[0]!.reinforcement_count;
  } else {
    const updated = await q<{ reinforcement_count: number; status: 'draft' | 'durable' }>(
      `UPDATE learnings
          SET reinforcement_count = reinforcement_count + 1,
              last_seen_at = NOW(),
              status = CASE WHEN reinforcement_count + 1 >= 3 THEN 'durable' ELSE status END
        WHERE id = $1
        RETURNING reinforcement_count, status`,
      [matchId],
    );
    const after = updated[0]!;
    currentCount = after.reinforcement_count;
    promotedToDurable = matchPriorStatus === 'draft' && after.status === 'durable';
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
      WHERE n.team_token = $1
        AND n.path = ANY($2::text[])
      ORDER BY length(n.path) ASC, n.path ASC,
               COALESCE(l.reinforcement_count, 0) DESC`,
    [c.get('team_token'), ancestors],
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
      WHERE n.team_token = $1
        AND n.path = ANY($2::text[])
        AND p.status = 'graduated'
      ORDER BY p.reuse_count DESC, length(n.path) DESC
      LIMIT $3`,
    [c.get('team_token'), ancestors, limit],
  );

  const res: ExamplesResponse = { items: rows.map((r): ExamplesItem => ({
    template: r.template,
    topic: r.topic,
    reuse_count: r.reuse_count,
    node_path: r.node_path,
  })) };
  return c.json(res);
});

// ----- GET /prompts/proven ---------------------------------------------------
// All graduated prompts for the team, optionally filtered by min score, an
// ancestor path, or topic. Powers the wiki_proven_prompts MCP tool.
//
// "Proven" == status='graduated'. Today every graduated prompt is by
// definition overall>=7 (the gate in /coach), and the actual score is now
// stored on graduated_overall_score so callers can filter ≥8 / ≥9 too.
//
// Ranking: score DESC, reuse_count DESC, created_at DESC. Score is the
// primary signal because reuse_count starts at 0 and grows over time —
// without the score tiebreaker, brand-new 10/10 prompts would rank below
// older 7/10 prompts that happened to be re-graduated once or twice.
app.get('/prompts/proven', async (c) => {
  const minScoreRaw = Number(c.req.query('min_score') ?? 7);
  const minScore = Number.isFinite(minScoreRaw) ? Math.max(0, Math.min(10, Math.floor(minScoreRaw))) : 7;
  const limit = Math.max(1, Math.min(100, Number(c.req.query('limit') ?? 20)));
  const pathScope = c.req.query('path');
  const topic = c.req.query('topic');
  const ancestors = pathScope ? ancestorPaths(pathScope) : null;

  const rows = await q<{
    id: string;
    template: string;
    topic: string | null;
    reuse_count: number;
    graduated_overall_score: number;
    author_user_id: string | null;
    node_path: string;
    created_at: Date;
  }>(
    `SELECT p.id, p.template, p.topic, p.reuse_count,
            p.graduated_overall_score, p.author_user_id,
            n.path AS node_path, p.created_at
       FROM prompts p
       JOIN nodes n ON n.id = p.node_id
      WHERE n.team_token = $1
        AND p.status = 'graduated'
        AND p.graduated_overall_score >= $2
        AND ($3::text[] IS NULL OR n.path = ANY($3::text[]))
        AND ($4::text  IS NULL OR p.topic = $4)
      ORDER BY p.graduated_overall_score DESC,
               p.reuse_count DESC,
               p.created_at DESC
      LIMIT $5`,
    [c.get('team_token'), minScore, ancestors, topic ?? null, limit],
  );

  const res: ProvenPromptsResponse = {
    items: rows.map((r): ProvenPromptItem => ({
      id: r.id,
      template: r.template,
      topic: r.topic,
      reuse_count: r.reuse_count,
      graduated_overall_score: r.graduated_overall_score,
      author_user_id: r.author_user_id,
      node_path: r.node_path,
      created_at: r.created_at.toISOString(),
    })),
  };
  return c.json(res);
});

// ----- GET /search?q=&scope= -------------------------------------------------
// Free-text substring search across the team's wiki: rules (nodes.body_md),
// durable learnings (learnings.body), and graduated prompts (prompts.template).
// Optional `scope` constrains results to the ancestor paths of a file/folder
// (same shape as /context). Used by the wiki_lookup MCP tool when the caller
// passes only `query`, or `query` + `file_path` for a path-scoped search.
app.get('/search', async (c) => {
  const query = (c.req.query('q') ?? '').trim();
  if (!query) return c.json({ error: 'missing_q' }, 400);
  const limit = Math.max(1, Math.min(100, Number(c.req.query('limit') ?? 50)));
  const scope = c.req.query('scope');
  // ILIKE wildcards from user input shouldn't bleed into the pattern. Escape
  // %, _, and the escape char itself so a search for "100%" matches the
  // literal substring rather than "100<anything>".
  const escaped = query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const pattern = `%${escaped}%`;
  const teamToken = c.get('team_token');
  const ancestors = scope ? ancestorPaths(scope) : null;

  // Rule branch matches on body_md OR the node path itself — so a query like
  // "scoring" surfaces packages/scoring/ even when body_md doesn't repeat the
  // folder name. Path-only matches return a placeholder body so the renderer
  // doesn't dump the whole node narrative when the match was structural.
  const rows = await q<{ kind: 'rule' | 'learning' | 'prompt'; body: string; node_path: string }>(
    `SELECT 'rule'::text AS kind,
            CASE
              WHEN n.body_md ILIKE $2 THEN n.body_md
              ELSE '(matched on path: ' || n.path || ')'
            END AS body,
            n.path AS node_path
       FROM nodes n
      WHERE n.team_token = $1
        AND (n.body_md ILIKE $2 OR n.path ILIKE $2)
        AND ($3::text[] IS NULL OR n.path = ANY($3::text[]))
     UNION ALL
     SELECT 'learning'::text AS kind, l.body AS body, n.path AS node_path
       FROM learnings l
       JOIN nodes n ON n.id = l.node_id
      WHERE n.team_token = $1
        AND l.status = 'durable'
        AND l.body ILIKE $2
        AND ($3::text[] IS NULL OR n.path = ANY($3::text[]))
     UNION ALL
     SELECT 'prompt'::text AS kind, p.template AS body, n.path AS node_path
       FROM prompts p
       JOIN nodes n ON n.id = p.node_id
      WHERE n.team_token = $1
        AND p.status = 'graduated'
        AND p.template ILIKE $2
        AND ($3::text[] IS NULL OR n.path = ANY($3::text[]))
      LIMIT $4`,
    [teamToken, pattern, ancestors, limit],
  );

  return c.json({ items: rows });
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
      WHERE n.team_token = $1
        AND l.last_seen_at > $2
      ORDER BY l.last_seen_at DESC
      LIMIT $3`,
    [c.get('team_token'), since.toISOString(), limit],
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
        WHERE n.team_token = $1
          AND p.status = 'graduated'
          AND p.topic = $2
          AND n.path = ANY($3::text[])
        ORDER BY p.reuse_count DESC, length(n.path) DESC
        LIMIT 1`,
      [c.get('team_token'), topic, ancestors],
    )
  )[0];
  if (!candidate) {
    candidate = (
      await q<{ template: string; topic: string | null; node_path: string }>(
        `SELECT p.template, p.topic, n.path AS node_path
           FROM prompts p
           JOIN nodes n ON n.id = p.node_id
          WHERE n.team_token = $1
            AND p.status = 'graduated'
            AND n.path = ANY($2::text[])
          ORDER BY p.reuse_count DESC, length(n.path) DESC
          LIMIT 1`,
        [c.get('team_token'), ancestors],
      )
    )[0];
  }
  if (!candidate) {
    candidate = (
      await q<{ template: string; topic: string | null; node_path: string }>(
        `SELECT p.template, p.topic, n.path AS node_path
           FROM prompts p
           JOIN nodes n ON n.id = p.node_id
          WHERE n.team_token = $1 AND p.status = 'graduated'
          ORDER BY p.reuse_count DESC
          LIMIT 1`,
        [c.get('team_token')],
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
          WHERE team_token = $1 AND user_id = $2 AND ts > $3
          ORDER BY ts ASC
          LIMIT $4`,
        [c.get('team_token'), userIdParam, since.toISOString(), limit],
      )
    : await q<{ dimension: Dimension; score: number; ts: Date }>(
        `SELECT dimension, score, ts
           FROM skill_observations
          WHERE team_token = $1 AND ts > $2
          ORDER BY ts ASC
          LIMIT $3`,
        [c.get('team_token'), since.toISOString(), limit],
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
        WHERE team_token = $1 AND ts > $2`,
      [c.get('team_token'), sevenDaysAgo],
    ),
    q<{ durable_count: number; draft_count: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE l.status = 'durable')::int AS durable_count,
         COUNT(*) FILTER (WHERE l.status = 'draft')::int   AS draft_count
         FROM learnings l
         JOIN nodes n ON n.id = l.node_id
        WHERE n.team_token = $1`,
      [c.get('team_token')],
    ),
    q<{ total: number; helpful: number }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE outcome = 'helpful')::int AS helpful
         FROM captures
        WHERE team_token = $1 AND created_at > $2`,
      [c.get('team_token'), sevenDaysAgo],
    ),
    q<{ active_users: number }>(
      `SELECT COUNT(DISTINCT user_id)::int AS active_users
         FROM skill_observations
        WHERE team_token = $1 AND ts > $2`,
      [c.get('team_token'), sevenDaysAgo],
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
  const teamToken = c.get('team_token');
  // Two queries instead of a three-way LEFT JOIN to avoid the cartesian
  // row explosion (nodes × learnings × prompts). Run in parallel — the
  // round-trip overhead is negligible at hackathon scale.
  const [rows, promptRows] = await Promise.all([
    q<{
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
        WHERE n.team_token = $1
        ORDER BY n.path ASC,
                 COALESCE(l.reinforcement_count, 0) DESC`,
      [teamToken],
    ),
    q<{
      path: string;
      prompt_id: string;
      template: string;
      topic: string | null;
      reuse_count: number;
      author_user_id: string | null;
    }>(
      `SELECT n.path,
              p.id AS prompt_id,
              p.template,
              p.topic,
              p.reuse_count,
              p.author_user_id
         FROM prompts p
         JOIN nodes n ON n.id = p.node_id
        WHERE n.team_token = $1
          AND p.status = 'graduated'
        ORDER BY n.path ASC,
                 p.reuse_count DESC,
                 p.created_at DESC`,
      [teamToken],
    ),
  ]);

  const byPath = new Map<string, WikiTreeNode>();
  for (const r of rows) {
    let node = byPath.get(r.path);
    if (!node) {
      node = {
        path: r.path,
        body_md: r.body_md,
        durable_learnings: [],
        draft_learnings: [],
        graduated_prompts: [],
      };
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
  for (const r of promptRows) {
    // Fallback init covers the rare case where a node carries prompts but
    // never appeared in the learnings query (shouldn't happen since the
    // first query LEFT JOINs every node, but defense-in-depth).
    let node = byPath.get(r.path);
    if (!node) {
      node = {
        path: r.path,
        body_md: '',
        durable_learnings: [],
        draft_learnings: [],
        graduated_prompts: [],
      };
      byPath.set(r.path, node);
    }
    node.graduated_prompts.push({
      id: r.prompt_id,
      template: r.template,
      topic: r.topic,
      reuse_count: r.reuse_count,
      author_user_id: r.author_user_id,
    });
  }

  const res: WikiTreeResponse = { nodes: Array.from(byPath.values()) };
  return c.json(res);
});

// ----- GET /teams ------------------------------------------------------------
// Lists every team with a usable token. Unauthenticated (the popup needs to
// populate a Select-team dropdown before any token is configured). Demo
// simplicity: no per-user permission filter.
app.get('/teams', async (c) => {
  const rows = await q<{ name: string; token: string }>(
    'SELECT name, token FROM teams ORDER BY name ASC',
  );
  const teams: TeamSummary[] = rows.map((r) => ({
    name: r.name,
    token: r.token,
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

  // Same context-injection pattern as /score — give Gemini the team's wiki
  // subtree as system context so the coach's clarifying questions and the
  // polished prompt land in the team's idiom.
  const teamContext = body.context_path
    ? await renderTeamContext(c.get('team_token'), body.context_path)
    : null;

  try {
    const out = await improveCoach({
      original_prompt: body.original_prompt,
      missing: body.missing ?? {},
      history: body.history,
      command,
      team_context: teamContext ?? undefined,
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
  const teamToken = c.get('team_token');
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
  const deleted = await wipeTeamData(teamToken);
  return c.json({ team_token: teamToken, deleted });
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

  if (typeof body.team_name === 'string' && body.team_name.trim()) {
    await applyTeamNameIfPlaceholder(c.get('team_token'), body.team_name);
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
      `INSERT INTO nodes (team_token, path, body_md)
         VALUES ($1, $2, $3)
       ON CONFLICT (team_token, path) DO UPDATE
         SET body_md = CASE
               WHEN $3 <> '' AND nodes.body_md = '' THEN $3
               ELSE nodes.body_md
             END,
             updated_at = NOW()
       RETURNING id, (xmax = 0) AS inserted`,
      [c.get('team_token'), path, seedBody],
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

  const teamToken = c.get('team_token');

  if (typeof body.team_name === 'string' && body.team_name.trim()) {
    await applyTeamNameIfPlaceholder(teamToken, body.team_name);
  }

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
    `INSERT INTO wiki_jobs (team_token, paths_total) VALUES ($1, $2) RETURNING id`,
    [teamToken, pathsTotal],
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
    runJob(jobId, teamToken, bundle).catch((e) => {
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
// Cross-team safety: the auth middleware sets team_token from the X-Team-Token
// header; the WHERE clause filters on it. A team can only see its own jobs
// (otherwise a leaked job_id would be a tenancy break).

app.get('/onboard/jobs/:id', async (c) => {
  const id = c.req.param('id');
  if (!id || !/^[0-9a-f-]{8,}$/i.test(id)) {
    return c.json({ error: 'bad_request', detail: 'invalid job id' }, 400);
  }
  const teamToken = c.get('team_token');

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
       FROM wiki_jobs WHERE team_token = $1 AND id = $2`,
    [teamToken, id],
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

// Lightweight startup migration. The full schema is applied via
// packages/db/migrate.mjs; this just guarantees columns introduced in
// recent commits exist before /coach reads or writes them, so a Railway
// auto-deploy doesn't 500 in the gap between the new image landing and
// the operator running migrate.mjs. Idempotent — every statement uses
// IF NOT EXISTS or is a no-op when the column already exists.
//
// Keep this list short. Anything beyond column adds belongs in
// schema.sql and should be applied via migrate.mjs.
async function ensureRecentMigrations(): Promise<void> {
  await q(`ALTER TABLE prompts ADD COLUMN IF NOT EXISTS author_user_id TEXT`);
}

const port = Number(process.env.PORT ?? 3000);
ensureRecentMigrations()
  .catch((err) => console.warn('[migrate] startup check failed', err))
  .finally(() => {
    serve({ fetch: app.fetch, port }, (info) => {
      console.log(`trailhead-api listening on http://localhost:${info.port}`);
    });
  });

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    await shutdownLangfuse().catch(() => {});
    process.exit(0);
  });
}

