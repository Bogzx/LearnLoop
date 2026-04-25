import test from 'node:test';
import assert from 'node:assert/strict';
import { diffWikiItem } from './wiki-toast.ts';
import type { WikiRecentItem } from '@trailhead/shared';

function item(overrides: Partial<WikiRecentItem> = {}): WikiRecentItem {
  return {
    id: 'a',
    node_path: 'src/api/',
    body: 'use exponential backoff with jitter',
    status: 'draft',
    reinforcement_count: 1,
    last_seen_at: '2026-04-25T12:00:00.000Z',
    created_at: '2026-04-25T12:00:00.000Z',
    ...overrides,
  };
}

test('diffWikiItem creates a toast for a new item', () => {
  const out = diffWikiItem(undefined, item());
  assert.ok(out);
  assert.equal(out.kind, 'created');
  assert.match(out.text, /Wiki created/);
});

test('diffWikiItem returns null when nothing changes', () => {
  const prev = item({ reinforcement_count: 2 });
  const next = item({ reinforcement_count: 2 });
  assert.equal(diffWikiItem(prev, next), null);
});

test('diffWikiItem reports reinforcement when count increases but still draft', () => {
  const out = diffWikiItem(item({ reinforcement_count: 1 }), item({ reinforcement_count: 2 }));
  assert.ok(out);
  assert.equal(out.kind, 'reinforced');
  assert.match(out.text, /2\/3/);
});

test('diffWikiItem reports promotion on draft → durable', () => {
  const out = diffWikiItem(
    item({ reinforcement_count: 2, status: 'draft' }),
    item({ reinforcement_count: 3, status: 'durable' }),
  );
  assert.ok(out);
  assert.equal(out.kind, 'promoted');
});
