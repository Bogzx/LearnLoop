// Regression tests for the bubble classifier.
//
// The bug: classifyBubble used to return a role when the selector matched the
// node ITSELF *or* anything in its subtree (`node.querySelector(sel)`). Since
// the content script walked the DOM outermost-first and deliberately let the
// outermost match win, the first wrapper div that happened to contain a user
// message classified as a user bubble — and swallowed the whole conversation.
// On claude.ai that wrapper is somewhere around the thread container, so in
// practice the entire thread got tagged as one bubble and every per-message
// widget (score badge, outcome rating, prompt diff) mounted once, on the wrong
// element.
//
// classifyBubble only calls `node.matches(...)`, so these tests use a tiny
// stub element rather than pulling in a DOM implementation.
//
// Run: npm --workspace=apps/browser-ext test

import test from 'node:test';
import assert from 'node:assert/strict';
import { BUBBLE_HINT_SELECTOR, classifyBubble } from './selectors.ts';

/**
 * Minimal Element stand-in. `matches` returns true for any selector in
 * `selfMatches`; `querySelector` returns a truthy value for anything in
 * `descendantMatches` — which is exactly the trap the old implementation fell
 * into and the new one must ignore.
 */
function stubElement(selfMatches: string[], descendantMatches: string[] = []) {
  return {
    matches: (sel: string) => selfMatches.includes(sel),
    querySelector: (sel: string) => (descendantMatches.includes(sel) ? {} : null),
  } as unknown as Element;
}

test('classifies a user bubble by its own attribute', () => {
  assert.equal(classifyBubble(stubElement(['[data-testid="user-message"]'])), 'user');
});

test('classifies an assistant bubble by its own attribute', () => {
  assert.equal(
    classifyBubble(stubElement(['[data-testid="assistant-message"]'])),
    'assistant',
  );
});

// ---------------------------------------------------------------------------
// The regression. A container that merely CONTAINS a user message is not a
// user bubble. Under the old implementation this returned 'user'.
// ---------------------------------------------------------------------------
test('a wrapper containing a user bubble is NOT itself classified as one', () => {
  const wrapper = stubElement([], ['[data-testid="user-message"]']);
  assert.equal(
    classifyBubble(wrapper),
    'unknown',
    'a container that merely contains a user message must not be tagged as a bubble',
  );
});

test('a wrapper containing an assistant bubble is NOT itself classified as one', () => {
  const wrapper = stubElement([], ['[data-testid="assistant-message"]']);
  assert.equal(classifyBubble(wrapper), 'unknown');
});

test('the thread container — which contains both roles — stays unknown', () => {
  // This is the element that used to swallow the entire conversation.
  const thread = stubElement([], [
    '[data-testid="user-message"]',
    '[data-testid="assistant-message"]',
  ]);
  assert.equal(classifyBubble(thread), 'unknown');
});

test('an unrelated element is unknown', () => {
  assert.equal(classifyBubble(stubElement(['div.sidebar'])), 'unknown');
});

test('user wins over assistant when an element somehow matches both', () => {
  // Deterministic precedence matters: the outcome-rating widget looks
  // backwards for the previous *user* bubble, so a flapping classification
  // would attach ratings to the wrong message.
  const both = stubElement(['[data-testid*="user"]', '[data-testid*="assistant"]']);
  assert.equal(classifyBubble(both), 'user');
});

test('classifyBubble tolerates an element without matches()', () => {
  // Text nodes and some SVG elements reach this path in the wild.
  const bare = {} as unknown as Element;
  assert.equal(classifyBubble(bare), 'unknown');
});

test('BUBBLE_HINT_SELECTOR is a valid non-empty selector list covering both roles', () => {
  assert.ok(BUBBLE_HINT_SELECTOR.length > 0);
  assert.ok(BUBBLE_HINT_SELECTOR.includes('[data-testid="user-message"]'));
  assert.ok(BUBBLE_HINT_SELECTOR.includes('[data-testid="assistant-message"]'));
  // Comma-joined so it can be handed straight to querySelectorAll.
  const parts = BUBBLE_HINT_SELECTOR.split(',');
  assert.ok(parts.length >= 12, `expected all hints, got ${parts.length}`);
  for (const p of parts) assert.ok(p.trim().length > 0, 'no empty selector fragments');
});
