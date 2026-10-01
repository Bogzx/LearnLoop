// LLM-assisted rewrites: POST /diff (compare to a team prompt) and POST /improve.
// Mounted by app.ts, which applies auth, body caps and rate limits first.
import { Hono } from 'hono';
import type {
  DiffRequest,
  DiffResponse,
  DimensionScores,
  ImproveRequest,
  ImproveResponse,
  ImproveTurn,
} from '@trailhead/shared';
import { ancestorPaths } from '@trailhead/scoring';
import { q } from '../db.ts';
import { extractTopic, improveCoach, overallScore, scorePrompt, synthesizeDiff } from '../llm.ts';
import { renderTeamContext } from '../team-context.ts';
import { PROMPT_TOO_LONG, promptTooLong, type AppEnv } from '../http.ts';

export const assistRoutes = new Hono<AppEnv>();

// ----- POST /diff ------------------------------------------------------------
// Find the closest graduated prompt in the same path/topic ancestry, score
// both, and have Gemma narrate the differences. Spec §10.

assistRoutes.post('/diff', async (c) => {
  const body = await c.req.json<DiffRequest>().catch(() => null);
  if (!body || typeof body.user_prompt !== 'string' || typeof body.user_id !== 'string') {
    return c.json({ error: 'bad_request' }, 400);
  }
  if (promptTooLong(body.user_prompt)) return c.json(PROMPT_TOO_LONG, 413);

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

// ----- POST /improve ---------------------------------------------------------
// Gemini-driven multi-turn prompt coach. Stateless — caller carries the full
// conversation each turn. Spec: 2026-04-26-improve-widget-design.md
const IMPROVE_TURN_CAP = 5; // user replies; history.length cap is 2 * cap

assistRoutes.post('/improve', async (c) => {
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
  if (promptTooLong(body.original_prompt, ...body.history.map((t) => t.text))) {
    return c.json(PROMPT_TOO_LONG, 413);
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
