import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './normalize.mjs';

test('lowercases and strips punctuation', () => {
  assert.equal(normalize('We Always Use Backoff!'), 'we always use backoff');
});

test('collapses whitespace', () => {
  assert.equal(normalize('use   exp   backoff'), 'use exp backoff');
});

test('trims leading/trailing whitespace', () => {
  assert.equal(normalize('   hello world   '), 'hello world');
});

test('strips quotes, commas, colons, semicolons, parens', () => {
  assert.equal(
    normalize('"Use exponential backoff (with jitter), idempotent: true; ok?"'),
    'use exponential backoff with jitter idempotent true ok',
  );
});

test('two equivalent insights normalize to the same string (the dedup invariant)', () => {
  const a = "We always use exponential backoff with jitter.";
  const b = "we ALWAYS use exponential backoff, with jitter!";
  assert.equal(normalize(a), normalize(b));
});

test('different insights normalize to different strings', () => {
  const a = normalize('use exponential backoff');
  const b = normalize('use linear backoff');
  assert.notEqual(a, b);
});

test('preserves digits', () => {
  assert.equal(normalize('Retry up to 3 times.'), 'retry up to 3 times');
});

test('handles emoji / non-ASCII gracefully', () => {
  // Letters from non-ASCII alphabets are preserved (unicode \p{L}); emoji
  // (which are \p{So} symbols) are stripped.
  assert.equal(normalize('café 🚀 résumé'), 'café résumé');
});
