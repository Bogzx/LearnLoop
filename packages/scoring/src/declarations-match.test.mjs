// Verifies that every hand-written .d.mts declaration matches the .mjs it
// claims to describe.
//
// Why this exists: the runtime helpers in this package are .mjs (so the Stop
// hook and other plain-ESM consumers can import them with no build step), and
// each one has a hand-written .d.mts sitting next to it. TypeScript resolves
// importers to the .d.mts and never compares it against the .mjs, so the two
// could disagree indefinitely and every typecheck in the repo would still pass
// — a declared export that doesn't exist gives consumers a value that is
// `undefined` at runtime with no compile-time warning anywhere.
//
// This test closes that gap the direct way: parse the value-level exports out
// of each declaration, import the implementation, and assert the two sets are
// equal in both directions.
//
// Run: npm --workspace=packages/scoring test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Value-level exports declared in a .d.mts — the ones that must exist at
 * runtime. `export interface` / `export type` are type-only and are
 * deliberately excluded.
 *
 * @param {string} source
 * @returns {Set<string>}
 */
function declaredValueExports(source) {
  const names = new Set();
  const patterns = [
    /^export\s+declare\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^export\s+declare\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    /^export\s+declare\s+class\s+([A-Za-z_$][\w$]*)/gm,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) names.add(m[1]);
  }
  return names;
}

const declarationFiles = readdirSync(HERE)
  .filter((f) => f.endsWith('.d.mts'))
  .sort();

test('the package actually has declaration files to check', () => {
  // Guards against this whole suite silently passing if the files move.
  assert.ok(declarationFiles.length >= 8, `found only ${declarationFiles.length} .d.mts files`);
});

for (const decl of declarationFiles) {
  const impl = decl.replace(/\.d\.mts$/, '.mjs');

  test(`${decl} matches ${impl}`, async () => {
    const source = readFileSync(join(HERE, decl), 'utf8');
    const declared = declaredValueExports(source);

    const mod = await import(pathToFileURL(join(HERE, impl)).href);
    const actual = new Set(Object.keys(mod));

    const missing = [...declared].filter((n) => !actual.has(n));
    assert.deepEqual(
      missing,
      [],
      `${decl} declares ${missing.join(', ')} but ${impl} does not export it — ` +
        `consumers would get undefined at runtime with no type error`,
    );

    const undeclared = [...actual].filter((n) => !declared.has(n));
    assert.deepEqual(
      undeclared,
      [],
      `${impl} exports ${undeclared.join(', ')} but ${decl} does not declare it — ` +
        `the export is invisible to every TypeScript consumer`,
    );
  });
}

test('models.mjs exports the model ids the API and README both cite', async () => {
  // These strings are load-bearing: gemini.ts routes on them and the README
  // documents them. A silent rename here is a production incident.
  /** @type {Record<string, unknown>} */
  const models = await import('./models.mjs');
  for (const k of ['SCORE_MODEL', 'TOPIC_MODEL', 'DIFF_MODEL', 'EXTRACT_MODEL']) {
    const v = models[k];
    assert.equal(typeof v, 'string', `${k} must be a string`);
    assert.ok(/** @type {string} */ (v).length > 0, `${k} must not be empty`);
  }
});
