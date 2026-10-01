// Request plumbing shared by app.ts (middleware) and the route modules in
// routes/: the Hono env type, tenant policy, rate limiting, and the
// prompt-size cap and skill-observation writer that /score and /coach share.
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { DimensionScores } from '@trailhead/shared';
import { DIMENSIONS } from '@trailhead/shared';
import { q } from './db.ts';
import { ipRateKey, limiterFor, type LimitName, type TokenBucketLimiter } from './rate-limit.ts';
import { createHash } from 'node:crypto';

// Tenant policy, read per request so tests (and operators flipping env in a
// long-lived process manager) see the current value.
//
//   TRAILHEAD_ACCEPT_LEGACY_TOKENS (default true) — accept pre-2026-09-30
//     id-as-credential tokens (repo_…, custom strings) for teams that have not
//     been given a secret yet. Deprecated; set false once every team has run
//     `init --upgrade-legacy` (or POST /teams/rotate-secret).
//   TRAILHEAD_AUTO_CREATE_TEAMS (default false) — with legacy tokens accepted,
//     an unknown X-Team-Token spawns a legacy team. Unauthenticated tenant
//     creation; only for throwaway demo deploys. Has no effect when legacy
//     tokens are off. New teams should use POST /teams instead.
//   TRAILHEAD_ADMIN_TOKEN (default unset) — when set, POST /teams requires it
//     in X-Admin-Token, so only the operator can register teams. Unset means
//     open registration, which is fine while the API is bound to 127.0.0.1.
//   TRAILHEAD_DEMO_TEAM (on | off; default on, but off when
//     TRAILHEAD_ADMIN_TOKEN is set) — the seeded demo team's secret is public
//     (it is in this repo), so anyone who can reach the API can write to its
//     wiki and spend the operator's Gemini quota through it. Setting an admin
//     token is the sign of a networked deploy, which is why it turns the demo
//     team off unless TRAILHEAD_DEMO_TEAM=on says otherwise.
export function authPolicy() {
  const adminToken = process.env.TRAILHEAD_ADMIN_TOKEN || null;
  const demo = process.env.TRAILHEAD_DEMO_TEAM;
  return {
    acceptLegacy: process.env.TRAILHEAD_ACCEPT_LEGACY_TOKENS !== 'false',
    autoCreate: process.env.TRAILHEAD_AUTO_CREATE_TEAMS === 'true',
    adminToken,
    demoTeam: demo === 'on' || demo === 'true' ? true : demo === 'off' || demo === 'false' ? false : adminToken === null,
  };
}


// Hono context typing — the auth middleware sets `team_token` (the team id;
// the column kept its historical name) and `legacy_auth` for every handler.
export type AppEnv = { Variables: { team_token: string; legacy_auth: boolean } };

// The caller's rate-limit key: the socket's remote address, or — only when
// TRAILHEAD_TRUST_PROXY=true, i.e. behind one reverse proxy you control — the
// LAST X-Forwarded-For entry, which is the one that proxy appended. Earlier
// entries come from the client (nginx's $proxy_add_x_forwarded_for, Caddy and
// Traefik all append to whatever the client sent), so reading the first one
// would let every request pick its own key. Trusting the header without a
// proxy would do the same. IPv6 is keyed per /64 (ipRateKey).
export function clientIp(c: Context<AppEnv>): string {
  if (process.env.TRAILHEAD_TRUST_PROXY === 'true') {
    const fwd = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
    if (fwd) return ipRateKey(fwd);
  }
  try {
    return ipRateKey(getConnInfo(c).remote.address ?? 'unknown');
  } catch {
    return 'unknown'; // no Node socket (app.request() in tests)
  }
}

// Take a token from each named limiter, all or none: every bucket is checked
// first, and only when all of them allow the request is a token spent in
// each. So a request refused by the per-team limit doesn't also use up the
// caller's per-IP allowance. On refusal, returns the 429 for the first
// refusing limit. Retry-After is in whole seconds. Clients treat 429 like any
// other failure: coaching fails open. (Synchronous, so no request can slip in
// between the checks and the takes.)
export function rateLimit(c: Context<AppEnv>, checks: Array<[LimitName, string]>): Response | null {
  const active = checks
    .map(([name, key]) => ({ name, key, limiter: limiterFor(name) }))
    .filter((x): x is { name: LimitName; key: string; limiter: TokenBucketLimiter } => x.limiter !== null);
  for (const { name, key, limiter } of active) {
    const r = limiter.peek(key);
    if (r.ok) continue;
    c.header('Retry-After', String(r.retryAfterSec));
    return c.json(
      {
        error: 'rate_limited',
        limit: name,
        retry_after: r.retryAfterSec,
        detail: `Too many requests (${name.replace(/_/g, ' ')}: ${limiter.spec.text}). Retry in ${r.retryAfterSec}s.`,
      },
      429,
    );
  }
  for (const { key, limiter } of active) limiter.take(key);
  return null;
}

// A stable, opaque handle for a team that is safe to hand to a client.
//
// SHA-256 of the token, truncated to 16 hex chars. Not reversible, not
// replayable as an X-Team-Token, and stable across requests so it works as a
// React key or a client-side lookup handle.
export function opaqueTeamId(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export function teamIdFromHeader(token: string | undefined): string | null {
  return token ? opaqueTeamId(token) : null;
}

export function simpleHash(s: string): string {
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
export async function writeSkillObservations(
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

// Upper bound on any prompt text handed to Gemini. Every scored character is
// billed to the operator's GEMINI_API_KEY, and without a cap one request can
// carry an arbitrarily large body. 64K chars (~16K tokens) is far above a real
// chat prompt, pasted code included; clients already fail open on non-2xx, so
// an over-cap prompt is simply sent uncoached.
export const MAX_PROMPT_CHARS = 64_000;

export function promptTooLong(...texts: (string | undefined)[]): boolean {
  return texts.some((t) => typeof t === 'string' && t.length > MAX_PROMPT_CHARS);
}

export const PROMPT_TOO_LONG = {
  error: 'prompt_too_long',
  detail: `max ${MAX_PROMPT_CHARS} characters`,
} as const;
