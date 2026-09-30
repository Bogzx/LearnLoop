// `init`'s team step against a stubbed API: register, join (409), legacy
// detection and upgrade, explicit credentials (valid / rejected / offline),
// and a registration-restricted server (403).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTeam, TeamSetupError } from './team-setup.mjs';
import { teamIdFromRemote, tokenFromRemote } from '../src/token.mjs';

const API = 'http://api.test';
const REMOTE = 'git@github.com:org/repo.git';

function repo({ remote = REMOTE } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'trailhead-setup-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  return dir;
}

// Minimal fake of the API's team endpoints. `teams` maps credential → team.
function fakeApi({ teams = {}, registered = new Set(), adminToken = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.slice(API.length);
    const token = init.headers['X-Team-Token'];
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, token, body });
    const json = (status, obj) => ({ status, json: async () => obj });
    if (init.method === 'GET' && path === '/teams') {
      const t = teams[token];
      return t ? json(200, { teams: [{ name: t.name, id: 'x', legacy: t.legacy, ...(t.legacy ? {} : { team_id: t.id }) }] }) : json(401, {});
    }
    if (init.method === 'POST' && path === '/teams') {
      if (adminToken && init.headers['X-Admin-Token'] !== adminToken) return json(403, { error: 'admin_token_required' });
      if (registered.has(body.team_id)) return json(409, { error: 'team_exists' });
      registered.add(body.team_id);
      const secret = `trailhead_sk_new_${body.team_id}`;
      teams[secret] = { id: body.team_id, name: body.name, legacy: false };
      return json(201, { team_id: body.team_id, name: body.name, secret });
    }
    if (init.method === 'POST' && path === '/teams/rotate-secret') {
      const t = teams[token];
      if (!t) return json(401, {});
      delete teams[token];
      const secret = `trailhead_sk_rotated_${t.id}`;
      teams[secret] = { ...t, legacy: false };
      return json(200, { team_id: t.id, name: t.name, secret });
    }
    return json(404, {});
  };
  return { fetchImpl, calls, teams, registered };
}

const offline = async () => { throw new TypeError('fetch failed'); };
const sentinel = (dir) => readFileSync(join(dir, '.trailhead-team'), 'utf8').trim();

test('no credential, no legacy team → registers team_<normalised remote hash> and saves the secret', async () => {
  const dir = repo();
  try {
    const api = fakeApi();
    const r = await setupTeam({ cwd: dir, apiUrl: API, env: {}, fetchImpl: api.fetchImpl });
    assert.equal(r.source, 'registered');
    assert.equal(r.teamId, teamIdFromRemote(REMOTE));
    assert.equal(sentinel(dir), r.token);
    assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /\.trailhead-team/);
    const post = api.calls.find((c) => c.method === 'POST' && c.path === '/teams');
    assert.equal(post.body.team_id, teamIdFromRemote('https://github.com/Org/Repo'));
    assert.equal(post.body.name, 'repo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('team already registered (409) → join_required error naming --team-token; nothing written', async () => {
  const dir = repo();
  try {
    const api = fakeApi({ registered: new Set([teamIdFromRemote(REMOTE)]) });
    await assert.rejects(
      setupTeam({ cwd: dir, apiUrl: API, env: {}, fetchImpl: api.fetchImpl }),
      (e) => e instanceof TeamSetupError && e.code === 'join_required' && /--team-token <secret>/.test(e.message),
    );
    assert.equal(existsSync(join(dir, '.trailhead-team')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--team-id overrides the derived id', async () => {
  const dir = repo();
  try {
    const api = fakeApi({ registered: new Set([teamIdFromRemote(REMOTE)]) });
    const r = await setupTeam({ cwd: dir, apiUrl: API, env: {}, teamIdOverride: 'my-fork', fetchImpl: api.fetchImpl });
    assert.equal(r.teamId, 'my-fork');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy team for this repo → reused with a deprecation note, not re-registered', async () => {
  const dir = repo();
  try {
    const legacy = tokenFromRemote(REMOTE);
    const api = fakeApi({ teams: { [legacy]: { id: legacy, name: 'repo', legacy: true } } });
    const r = await setupTeam({ cwd: dir, apiUrl: API, env: {}, fetchImpl: api.fetchImpl });
    assert.equal(r.source, 'legacy-remote');
    assert.equal(r.legacy, true);
    assert.equal(sentinel(dir), legacy);
    assert.ok(r.notes.some((n) => /--upgrade-legacy/.test(n)));
    assert.equal(api.calls.some((c) => c.method === 'POST'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--upgrade-legacy mints a secret for the legacy team and replaces the sentinel', async () => {
  const dir = repo();
  try {
    const legacy = tokenFromRemote(REMOTE);
    const api = fakeApi({ teams: { [legacy]: { id: legacy, name: 'repo', legacy: true } } });
    const r = await setupTeam({ cwd: dir, apiUrl: API, env: {}, upgradeLegacy: true, fetchImpl: api.fetchImpl });
    assert.equal(r.source, 'legacy-upgraded');
    assert.equal(r.legacy, false);
    assert.equal(r.teamId, legacy); // data stays in the same team
    assert.equal(sentinel(dir), `trailhead_sk_rotated_${legacy}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--upgrade-legacy also works from an existing legacy sentinel', async () => {
  const dir = repo();
  try {
    writeFileSync(join(dir, '.trailhead-team'), 'custom-legacy\n');
    const api = fakeApi({ teams: { 'custom-legacy': { id: 'custom-legacy', name: 'c', legacy: true } } });
    const r = await setupTeam({ cwd: dir, apiUrl: API, env: {}, upgradeLegacy: true, fetchImpl: api.fetchImpl });
    assert.equal(r.source, 'legacy-upgraded');
    assert.equal(sentinel(dir), 'trailhead_sk_rotated_custom-legacy');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit --team-token is validated and saved (joining a teammate)', async () => {
  const dir = repo();
  try {
    const api = fakeApi({ teams: { 'trailhead_sk_mate': { id: 'team_x', name: 'x', legacy: false } } });
    const r = await setupTeam({ cwd: dir, apiUrl: API, env: {}, explicitToken: 'trailhead_sk_mate', fetchImpl: api.fetchImpl });
    assert.equal(r.validated, true);
    assert.equal(r.teamId, 'team_x');
    assert.equal(sentinel(dir), 'trailhead_sk_mate');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit --team-token the API rejects → error, sentinel untouched', async () => {
  const dir = repo();
  try {
    await assert.rejects(
      setupTeam({ cwd: dir, apiUrl: API, env: {}, explicitToken: 'wrong', fetchImpl: fakeApi().fetchImpl }),
      (e) => e.code === 'rejected' && !e.message.includes('wrong'),
    );
    assert.equal(existsSync(join(dir, '.trailhead-team')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit credential with the API offline → accepted unvalidated (init works offline)', async () => {
  const dir = repo();
  try {
    const r = await setupTeam({ cwd: dir, apiUrl: API, env: {}, explicitToken: 'trailhead_sk_x', fetchImpl: offline });
    assert.equal(r.validated, false);
    assert.equal(sentinel(dir), 'trailhead_sk_x');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no credential with the API offline → unreachable error', async () => {
  const dir = repo();
  try {
    await assert.rejects(
      setupTeam({ cwd: dir, apiUrl: API, env: {}, fetchImpl: offline }),
      (e) => e.code === 'unreachable',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registration-restricted server: 403 without the admin token, 201 with it', async () => {
  const dir = repo();
  try {
    const api = fakeApi({ adminToken: 'op' });
    await assert.rejects(
      setupTeam({ cwd: dir, apiUrl: API, env: {}, fetchImpl: api.fetchImpl }),
      (e) => e.code === 'admin_required',
    );
    const r = await setupTeam({ cwd: dir, apiUrl: API, env: {}, adminToken: 'op', fetchImpl: api.fetchImpl });
    assert.equal(r.source, 'registered');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repo without a remote registers a random team_local_ id', async () => {
  const dir = repo({ remote: null });
  try {
    const r = await setupTeam({ cwd: dir, apiUrl: API, env: {}, fetchImpl: fakeApi().fetchImpl });
    assert.match(r.teamId, /^team_local_[0-9a-f]{16}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
