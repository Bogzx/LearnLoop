// A 429 from the API becomes a typed RateLimitedError, and the coach tool
// fails open on it (and on any other API failure) instead of erroring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, RateLimitedError } from './api-client.ts';
import { coachUnavailable } from './tools.ts';

function stubFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

const client = new ApiClient({ apiUrl: 'http://api.test', teamToken: 'trailhead_sk_x' });

test('429 → RateLimitedError carrying Retry-After and the server detail', async () => {
  const restore = stubFetch(429, { error: 'rate_limited', detail: 'Too many requests (llm per team: 120/1m).' }, { 'retry-after': '30' });
  try {
    await assert.rejects(client.score({ prompt: 'x', user_id: 'u' }), (e: unknown) => {
      assert.ok(e instanceof RateLimitedError);
      assert.equal(e.retryAfterSec, 30);
      assert.match(e.message, /retry in 30s/);
      assert.match(e.message, /120\/1m/);
      return true;
    });
  } finally {
    restore();
  }
});

test('429 without a usable Retry-After still yields RateLimitedError', async () => {
  const restore = stubFetch(429, {}, { 'retry-after': 'soon' });
  try {
    await assert.rejects(client.score({ prompt: 'x', user_id: 'u' }), (e: unknown) => e instanceof RateLimitedError && e.retryAfterSec === null);
  } finally {
    restore();
  }
});

test('coach fails open on a rate limit: proceed, degraded, says why and when', () => {
  const out = coachUnavailable('score', new RateLimitedError('/coach', 12, 'slow down'));
  assert.equal(out.structuredContent.proceed, true);
  assert.equal(out.structuredContent.degraded, true);
  assert.equal(out.structuredContent.error, 'rate_limited');
  assert.match(out.structuredContent.text, /retry in 12s/);
  assert.match(out.content[0]!.text, /Proceed with the original prompt/);
});

test('coach fails open on any other API failure too', () => {
  const out = coachUnavailable('score', new TypeError('fetch failed'));
  assert.equal(out.structuredContent.proceed, true);
  assert.equal(out.structuredContent.error, 'api_unavailable');
  assert.match(out.structuredContent.text, /fetch failed/);
});
