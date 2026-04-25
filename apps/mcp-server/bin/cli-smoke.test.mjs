// Spawns `node bin/cli.mjs init` against a temporary $HOME and asserts that
// the config files are written. End-to-end verification that the CLI shim
// in cli.mjs correctly delegates to applyInit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = resolve(__dirname, 'cli.mjs');

test('`cli.mjs init` writes ~/.claude.json and ./CLAUDE.md', () => {
  const home = mkdtempSync(join(tmpdir(), 'trailhead-cli-smoke-'));
  try {
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,    // Windows
      TRAILHEAD_API_URL: 'https://test.example',
      TRAILHEAD_TEAM_TOKEN: 'tok-cli',
    };
    // cwd MUST be the temp home — autoCoach defaults to true, so init writes
    // ./CLAUDE.md in cwd. Without this, tests would pollute the repo root.
    const out = spawnSync(process.execPath, [cli, 'init'], { env, cwd: home, encoding: 'utf8' });
    assert.equal(out.status, 0, `cli exit ${out.status}\nstdout:\n${out.stdout}\nstderr:\n${out.stderr}`);
    assert.match(out.stdout, /MCP server registered/);
    assert.match(out.stdout, /Coach directive/);
    const claudeJson = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
    assert.equal(claudeJson.mcpServers.trailhead.env.TRAILHEAD_API_URL, 'https://test.example');
    assert.equal(claudeJson.mcpServers.trailhead.env.TRAILHEAD_TEAM_TOKEN, 'tok-cli');
    assert.ok(claudeJson.mcpServers.trailhead.args.some((a) => a.endsWith('index.ts')));
    // Project-scoped coach directive landed in cwd's CLAUDE.md.
    const claudeMd = readFileSync(join(home, 'CLAUDE.md'), 'utf8');
    assert.match(claudeMd, /## Trailhead coaching/);
    assert.match(claudeMd, /coach_score/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('`cli.mjs init --no-auto-coach` skips CLAUDE.md', () => {
  const home = mkdtempSync(join(tmpdir(), 'trailhead-cli-smoke-'));
  try {
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      TRAILHEAD_API_URL: 'https://test.example',
      TRAILHEAD_TEAM_TOKEN: 'tok-cli',
    };
    const out = spawnSync(
      process.execPath,
      [cli, 'init', '--no-auto-coach'],
      { env, cwd: home, encoding: 'utf8' },
    );
    assert.equal(out.status, 0);
    assert.match(out.stdout, /Coach directive skipped/);
    assert.equal(existsSync(join(home, 'CLAUDE.md')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('`cli.mjs init --user-scope` writes user CLAUDE.md too', () => {
  const home = mkdtempSync(join(tmpdir(), 'trailhead-cli-smoke-'));
  try {
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      TRAILHEAD_API_URL: 'https://test.example',
      TRAILHEAD_TEAM_TOKEN: 'tok-cli',
    };
    const out = spawnSync(
      process.execPath,
      [cli, 'init', '--user-scope'],
      { env, cwd: home, encoding: 'utf8' },
    );
    assert.equal(out.status, 0);
    const projectMd = readFileSync(join(home, 'CLAUDE.md'), 'utf8');
    const userMd = readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8');
    assert.match(projectMd, /## Trailhead coaching/);
    assert.match(userMd, /## Trailhead coaching/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('`cli.mjs help` exits 0', () => {
  const out = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /trailhead-mcp/);
});

test('`cli.mjs unknown` exits non-zero', () => {
  const out = spawnSync(process.execPath, [cli, 'gibberish'], { encoding: 'utf8' });
  assert.notEqual(out.status, 0);
});
