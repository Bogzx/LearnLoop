// Unit tests for the query-string helpers in request-params.ts.
//
// The bug these pin down: limits were parsed inline as
// `Math.max(1, Math.min(N, Number(raw ?? d)))`. NaN survives both calls, so
// `GET /skill-arc?limit=abc` sent `LIMIT NaN` to Postgres and returned a 500.
// Likewise GET /onboard/jobs/:id accepted any 8+ hex/dash string, and a
// non-UUID such as 'aaaaaaaa' reached the uuid column and 500'd.
//
// Run: npm --workspace=apps/api test

import test from 'node:test';
import assert from 'node:assert/strict';
import { intParam, isUuid } from './request-params.ts';

test('intParam falls back to the default for anything non-numeric', () => {
  for (const raw of [undefined, '', '   ', 'abc', 'NaN', 'Infinity', '-Infinity', '1e999']) {
    assert.equal(intParam(raw, 50, 1, 100), 50, `raw=${String(raw)}`);
  }
});

test('intParam never returns NaN', () => {
  assert.ok(Number.isFinite(intParam('abc', 1000, 1, 5000)));
});

test('intParam clamps to [min, max]', () => {
  assert.equal(intParam('0', 50, 1, 100), 1);
  assert.equal(intParam('-5', 50, 1, 100), 1);
  assert.equal(intParam('100000', 50, 1, 100), 100);
});

test('intParam floors fractional values and passes in-range ones through', () => {
  assert.equal(intParam('7.9', 7, 0, 10), 7);
  assert.equal(intParam('42', 50, 1, 100), 42);
  assert.equal(intParam(' 8 ', 7, 0, 10), 8);
});

test('isUuid accepts canonical UUIDs in either case', () => {
  assert.ok(isUuid('6b672c8a-76a1-410f-93d3-bf86660a9171'));
  assert.ok(isUuid('6B672C8A-76A1-410F-93D3-BF86660A9171'));
});

test('isUuid rejects strings the old /^[0-9a-f-]{8,}$/ check let through', () => {
  for (const s of ['aaaaaaaa', '--------', '6b672c8a76a1410f93d3bf86660a9171', '6b672c8a-76a1-410f-93d3-bf86660a91711', '']) {
    assert.equal(isUuid(s), false, s);
  }
});
