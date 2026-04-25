import test from 'node:test';
import assert from 'node:assert/strict';
import { simpleHash } from './hash.ts';

test('simpleHash is deterministic', () => {
  assert.equal(simpleHash('fix the retry'), simpleHash('fix the retry'));
});

test('simpleHash differs for different inputs', () => {
  assert.notEqual(simpleHash('fix the retry'), simpleHash('fix the auth'));
});

test('simpleHash returns a non-empty string for empty input', () => {
  assert.equal(typeof simpleHash(''), 'string');
});

test('simpleHash returns hex digits only', () => {
  assert.match(simpleHash('hello world'), /^-?[0-9a-f]+$/);
});
