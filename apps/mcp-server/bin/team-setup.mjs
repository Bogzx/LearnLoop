// `init`'s team step: find or create this repo's team and end up holding its
// secret in ./.trailhead-team. Separate from init.mjs (which only writes
// config files) so the network flow can be tested with a stubbed fetch.
//
// Order:
//   1. --team-token <secret>     explicit (joining a teammate's team)
//   2. TRAILHEAD_TEAM_TOKEN env
//   3. ./.trailhead-team         already set up
//   4. otherwise, for a repo with a remote:
//        a. a LEGACY team for this repo exists (pre-2026-09-30 token =
//           sha256(raw remote URL)): use it with a deprecation warning, or
//           with --upgrade-legacy mint it a secret (POST /teams/rotate-secret)
//           — its data stays, the old token stops working for everyone.
//        b. register team_<sha256(normalised remote)> (POST /teams). 201 →
//           we hold the secret. 409 → the team exists: that is the join flow,
//           ask a teammate for the secret.
//      without a remote: register a random team_local_… id.
//
// Credentials given explicitly (1, 2) are validated against GET /teams when
// the API is reachable; if it is not, we warn and continue so `init` still
// works offline for someone who already has a secret. Steps 4a/4b need the API.

import { basename } from 'node:path';
import {
  deriveRepoName,
  generateRandomTeamId,
  gitRemoteUrl,
  maskSecret,
  readSentinel,
  teamIdFromRemote,
  tokenFromRemote,
  writeSentinel,
} from '../src/token.mjs';

export class TeamSetupError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function http(fetchImpl, method, url, { token, adminToken, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Team-Token'] = token;
  if (adminToken) headers['X-Admin-Token'] = adminToken;
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    return { status: 0, body: null, error: err };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: json };
}

// GET /teams with a credential → { ok, legacy, name, teamId } | { ok:false, status }
export async function probeCredential({ apiUrl, token, fetchImpl = fetch }) {
  const r = await http(fetchImpl, 'GET', `${apiUrl}/teams`, { token });
  if (r.status === 200 && r.body?.teams?.[0]) {
    const t = r.body.teams[0];
    return { ok: true, legacy: Boolean(t.legacy), name: t.name, teamId: t.team_id ?? null };
  }
  return { ok: false, status: r.status, error: r.error };
}

function unreachable(apiUrl, err) {
  return new TeamSetupError(
    `Can't reach the Trailhead API at ${apiUrl} (${err?.message ?? err}).\n` +
      '  Registering a team needs the API: start it with `docker compose up` (see SELFHOSTING.md),\n' +
      '  or pass --api-url <url>. If a teammate already gave you the team secret, pass\n' +
      '  --team-token <secret> and init will work offline.',
    'unreachable',
  );
}

/**
 * @returns {Promise<{ token: string, source: string, teamId: string|null,
 *   name: string|null, legacy: boolean, validated: boolean, notes: string[] }>}
 */
export async function setupTeam({
  cwd,
  apiUrl,
  explicitToken,
  env = process.env,
  upgradeLegacy = false,
  teamIdOverride,
  adminToken = env.TRAILHEAD_ADMIN_TOKEN,
  fetchImpl = fetch,
}) {
  const notes = [];

  // 1-3: a credential we already have.
  const given = explicitToken
    ? { token: explicitToken, source: 'flag' }
    : env.TRAILHEAD_TEAM_TOKEN
      ? { token: env.TRAILHEAD_TEAM_TOKEN, source: 'env' }
      : readSentinel(cwd)
        ? { token: readSentinel(cwd), source: 'sentinel' }
        : null;

  if (given) {
    const probe = await probeCredential({ apiUrl, token: given.token, fetchImpl });
    if (!probe.ok && probe.status === 0) {
      notes.push(`API unreachable at ${apiUrl} — using the ${given.source} credential without validating it.`);
      if (given.source !== 'sentinel') writeSentinel(cwd, given.token);
      return { ...given, teamId: null, name: null, legacy: false, validated: false, notes };
    }
    if (!probe.ok) {
      throw new TeamSetupError(
        `The API at ${apiUrl} rejected the ${given.source} credential (${maskSecret(given.token)}, HTTP ${probe.status}).\n` +
          '  Check you copied the whole team secret, or remove ./.trailhead-team and re-run init to register a team.',
        'rejected',
      );
    }
    let token = given.token;
    let legacy = probe.legacy;
    let teamId = probe.teamId;
    let source = given.source;
    if (legacy && upgradeLegacy) {
      ({ token, teamId } = await upgrade(apiUrl, token, fetchImpl));
      legacy = false;
      source = 'legacy-upgraded';
      notes.push('Upgraded the legacy team to a secret. The old token no longer works — share the new secret (./.trailhead-team) with teammates.');
    } else if (legacy) {
      notes.push(legacyNote());
    }
    if (source !== 'sentinel' || token !== given.token) writeSentinel(cwd, token);
    return { token, source, teamId, name: probe.name, legacy, validated: true, notes };
  }

  // 4: no credential yet.
  const remote = gitRemoteUrl(cwd);
  if (remote) {
    const legacyToken = tokenFromRemote(remote);
    const probe = await probeCredential({ apiUrl, token: legacyToken, fetchImpl });
    if (probe.status === 0) throw unreachable(apiUrl, probe.error);
    if (probe.ok && probe.legacy) {
      if (upgradeLegacy) {
        const up = await upgrade(apiUrl, legacyToken, fetchImpl);
        writeSentinel(cwd, up.token);
        notes.push('Found this repo\'s legacy team and upgraded it to a secret. The old repo_… token no longer works — share the new secret (./.trailhead-team) with teammates.');
        return { token: up.token, source: 'legacy-upgraded', teamId: up.teamId, name: probe.name, legacy: false, validated: true, notes };
      }
      writeSentinel(cwd, legacyToken);
      notes.push(legacyNote());
      return { token: legacyToken, source: 'legacy-remote', teamId: null, name: probe.name, legacy: true, validated: true, notes };
    }
  }

  const teamId = teamIdOverride ?? (remote ? teamIdFromRemote(remote) : generateRandomTeamId());
  const name = deriveRepoName(cwd, remote) || basename(cwd);
  const r = await http(fetchImpl, 'POST', `${apiUrl}/teams`, { adminToken, body: { team_id: teamId, name } });
  if (r.status === 0) throw unreachable(apiUrl, r.error);
  if (r.status === 201 && r.body?.secret) {
    writeSentinel(cwd, r.body.secret);
    notes.push('Registered a new team. Its secret is in ./.trailhead-team (gitignored) — teammates join with `init --team-token <secret>`.');
    return { token: r.body.secret, source: 'registered', teamId: r.body.team_id, name: r.body.name, legacy: false, validated: true, notes };
  }
  if (r.status === 409) {
    throw new TeamSetupError(
      `This repo's team (${teamId}) is already registered on ${apiUrl}.\n` +
        '  To join it, ask a teammate for the team secret (their ./.trailhead-team file) and run:\n' +
        '    init --team-token <secret>\n' +
        '  To start a separate team instead, pass --team-id <new-id>.',
      'join_required',
    );
  }
  if (r.status === 403) {
    throw new TeamSetupError(
      `${apiUrl} restricts team registration (TRAILHEAD_ADMIN_TOKEN is set on the server).\n` +
        '  Ask the operator for a team secret and pass --team-token <secret>, or pass --admin-token <token>.',
      'admin_required',
    );
  }
  throw new TeamSetupError(
    `Registering team ${teamId} failed: HTTP ${r.status} ${JSON.stringify(r.body ?? {})}`,
    'register_failed',
  );
}

async function upgrade(apiUrl, legacyToken, fetchImpl) {
  const r = await http(fetchImpl, 'POST', `${apiUrl}/teams/rotate-secret`, { token: legacyToken });
  if (r.status === 0) throw unreachable(apiUrl, r.error);
  if (r.status !== 200 || !r.body?.secret) {
    throw new TeamSetupError(`Upgrading the legacy team failed: HTTP ${r.status} ${JSON.stringify(r.body ?? {})}`, 'upgrade_failed');
  }
  return { token: r.body.secret, teamId: r.body.team_id };
}

function legacyNote() {
  return (
    'This team still uses a LEGACY token (derived from the git remote URL, so anyone who knows the URL can compute it). ' +
    'It keeps working while the server accepts legacy tokens. Re-run with --upgrade-legacy to switch the team to a secret ' +
    '(teammates then need the new secret).'
  );
}
