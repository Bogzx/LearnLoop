// Team registration, credential probe and rotation, and DELETE /team/data.
// Mounted by app.ts, which applies auth, body caps and rate limits first.
import { Hono } from 'hono';
import type { TeamSummary, TeamsListResponse } from '@trailhead/shared';
import { DEMO_TEAM_TOKEN, q, registerTeam, rotateTeamSecret, wipeTeamData } from '../db.ts';
import { isValidTeamId, randomTeamId, safeEqual } from '../team-auth.ts';
import { invalidateTeamContext } from '../team-context.ts';
import { authPolicy, clientIp, opaqueTeamId, rateLimit, type AppEnv } from '../http.ts';

export const teamRoutes = new Hono<AppEnv>();

// ----- GET /teams ------------------------------------------------------------
// Resolves the CALLER's team. Authenticated, and it never returns a token.
//
// This used to be unauthenticated and return every team on the server together
// with its token — with CORS `*`, so any web page could read it. The team token
// is the only credential in this system: it grants read on the wiki (which
// summarises private source code) and write on everything. A single unauth GET
// therefore compromised every tenant at once. The browser popup's convenience
// of pre-populating a team dropdown before any token was configured is what
// paid for that, and it is nowhere near worth the price.
//
// The response is a list of one so the TeamsListResponse shape (and every
// caller that maps over `teams`) keeps working.
teamRoutes.get('/teams', async (c) => {
  const teamToken = c.get('team_token');
  const legacy = c.get('legacy_auth');
  const rows = await q<{ name: string; token: string }>(
    'SELECT name, token FROM teams WHERE token = $1',
    [teamToken],
  );
  const teams: TeamSummary[] = rows.map((r) => ({
    name: r.name,
    id: opaqueTeamId(r.token),
    legacy,
    // A secret team's id is public by design. A legacy team's id IS its
    // credential, so it is never echoed.
    ...(legacy ? {} : { team_id: r.token }),
  }));
  const res: TeamsListResponse = { teams };
  return c.json(res);
});

// ----- POST /teams -----------------------------------------------------------
// Register a team. Returns its secret exactly once; only the hash is stored.
//
//   body: { team_id?: string, name?: string }
//   201  { team_id, name, secret }
//   409  team_exists — someone already registered this id. That is the join
//        flow: ask a teammate for the secret (or pick another team_id).
//   403  admin_token_required — TRAILHEAD_ADMIN_TOKEN is set and X-Admin-Token
//        did not match.
//
// `init` derives team_id from the normalised git remote URL, so every clone of
// a repo proposes the same id and the second one lands on the 409.
teamRoutes.post('/teams', async (c) => {
  // Before the admin check, so the limit also slows admin-token guessing.
  const limited = rateLimit(c, [['register_per_ip', clientIp(c)]]);
  if (limited) return limited;
  const { adminToken } = authPolicy();
  if (adminToken !== null && !safeEqual(c.req.header('x-admin-token') ?? '', adminToken)) {
    return c.json(
      {
        error: 'admin_token_required',
        detail: 'This server restricts team registration. Ask its operator for a team secret, or for the admin token.',
      },
      403,
    );
  }
  const body = (await c.req.json<{ team_id?: unknown; name?: unknown }>().catch(() => null)) ?? {};
  if (body.team_id !== undefined && !isValidTeamId(body.team_id)) {
    return c.json(
      { error: 'bad_team_id', detail: '3-100 chars of letters, digits, _ . - starting with a letter or digit' },
      400,
    );
  }
  const teamId = (body.team_id as string | undefined) ?? randomTeamId();
  const rawName = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
  const created = await registerTeam(teamId, rawName || `team:${teamId.slice(0, 16)}`);
  if (!created) {
    return c.json(
      {
        error: 'team_exists',
        team_id: teamId,
        detail:
          'A team with this id already exists. To join it, get the team secret from a teammate ' +
          '(it is in their .trailhead-team file) and run `init --team-token <secret>`.',
      },
      409,
    );
  }
  return c.json({ team_id: created.teamId, name: created.name, secret: created.secret }, 201);
});

// ----- POST /teams/rotate-secret ---------------------------------------------
// Mint a new secret for the caller's team; the old credential stops working
// immediately. For a legacy team this is the upgrade to the secret model:
// afterwards its id is no longer accepted as a credential. Share the new
// secret with teammates.
teamRoutes.post('/teams/rotate-secret', async (c) => {
  const teamId = c.get('team_token');
  if (teamId === DEMO_TEAM_TOKEN) {
    return c.json({ error: 'demo_team_protected', detail: 'The demo team keeps its public secret.' }, 403);
  }
  const secret = await rotateTeamSecret(teamId);
  const rows = await q<{ name: string }>('SELECT name FROM teams WHERE token = $1', [teamId]);
  return c.json({ team_id: teamId, name: rows[0]?.name ?? '', secret });
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

teamRoutes.delete('/team/data', async (c) => {
  const body = await c.req.json<{ confirm?: boolean }>().catch(() => null);
  if (!body || body.confirm !== true) {
    return c.json(
      { error: 'confirm_required', detail: 'POST { "confirm": true } to wipe.' },
      400,
    );
  }
  const teamToken = c.get('team_token');
  const isDemo = teamToken === DEMO_TEAM_TOKEN;
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
  invalidateTeamContext(teamToken);
  return c.json({ team_token: teamToken, deleted });
});
