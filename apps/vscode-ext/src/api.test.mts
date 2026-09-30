import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimitMessage, score } from './api.ts';

const cfg = { apiUrl: 'http://api.test', teamToken: 't' };

test('a 429 from /score surfaces as "try again in Ns"', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 429, headers: { 'Retry-After': '42' } })) as typeof fetch;
  try {
    await assert.rejects(score(cfg, { prompt: 'x', user_id: 'u' }), /try again in 42s/);
  } finally {
    globalThis.fetch = real;
  }
});

test('rateLimitMessage copes with a missing or junk Retry-After', () => {
  assert.match(rateLimitMessage({ headers: { get: () => null } }), /try again shortly/);
  assert.match(rateLimitMessage({ headers: { get: () => 'soon' } }), /try again shortly/);
});
