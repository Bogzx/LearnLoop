// The team's prompt library: graduated prompts and the review queue.
// Mounted by app.ts, which applies auth, body caps and rate limits first.
import { Hono } from 'hono';
import type { ProvenPromptItem, ProvenPromptsResponse } from '@trailhead/shared';
import { ancestorPaths } from '@trailhead/scoring';
import { q } from '../db.ts';
import { intParam, isUuid } from '../request-params.ts';
import type { AppEnv } from '../http.ts';

export const promptRoutes = new Hono<AppEnv>();

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
promptRoutes.get('/prompts/proven', async (c) => {
  const minScore = intParam(c.req.query('min_score'), 7, 0, 10);
  const limit = intParam(c.req.query('limit'), 20, 1, 100);
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

// ----- GET /prompts/pending + POST /prompts/:id/review ------------------------
// Review queue for TRAILHEAD_PROMOTION_MODE=review (promotion-gate.ts): /coach
// promotions land as 'pending_review' and only join the library when approved.
// Anyone holding the team secret can review — user ids are self-asserted, so
// "a teammate other than the author" is a team convention, not enforced.
promptRoutes.get('/prompts/pending', async (c) => {
  const rows = await q<{
    id: string; template: string; topic: string | null; graduated_overall_score: number;
    author_user_id: string | null; node_path: string; created_at: Date;
  }>(
    `SELECT p.id, p.template, p.topic, p.graduated_overall_score, p.author_user_id,
            n.path AS node_path, p.created_at
       FROM prompts p
       JOIN nodes n ON n.id = p.node_id
      WHERE n.team_token = $1 AND p.status = 'pending_review'
      ORDER BY p.created_at ASC
      LIMIT 200`,
    [c.get('team_token')],
  );
  return c.json({
    items: rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() })),
  });
});

promptRoutes.post('/prompts/:id/review', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'bad_request', detail: 'invalid prompt id' }, 400);
  const body = await c.req.json<{ approve?: unknown }>().catch(() => null);
  if (!body || typeof body.approve !== 'boolean') {
    return c.json({ error: 'bad_request', detail: 'body must be { "approve": true | false }' }, 400);
  }
  // Scoped through nodes.team_token: another team's prompt id is a 404.
  const rows = body.approve
    ? await q<{ id: string }>(
        `UPDATE prompts p SET status = 'graduated'
           FROM nodes n
          WHERE p.id = $1 AND p.node_id = n.id AND n.team_token = $2 AND p.status = 'pending_review'
          RETURNING p.id`,
        [id, c.get('team_token')],
      )
    : await q<{ id: string }>(
        `DELETE FROM prompts p
          USING nodes n
          WHERE p.id = $1 AND p.node_id = n.id AND n.team_token = $2 AND p.status = 'pending_review'
          RETURNING p.id`,
        [id, c.get('team_token')],
      );
  if (!rows.length) return c.json({ error: 'not_found' }, 404);
  return c.json({ id, status: body.approve ? 'graduated' : 'rejected' });
});
