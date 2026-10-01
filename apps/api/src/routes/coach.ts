// POST /coach: the server-side teach → reveal coaching loop.
// Mounted by app.ts, which applies auth, body caps and rate limits first.
import { Hono } from 'hono';
import type {
  CoachMode,
  CoachNextRoundInputs,
  CoachRequest,
  CoachResponse,
  Dimension,
  DimensionScores,
} from '@trailhead/shared';
import { DIMENSIONS } from '@trailhead/shared';
import {
  ancestorPaths,
  buildAugmentation,
  renderSkipReveal,
  renderSuccessReveal,
  renderTeachBlock,
} from '@trailhead/scoring';
import { q } from '../db.ts';
import { degradedCoachResponse, isUnparseableScore } from '../coach-degraded.ts';
import {
  acknowledgeProgress,
  overallScore,
  rewriteForDims,
  scorePrompt,
  summarizeCoaching,
} from '../gemini.ts';
import { tryPromotePrompt } from '../prompt-promotion.ts';
import {
  passesPromotionGate,
  promotionMode,
  renderLibraryBanner,
  renderNotPromotedNote,
} from '../promotion-gate.ts';
import { renderTeamContext } from '../team-context.ts';
import { PROMPT_TOO_LONG, promptTooLong, writeSkillObservations, type AppEnv } from '../http.ts';

export const coachRoutes = new Hono<AppEnv>();

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
}): Promise<{ example: string; tip: string; fromTeam: boolean }> {
  const wiki = args.file_path
    ? await fetchTopGraduatedForPath(args.teamToken, args.file_path, args.userId)
    : await fetchTopGraduatedForTeam(args.teamToken, args.userId);
  // fromTeam: a teammate's text — the renderers fence it as untrusted.
  if (wiki) return { example: wiki, tip: '', fromTeam: true };

  const fallback = await rewriteForDims({
    prompt: args.prompt,
    target_dims: args.target_dims,
    file_path: args.file_path,
    team_context: args.team_context ?? undefined,
  });
  // Empty strings on Gemini failure — render block falls back accordingly.
  return { example: fallback.rewritten_prompt, tip: fallback.tip, fromTeam: false };
}

// Library promotion for a /coach prompt that needs no (more) coaching.
// Checks the gate (promotion-gate.ts: unrounded mean >= 7, no dimension < 5)
// synchronously and, if it passes, schedules the background promotion, which
// re-scores independently before inserting. Returns the line for `text` —
// it ships in `text` so a forgetful host LLM can't drop it, and it never
// claims more than has happened.
function promoteIfEligible(args: {
  teamToken: string;
  userId: string;
  prompt: string;
  filePath: string | null;
  dimensions: DimensionScores;
  overall: number;
}): string {
  const gate = passesPromotionGate(args.dimensions);
  if (!gate.ok) return renderNotPromotedNote(args.overall, gate);
  const mode = promotionMode();
  // Fire-and-forget: off the response path, fail-open inside
  // tryPromotePrompt. MCP-only by call site (only /coach promotes).
  setImmediate(() => {
    void tryPromotePrompt({ ...args, mode });
  });
  return renderLibraryBanner(args.overall, mode);
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

coachRoutes.post('/coach', async (c) => {
  const body = await c.req.json<CoachRequest>().catch(() => null);
  if (!body || typeof body.prompt !== 'string' || typeof body.user_id !== 'string') {
    return c.json({ error: 'bad_request' }, 400);
  }
  if (promptTooLong(body.prompt, body.original_prompt)) return c.json(PROMPT_TOO_LONG, 413);

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
    // Fail-open on `proceed`, but NEVER fail silent. A coaching outage must
    // not block the user's real work, so proceed stays true — but the caller
    // is told plainly that this turn was not coached, and why. Returning
    // text:'' here (the old behaviour) made an outage look identical to a
    // perfect prompt, so the MCP tool ran indefinitely without ever coaching.
    console.error('[api] /coach scorePrompt failed', err);
    const zeros = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as DimensionScores;
    return c.json(degradedCoachResponse(mode, zeros, 'score_failed', err));
  }
  const overall = overallScore(scoreResult.dimensions);

  // Fail-open: scorePrompt does NOT throw on Gemini parse failures — it
  // silently returns zeros + empty missing (see gemini.ts coerceScore).
  // That signal is indistinguishable from a real all-zero score except by
  // the empty `missing` object: a real-zero score from Gemini populates
  // hints for the dims < 5. When we detect the zero+empty fingerprint,
  // treat it as "Gemini failed, no coaching this turn" rather than
  // pretending the user wrote a perfectly empty prompt. Spec §7.
  if (isUnparseableScore(scoreResult.dimensions, scoreResult.missing)) {
    console.error('[api] /coach scorePrompt returned unparseable output (zero+empty fingerprint)');
    return c.json(
      degradedCoachResponse(mode, scoreResult.dimensions, 'score_unparseable'),
    );
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
          strongRewriteFromTeam: strong.fromTeam,
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
      text: promoteIfEligible({
        teamToken,
        userId: body.user_id,
        prompt: body.prompt,
        filePath: body.file_path ?? null,
        dimensions: scoreResult.dimensions,
        overall,
      }),
    };
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
      strongExampleFromTeam: strong.fromTeam,
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
      // The user iterated through coaching and landed a >=7 prompt — the
      // final form is the promotion candidate.
      `\n\n${promoteIfEligible({
        teamToken,
        userId: body.user_id,
        prompt: body.prompt,
        filePath: body.file_path ?? null,
        dimensions: scoreResult.dimensions,
        overall,
      })}`;
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
          strongRewriteFromTeam: strong.fromTeam,
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
      strongExampleFromTeam: strong.fromTeam,
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
