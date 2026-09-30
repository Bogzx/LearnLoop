// Rich bootstrap must not upload files git ignores (they go to the API and on
// to Gemini). Uses a real temp git repo so git's own rules decide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverFiles, withoutGitIgnored } from './bootstrap.ts';

function fixture(git: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'trailhead-bootstrap-'));
  if (git) execFileSync('git', ['init', '-q'], { cwd: dir });
  mkdirSync(join(dir, 'src', 'secret'), { recursive: true });
  mkdirSync(join(dir, 'src', 'nested'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{}');
  writeFileSync(join(dir, 'src', 'app.ts'), 'export const a = 1;');
  writeFileSync(join(dir, 'src', 'local.config.ts'), 'export const key = "sk-live-…";');
  writeFileSync(join(dir, 'src', 'secret', 'creds.ts'), 'export const pw = "hunter2";');
  writeFileSync(join(dir, 'src', 'nested', 'keep.ts'), 'export const k = 1;');
  writeFileSync(join(dir, 'src', 'nested', 'scratch.ts'), 'export const s = 1;');
  writeFileSync(join(dir, '.gitignore'), 'src/secret/\n*.config.ts\n');
  writeFileSync(join(dir, 'src', 'nested', '.gitignore'), 'scratch.ts\n');
  return dir;
}

test('discoverFiles skips everything git ignores (root and nested .gitignore)', () => {
  const dir = fixture(true);
  try {
    assert.deepEqual(discoverFiles(dir), ['src/app.ts', 'src/nested/keep.ts']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('outside a git repo nothing is filtered', () => {
  const dir = fixture(false);
  try {
    const files = discoverFiles(dir);
    assert.ok(files.includes('src/secret/creds.ts'));
    assert.ok(files.includes('src/local.config.ts'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withoutGitIgnored is a no-op for an empty list', () => {
  assert.deepEqual(withoutGitIgnored(tmpdir(), []), []);
});
