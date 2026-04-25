// Spawns `node bin/cli.mjs init` against a temporary $HOME and asserts that
// both config files are written. End-to-end verification that the CLI shim
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

test('`cli.mjs init` writes ~/.claude.json and ~/.claude/settings.json', () => {
  const home = mkdtempSync(join(tmpdir(), 'trailhead-cli-smoke-'));
  try {
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,    // Windows
      TRAILHEAD_API_URL: 'https://test.example',
      TRAILHEAD_TEAM_TOKEN: 'tok-cli',
      ANTHROPIC_API_KEY: '',
    };
    const out = spawnSync(process.execPath, [cli, 'init'], { env, encoding: 'utf8' });
    assert.equal(out.status, 0, `cli exit ${out.status}\nstdout:\n${out.stdout}\nstderr:\n${out.stderr}`);
    assert.match(out.stdout, /MCP server registered/);
    assert.match(out.stdout, /Stop hook registered/);
    const claudeJson = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
    assert.equal(claudeJson.mcpServers.trailhead.env.TRAILHEAD_API_URL, 'https://test.example');
    assert.equal(claudeJson.mcpServers.trailhead.env.TRAILHEAD_TEAM_TOKEN, 'tok-cli');
    assert.ok(claudeJson.mcpServers.trailhead.args.some((a) => a.endsWith('index.ts')));
    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    const cmd = settings.hooks.Stop[0].hooks[0].command;
    assert.match(cmd, /trailhead-hook\.mjs/);
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
