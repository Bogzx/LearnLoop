// The landing page (apps/landing-page, static files, no build step) runs the
// rule-based scorer in the browser from its own copy. This keeps the copy
// byte-identical to the source, so the demo never drifts from what the API's
// offline mode and the eval baseline measure.
//
// Fix a failure with:
//   cp packages/scoring/src/heuristic-score.mjs apps/landing-page/assets/heuristic-score.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

test('apps/landing-page/assets/heuristic-score.js is a byte-identical copy of heuristic-score.mjs', () => {
  const source = readFileSync(resolve(HERE, 'heuristic-score.mjs'));
  const copy = readFileSync(resolve(HERE, '../../../apps/landing-page/assets/heuristic-score.js'));
  assert.ok(source.equals(copy), 'copy is out of date: cp packages/scoring/src/heuristic-score.mjs apps/landing-page/assets/heuristic-score.js');
});
