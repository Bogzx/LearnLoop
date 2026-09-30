// Token bucket + config parsing. Integration coverage (429s from real routes,
// Retry-After, per-IP vs per-team keys) is in test/integration.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ipRateKey, limitFromEnv, limiterFor, parseLimit, resetRateLimiters, TokenBucketLimiter } from './rate-limit.ts';

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

test('bucket count is hard-capped even when no bucket has refilled (flood of fresh keys)', () => {
  const c = clock();
  const l = new TokenBucketLimiter(parseLimit('10/1h')!, c.now, 1_000);
  for (let i = 0; i < 20_000; i++) {
    l.take(`k${i}`);
    c.advance(1);
  }
  assert.ok(l.size <= 1_000, `size ${l.size}`);
});

test('eviction is least-recently-used: an active client keeps its debt through a flood', () => {
  const c = clock();
  const l = new TokenBucketLimiter(parseLimit('1/1h')!, c.now, 100);
  assert.equal(l.take('busy').ok, true);
  for (let i = 0; i < 1_000; i++) {
    l.take(`flood${i}`);
    if (i % 50 === 0) assert.equal(l.take('busy').ok, false, 'busy client is still limited');
  }
});

test('ipRateKey: IPv6 per /64, IPv4-mapped as IPv4, IPv4 unchanged', () => {
  assert.equal(ipRateKey('203.0.113.7'), '203.0.113.7');
  assert.equal(ipRateKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(ipRateKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(ipRateKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'), '2001:db8:1:2::/64');
  assert.equal(ipRateKey('2001:0DB8:0001:0002::9'), '2001:db8:1:2::/64');
  assert.equal(ipRateKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipRateKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(ipRateKey('::1'), '0:0:0:0::/64');
  assert.equal(ipRateKey('unknown'), 'unknown');
});

test('peek reports what take would do without spending', () => {
  const c = clock();
  const l = new TokenBucketLimiter(parseLimit('1/1m')!, c.now);
  assert.equal(l.peek('k').ok, true);
  assert.equal(l.peek('k').ok, true, 'peek did not spend');
  assert.equal(l.take('k').ok, true);
  const p = l.peek('k');
  assert.equal(p.ok, false);
  assert.equal(p.retryAfterSec, 60);
  assert.equal(l.size, 1);
  assert.equal(l.peek('other').ok, true);
  assert.equal(l.size, 1, 'peek creates no bucket');
});

test('limiterFor parses each env value once: a malformed value warns once, not per request', () => {
  resetRateLimiters();
  const warnings: unknown[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warnings.push(a); };
  try {
    const env = { TRAILHEAD_RL_LLM_PER_IP: 'lots' };
    const first = limiterFor('llm_per_ip', env);
    for (let i = 0; i < 100; i++) assert.equal(limiterFor('llm_per_ip', env), first);
    assert.equal(first!.spec.text, '120/1m');
    assert.equal(warnings.length, 1);
    assert.equal(limiterFor('llm_per_ip', { TRAILHEAD_RATE_LIMIT: 'off' }), null);
    assert.equal(limiterFor('llm_per_ip', { TRAILHEAD_RL_LLM_PER_IP: 'off' }), null);
  } finally {
    console.warn = realWarn;
    resetRateLimiters();
  }
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
