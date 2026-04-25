import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWikiSnapshot, diffWikiItems, maxSince, truncate } from './wiki-diff.ts';

function item(overrides: Partial<any> = {}) {
  return {
    id: 'a',
    node_path: 'src/api/',
    body: 'use exponential backoff with jitter',
    status: 'draft' as const,
    reinforcement_count: 1,
    last_seen_at: '2026-04-25T12:00:00.000Z',
    created_at: '2026-04-25T12:00:00.000Z',
    ...overrides,
  };
}

test('emits a "created" toast for new ids', () => {
  const toasts = diffWikiItems(new Map(), [item()]);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0]!.kind, 'created');
});

test('no toast when count unchanged', () => {
  const prev = new Map();
  applyWikiSnapshot(prev, [item()]);
  const toasts = diffWikiItems(prev, [item()]);
  assert.equal(toasts.length, 0);
});

test('"reinforced" toast when count goes up but still draft', () => {
  const prev = new Map();
  applyWikiSnapshot(prev, [item({ reinforcement_count: 1 })]);
  const toasts = diffWikiItems(prev, [item({ reinforcement_count: 2 })]);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0]!.kind, 'reinforced');
});

test('"promoted" toast when status flips draft → durable on a count-up', () => {
  const prev = new Map();
  applyWikiSnapshot(prev, [item({ reinforcement_count: 2, status: 'draft' })]);
  const toasts = diffWikiItems(prev, [item({ reinforcement_count: 3, status: 'durable' })]);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0]!.kind, 'promoted');
  assert.match(toasts[0]!.text, /promoted to durable/);
});

test('truncate adds ellipsis at the limit', () => {
  assert.equal(truncate('short', 10), 'short');
  const t = truncate('a'.repeat(120), 80);
  assert.equal(t.length, 80);
  assert.match(t, /…$/);
});

test('maxSince returns the latest last_seen_at', () => {
  const newer = item({ id: 'b', last_seen_at: '2026-04-26T00:00:00.000Z' });
  const older = item({ id: 'a', last_seen_at: '2026-04-24T00:00:00.000Z' });
  assert.equal(maxSince([older, newer], '2026-04-20T00:00:00.000Z'), '2026-04-26T00:00:00.000Z');
});

test('maxSince keeps current value when nothing newer', () => {
  assert.equal(
    maxSince([item({ last_seen_at: '2026-04-20T00:00:00.000Z' })], '2026-04-25T00:00:00.000Z'),
    '2026-04-25T00:00:00.000Z',
  );
});
