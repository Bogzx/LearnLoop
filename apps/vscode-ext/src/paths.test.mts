import test from 'node:test';
import assert from 'node:assert/strict';
import { toFolderPath } from './paths-pure.ts';

test('strips file portion and keeps trailing slash', () => {
  assert.equal(toFolderPath('src/api/webhooks/handler.ts'), 'src/api/webhooks/');
});

test('handles backslashes (Windows)', () => {
  assert.equal(toFolderPath('src\\api\\webhooks\\handler.ts'), 'src/api/webhooks/');
});

test('strips leading "./"', () => {
  assert.equal(toFolderPath('./src/api/'), 'src/api/');
});

test('returns empty for files at workspace root', () => {
  assert.equal(toFolderPath('package.json'), '');
});

test('returns empty for empty input', () => {
  assert.equal(toFolderPath(''), '');
});
