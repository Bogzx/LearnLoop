import test from 'node:test';
import assert from 'node:assert/strict';
import { ANONYMOUS_USER_ID, resolveUserState } from './user-state.ts';

const gen = () => '11111111-2222-4333-8444-555555555555';

test('first run: generates an id, persists it, shares it by default', () => {
  const r = resolveUserState({}, gen);
  assert.equal(r.persistId, gen());
  assert.equal(r.share, true);
  assert.equal(r.effective, gen());
});

test('later runs reuse the stored id and write nothing', () => {
  const r = resolveUserState({ id: 'stored-id' }, () => assert.fail('must not generate'));
  assert.equal(r.persistId, null);
  assert.equal(r.effective, 'stored-id');
});

test('opting out sends the anonymous id but keeps the stored one', () => {
  const r = resolveUserState({ id: 'stored-id', share: false }, gen);
  assert.equal(r.effective, ANONYMOUS_USER_ID);
  assert.equal(r.persistId, null);
});

test('opting out before any id exists still creates one for later opt-in', () => {
  const r = resolveUserState({ share: false }, gen);
  assert.equal(r.persistId, gen());
  assert.equal(r.effective, ANONYMOUS_USER_ID);
});

test('junk in storage is treated as absent', () => {
  assert.equal(resolveUserState({ id: 42, share: 'yes' }, gen).effective, gen());
  assert.equal(resolveUserState({ id: '' }, gen).persistId, gen());
});

test('the old shared "demo" id is never produced', () => {
  for (const s of [{}, { share: false }, { id: 'x' }]) {
    assert.notEqual(resolveUserState(s, gen).effective, 'demo');
  }
});
