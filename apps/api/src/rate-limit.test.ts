// Token bucket + config parsing. Integration coverage (429s from real routes,
// Retry-After, per-IP vs per-team keys) is in test/integration.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { limitFromEnv, limiterFor, parseLimit, resetRateLimiters, TokenBucketLimiter } from './rate-limit.ts';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

test('parseLimit accepts N/W with s|m|h and an optional count, and "off"', () => {
  assert.equal(parseLimit('120/1m')!.capacity, 120);
  assert.equal(parseLimit('120/m')!.refillPerMs, 120 / 60_000);
  assert.equal(parseLimit('10 / 2h')!.refillPerMs, 10 / 7_200_000);
  assert.equal(parseLimit('5/30s')!.refillPerMs, 5 / 30_000);
  assert.equal(parseLimit('off'), null);
  assert.equal(parseLimit('0'), null);
  for (const bad of ['', 'ten/1m', '10/1d', '10', '-1/1m', '0/1m']) {
    assert.throws(() => parseLimit(bad), Error, bad);
  }
});

test('bucket allows a burst of N, then refuses with a Retry-After', () => {
  const c = clock();
  const l = new TokenBucketLimiter(parseLimit('3/1m')!, c.now);
  assert.deepEqual([l.take('k').ok, l.take('k').ok, l.take('k').ok], [true, true, true]);
  const refused = l.take('k');
  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfterSec, 20); // one token per 20 s
});

test('bucket refills continuously and caps at capacity', () => {
  const c = clock();
  const l = new TokenBucketLimiter(parseLimit('3/1m')!, c.now);
  for (let i = 0; i < 3; i++) l.take('k');
  c.advance(20_000);
  assert.equal(l.take('k').ok, true);
  assert.equal(l.take('k').ok, false);
  c.advance(10 * 60_000); // long idle: back to 3, not 30
  assert.equal(l.take('k').remaining, 2);
});

test('keys are independent', () => {
  const l = new TokenBucketLimiter(parseLimit('1/1h')!, clock().now);
  assert.equal(l.take('a').ok, true);
  assert.equal(l.take('a').ok, false);
  assert.equal(l.take('b').ok, true);
});

test('Retry-After rounds up and is at least 1 s', () => {
  const c = clock();
  const l = new TokenBucketLimiter(parseLimit('100/1s')!, c.now);
  for (let i = 0; i < 100; i++) l.take('k');
  assert.equal(l.take('k').retryAfterSec, 1);
});

test('prune drops fully refilled buckets so memory stays bounded', () => {
  const c = clock();
  const l = new TokenBucketLimiter(parseLimit('2/1s')!, c.now);
  for (let i = 0; i < 500; i++) l.take(`ip-${i}`);
  assert.equal(l.size, 500);
  c.advance(1_000);
  l.prune();
  assert.equal(l.size, 0);
});

test('limitFromEnv: defaults, overrides, global off, malformed falls back to default', () => {
  assert.equal(limitFromEnv('register_per_ip', {})!.text, '10/1h');
  assert.equal(limitFromEnv('llm_per_team', {})!.text, '120/1m');
  assert.equal(limitFromEnv('llm_per_ip', { TRAILHEAD_RL_LLM_PER_IP: '30/1m' })!.text, '30/1m');
  assert.equal(limitFromEnv('llm_per_ip', { TRAILHEAD_RL_LLM_PER_IP: 'off' }), null);
  assert.equal(limitFromEnv('llm_per_team', { TRAILHEAD_RATE_LIMIT: 'off' }), null);
  assert.equal(limitFromEnv('bootstrap_per_team', { TRAILHEAD_RL_BOOTSTRAP_PER_TEAM: 'lots' })!.text, '6/1h');
});

test('limiterFor reuses a limiter per spec and starts fresh when the spec changes', () => {
  resetRateLimiters();
  const a = limiterFor('llm_per_ip', { TRAILHEAD_RL_LLM_PER_IP: '1/1h' })!;
  assert.equal(a, limiterFor('llm_per_ip', { TRAILHEAD_RL_LLM_PER_IP: '1/1h' }));
  a.take('x');
  const b = limiterFor('llm_per_ip', { TRAILHEAD_RL_LLM_PER_IP: '2/1h' })!;
  assert.notEqual(a, b);
  assert.equal(b.take('x').ok, true);
  resetRateLimiters();
});
