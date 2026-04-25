// The dedup invariant: the MCP path and the Stop hook path must produce the
// same body_normalized for the same insight, otherwise the reinforcement
// counter never increments. Both paths import normalize() from this package,
// so this test catches future regressions if anyone forks the function.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './normalize.mjs';

const MCP_INSIGHTS = [
  'We always use exponential backoff with jitter.',
  'WE always USE exponential BACKOFF with JITTER.',
  '"We always use exponential backoff with jitter."',
  '   we always use exponential backoff with jitter   ',
  'We always use exponential backoff with jitter!',
];

test('all paraphrasings of the same insight collapse to one normalized form', () => {
  const normalized = MCP_INSIGHTS.map(normalize);
  for (const n of normalized) {
    assert.equal(n, normalized[0], `mismatch in normalization: ${n} vs ${normalized[0]}`);
  }
  assert.equal(normalized[0], 'we always use exponential backoff with jitter');
});

test('a different insight normalizes to a different string', () => {
  const a = normalize('Use exponential backoff with jitter.');
  const b = normalize('Use linear backoff without jitter.');
  assert.notEqual(a, b);
});

test('idempotent — normalizing twice gives the same output', () => {
  const inputs = [
    'Use exponential backoff!',
    '   already   normalized   ',
    'Idempotent: yes; safe: true.',
  ];
  for (const i of inputs) {
    assert.equal(normalize(normalize(i)), normalize(i));
  }
});
