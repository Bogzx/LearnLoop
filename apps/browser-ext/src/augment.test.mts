import test from 'node:test';
import assert from 'node:assert/strict';
import { augment } from './augment.ts';

test('augment includes the original prompt verbatim', () => {
  const out = augment('fix the retry', {
    context_loading: 'no file referenced',
  });
  assert.match(out, /^fix the retry/);
});

test('augment lists a single missing dimension by name', () => {
  const out = augment('fix the retry', {
    context_loading: 'no file referenced',
  });
  assert.match(out, /missing context loading/);
});

test('augment joins two missing dimensions with "and"', () => {
  const out = augment('fix the retry', {
    context_loading: 'no file referenced',
    constraint_articulation: 'no constraints stated',
  });
  assert.match(out, /context loading and constraint articulation/);
});

test('augment joins three+ with comma list and final "and"', () => {
  const out = augment('fix the retry', {
    context_loading: 'a',
    constraint_articulation: 'b',
    output_specification: 'c',
  });
  assert.match(out, /context loading, constraint articulation and output specification/);
});

test('augment falls back to a generic phrase when no missing dimensions are passed', () => {
  const out = augment('fix the retry', {});
  assert.match(out, /a few key dimensions/);
});

test('augment includes the Trailhead coaching marker', () => {
  const out = augment('fix the retry', { context_loading: 'x' });
  assert.match(out, /\[Trailhead coaching:/);
  assert.match(out, /Only proceed once these are clarified\.\]$/);
});
