import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANONYMOUS_USER_ID, resolveUserId, userIdFile } from './user-id.mjs';

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'trailhead-uid-'));
  try { return fn({ HOME: home }, home); } finally { rmSync(home, { recursive: true, force: true }); }
}

test('generates one random id per machine user and reuses it', () => withHome((env) => {
  const a = resolveUserId(env);
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.equal(resolveUserId(env), a);
  assert.equal(readFileSync(userIdFile(env), 'utf8').trim(), a);
}));

test('TRAILHEAD_SHARE_USER_ID=false opts out without deleting the id', () => withHome((env) => {
  const a = resolveUserId(env);
  assert.equal(resolveUserId({ ...env, TRAILHEAD_SHARE_USER_ID: 'false' }), ANONYMOUS_USER_ID);
  assert.equal(resolveUserId(env), a);
}));

test('TRAILHEAD_USER_ID overrides everything', () => withHome((env) => {
  assert.equal(resolveUserId({ ...env, TRAILHEAD_USER_ID: ' alice ', TRAILHEAD_SHARE_USER_ID: 'false' }), 'alice');
}));

test('XDG_CONFIG_HOME is honoured', () => withHome((env, home) => {
  const xdg = join(home, 'xdg');
  resolveUserId({ ...env, XDG_CONFIG_HOME: xdg });
  assert.equal(userIdFile({ ...env, XDG_CONFIG_HOME: xdg }), join(xdg, 'trailhead', 'user-id'));
}));

test('never returns the old shared "demo" id', () => withHome((env) => {
  assert.notEqual(resolveUserId(env), 'demo');
}));
