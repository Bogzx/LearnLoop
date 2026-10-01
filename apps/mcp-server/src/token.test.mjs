// Client-side credential helpers (src/token.mjs).
//
// normalizeRemoteUrl/teamIdFromRemote: every spelling of one repo must land on
// one team id — before 2026-09-30 an https clone and an ssh clone of the same
// repo derived different tokens and silently split a team in two.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findTeamFile,
  maskSecret,
  normalizeRemoteUrl,
  readCredential,
  teamIdFromRemote,
  tokenFromRemote,
} from './token.mjs';

const SAME_REPO = [
  'https://github.com/Org/Repo.git',
  'https://github.com/org/repo',
  'https://github.com/org/repo/',
  'http://github.com/org/repo.git',
  'https://user:ghp_secret@GitHub.com/org/repo.git',
  'git@github.com:org/repo.git',
  'git@github.com:org/repo',
  'git@github.com:org/repo.git/',
  'ssh://git@github.com/org/repo.git',
  'ssh://git@github.com:22/org/repo/',
  'ssh://git@github.com:org/repo.git',
  'git://github.com/org/repo.git',
];

test('every spelling of one repo normalises to host/path', () => {
  for (const u of SAME_REPO) assert.equal(normalizeRemoteUrl(u), 'github.com/org/repo', u);
});

test('every spelling of one repo gets the same team id', () => {
  const ids = new Set(SAME_REPO.map(teamIdFromRemote));
  assert.equal(ids.size, 1);
  assert.match([...ids][0], /^team_[0-9a-f]{16}$/);
});

test('different repos, owners and hosts get different team ids', () => {
  const ids = new Set([
    'git@github.com:org/repo.git',
    'git@github.com:org/repo2.git',
    'git@github.com:other/repo.git',
    'git@gitlab.com:org/repo.git',
    'git@github.com:org/sub/repo.git',
  ].map(teamIdFromRemote));
  assert.equal(ids.size, 5);
});

test('credentials embedded in a remote URL never affect the id', () => {
  assert.equal(
    teamIdFromRemote('https://x-access-token:abc@github.com/org/repo'),
    teamIdFromRemote('https://github.com/org/repo'),
  );
});

test('local paths and file:// remotes normalise to the same key', () => {
  assert.equal(normalizeRemoteUrl('/srv/git/Thing.git'), '/srv/git/thing');
  assert.equal(normalizeRemoteUrl('file:///srv/git/thing'), '/srv/git/thing');
});

test('the public team id is not the legacy credential for the same remote', () => {
  const url = 'https://github.com/org/repo.git';
  assert.notEqual(teamIdFromRemote(url), tokenFromRemote(url));
  assert.match(tokenFromRemote(url), /^repo_[0-9a-f]{16}$/);
});

test('maskSecret never reveals a usable secret', () => {
  const s = 'trailhead_sk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const m = maskSecret(s);
  assert.ok(m.endsWith('…'));
  assert.ok(m.length < s.length - 8);
  assert.equal(maskSecret('tok-cli'), 'tok-…');
});

test('readCredential: env token > TRAILHEAD_TEAM_FILE > ./.trailhead-team > null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trailhead-cred-'));
  try {
    assert.equal(readCredential({ env: {}, cwd: dir }), null);
    writeFileSync(join(dir, '.trailhead-team'), 'from-sentinel\n');
    assert.deepEqual(readCredential({ env: {}, cwd: dir })?.token, 'from-sentinel');
    const other = join(dir, 'elsewhere');
    writeFileSync(other, '  from-file  \n');
    assert.equal(readCredential({ env: { TRAILHEAD_TEAM_FILE: other }, cwd: dir })?.token, 'from-file');
    assert.equal(readCredential({ env: { TRAILHEAD_TEAM_FILE: other }, cwd: dir })?.source, 'team-file');
    assert.equal(
      readCredential({ env: { TRAILHEAD_TEAM_TOKEN: 'from-env', TRAILHEAD_TEAM_FILE: other }, cwd: dir })?.token,
      'from-env',
    );
    // A TEAM_FILE that does not exist falls through to the sentinel.
    assert.equal(readCredential({ env: { TRAILHEAD_TEAM_FILE: join(dir, 'nope') }, cwd: dir })?.token, 'from-sentinel');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a relative TRAILHEAD_TEAM_FILE is found from cwd up to the git root, and not beyond', () => {
  const root = mkdtempSync(join(tmpdir(), 'th-findup-'));
  try {
    const repo = join(root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
    writeFileSync(join(repo, '.trailhead-team'), 'from-repo-root\n');
    const fromSubdir = readCredential({ env: { TRAILHEAD_TEAM_FILE: '.trailhead-team' }, cwd: join(repo, 'src', 'deep') });
    assert.equal(fromSubdir?.token, 'from-repo-root');
    assert.equal(fromSubdir?.source, 'team-file');
    // A sentinel above the git root belongs to some other repo: not used.
    writeFileSync(join(root, '.trailhead-team'), 'outside\n');
    rmSync(join(repo, '.trailhead-team'));
    assert.equal(findTeamFile(join(repo, 'src'), '.trailhead-team'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
