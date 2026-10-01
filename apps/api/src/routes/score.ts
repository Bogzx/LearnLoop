// POST /score (5-dimension score, recorded as skill observations) and POST /capture.
// Mounted by app.ts, which applies auth, body caps and rate limits first.
import { Hono } from 'hono';
import type {
  CaptureRequest,
  CaptureResponse,
  ScoreRequest,
  ScoreResponse,
} from '@trailhead/shared';
import { q } from '../db.ts';
import { isUnparseableScore } from '../coach-degraded.ts';
import { overallScore, scorePrompt, scorerName } from '../llm.ts';
import { renderTeamContext } from '../team-context.ts';
import { PROMPT_TOO_LONG, promptTooLong, writeSkillObservations, type AppEnv } from '../http.ts';

export const scoreRoutes = new Hono<AppEnv>();

// ----- POST /score -----------------------------------------------------------
// Live 5-dim Gemini score; writes 5 skill_observation rows (one per dimension)
// with a 30s dedup window per (team, user, dimension, prompt-hash) per spec
// §19 risk register. Fails closed (returns 500 on Gemini error) — the browser
// extension fails open on its side so the user is never blocked.

scoreRoutes.post('/score', async (c) => {
  const body = await c.req.json<ScoreRequest>().catch(() => null);
  if (!body || typeof body.prompt !== 'string' || typeof body.user_id !== 'string') {
    return c.json({ error: 'bad_request' }, 400);
  }
  if (promptTooLong(body.prompt)) return c.json(PROMPT_TOO_LONG, 413);

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
  // Parse failure comes back as all-zero + no hints rather than a throw (see
  // isUnparseableScore). Report it as an upstream failure and write nothing:
  // persisting it would record five fake 0/10 observations for this user.
  if (isUnparseableScore(result.dimensions, result.missing)) {
    console.error('[api] /score scorePrompt returned unparseable output (zero+empty fingerprint)');
    return c.json({ error: 'score_unparseable' }, 502);
  }
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
    scorer: scorerName(),
  };
  return c.json(res);
});

// ----- POST /capture ---------------------------------------------------------
scoreRoutes.post('/capture', async (c) => {
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
