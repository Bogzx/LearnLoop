// Read-only dashboards: GET /skill-arc and GET /team/metrics.
// Mounted by app.ts, which applies auth, body caps and rate limits first.
import { Hono } from 'hono';
import type {
  Dimension,
  SkillArcObservation,
  SkillArcResponse,
  TeamMetricsResponse,
} from '@trailhead/shared';
import { q } from '../db.ts';
import { intParam } from '../request-params.ts';
import type { AppEnv } from '../http.ts';

export const metricsRoutes = new Hono<AppEnv>();

// ----- GET /skill-arc?user_id=&since=ISO -------------------------------------
// Time-series of per-dimension scores for the dashboard hero chart. Drives
// the §13 close beat (live tick during demo). Defaults: any user, last 7
// days. Capped at 5000 rows to keep the chart responsive.

metricsRoutes.get('/skill-arc', async (c) => {
  const userIdParam = c.req.query('user_id');
  const sinceParam = c.req.query('since');
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(since.getTime())) return c.json({ error: 'bad_since' }, 400);
  const limit = intParam(c.req.query('limit'), 1000, 1, 5000);

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

metricsRoutes.get('/team/metrics', async (c) => {
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
