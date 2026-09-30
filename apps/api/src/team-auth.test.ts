// Pure credential helpers (team-auth.ts). The DB-backed half of the model —
// resolveTeam, registration, rotation, legacy acceptance — is exercised
// end-to-end against Postgres in test/integration.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSecret, isValidTeamId, mintSecret, randomTeamId, safeEqual, SECRET_PREFIX } from './team-auth.ts';

test('mintSecret: prefixed, 192 random bits, never repeats', () => {
  const a = mintSecret();
  const b = mintSecret();
  assert.ok(a.startsWith(SECRET_PREFIX));
  assert.equal(Buffer.from(a.slice(SECRET_PREFIX.length), 'base64url').length, 24);
  assert.notEqual(a, b);
});

test('hashSecret is the hex SHA-256 the schema seeds for the demo team', () => {
  assert.equal(
    hashSecret('trailhead_demo_acme_2026'),
    '6c8ef50b8ac11089af2feb7c77de7d069a75edb30e740d836417eb387e0e079b',
  );
});

test('isValidTeamId accepts derived/random ids and rejects junk', () => {
  for (const ok of ['team_4c06e3f1e1c41311', randomTeamId(), 'repo_9d01c258a4bebb37', 'my-team.v2', 'abc']) {
    assert.ok(isValidTeamId(ok), ok);
  }
  for (const bad of ['', 'ab', '_team', 'has space', 'a/b', 'x'.repeat(101), 42, null, undefined]) {
    assert.equal(isValidTeamId(bad), false, String(bad));
  }
});

test('safeEqual compares exactly, including length', () => {
  assert.ok(safeEqual('op-token', 'op-token'));
  assert.equal(safeEqual('op-token', 'op-tokeN'), false);
  assert.equal(safeEqual('op', 'op-token'), false);
});
