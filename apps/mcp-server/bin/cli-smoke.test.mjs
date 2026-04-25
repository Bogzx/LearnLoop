// Spawns `node bin/cli.mjs init` against a temporary $HOME and asserts that
// the config files are written. End-to-end verification of the CLI shim,
// including token derivation and the new project-scoped .mcp.json behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = resolve(__dirname, 'cli.mjs');

// Helper: build the env so the CLI's token derivation lands on the explicit
// flag rather than the dev machine's git remote, and HOME points at the
// temp dir.
function envFor(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    // Don't leak the dev machine's TRAILHEAD_TEAM_TOKEN into the test.
    TRAILHEAD_TEAM_TOKEN: undefined,
    TRAILHEAD_API_URL: undefined,
  };
}

test('`cli.mjs init --team-token` writes per-repo .mcp.json + ./CLAUDE.md', () => {
  const home = mkdtempSync(join(tmpdir(), 'trailhead-cli-smoke-'));
  try {
    const out = spawnSync(
      process.execPath,
      [
        cli,
        'init',
        '--no-copilot',
        '--team-token', 'tok-cli',
        '--api-url', 'https://test.example',
      ],
      { env: envFor(home), cwd: home, encoding: 'utf8' },
    );
    assert.equal(out.status, 0, `cli exit ${out.status}\nstdout:\n${out.stdout}\nstderr:\n${out.stderr}`);
    assert.match(out.stdout, /Token: tok-cli/);
    assert.match(out.stdout, /project MCP config/);
    assert.match(out.stdout, /Coach directive/);

    // Project-scoped .mcp.json — the new default.
    const mcp = JSON.parse(readFileSync(join(home, '.mcp.json'), 'utf8'));
    assert.equal(mcp.mcpServers.trailhead.env.TRAILHEAD_API_URL, 'https://test.example');
    assert.equal(mcp.mcpServers.trailhead.env.TRAILHEAD_TEAM_TOKEN, 'tok-cli');
    assert.ok(mcp.mcpServers.trailhead.args.some((a) => a.endsWith('index.ts')));

    // Default (no --user-scope, no legacy entry): ~/.claude.json untouched.
    assert.equal(existsSync(join(home, '.claude.json')), false);

    // Coach directive landed.
    const claudeMd = readFileSync(join(home, 'CLAUDE.md'), 'utf8');
    assert.match(claudeMd, /## Trailhead coaching/);
    assert.match(claudeMd, /\bcoach\b/);
    assert.match(claudeMd, /\bwiki_lookup\b/);
    assert.match(claudeMd, /\bwiki_save\b/);
    assert.match(claudeMd, /\bwiki_bootstrap\b/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('`cli.mjs init --no-auto-coach` skips CLAUDE.md', () => {
  const home = mkdtempSync(join(tmpdir(), 'trailhead-cli-smoke-'));
  try {
    const out = spawnSync(
      process.execPath,
      [cli, 'init', '--no-auto-coach', '--no-copilot', '--team-token', 'tok-cli'],
      { env: envFor(home), cwd: home, encoding: 'utf8' },
    );
    assert.equal(out.status, 0);
    assert.match(out.stdout, /Coach directive skipped/);
    assert.equal(existsSync(join(home, 'CLAUDE.md')), false);
    // .mcp.json still written — only the directive is suppressed.
    assert.ok(existsSync(join(home, '.mcp.json')));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('`cli.mjs init --user-scope` writes user-scope ~/.claude.json + ~/.claude/CLAUDE.md', () => {
  const home = mkdtempSync(join(tmpdir(), 'trailhead-cli-smoke-'));
  try {
    const out = spawnSync(
      process.execPath,
      [cli, 'init', '--user-scope', '--no-copilot', '--team-token', 'tok-cli'],
      { env: envFor(home), cwd: home, encoding: 'utf8' },
    );
    assert.equal(out.status, 0);
    const claudeJson = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
    assert.equal(claudeJson.mcpServers.trailhead.env.TRAILHEAD_TEAM_TOKEN, 'tok-cli');
    const projectMd = readFileSync(join(home, 'CLAUDE.md'), 'utf8');
    const userMd = readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8');
    assert.match(projectMd, /## Trailhead coaching/);
    assert.match(userMd, /## Trailhead coaching/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('`cli.mjs init` wires Copilot when .vscode/ exists', () => {
  const home = mkdtempSync(join(tmpdir(), 'trailhead-cli-smoke-'));
  try {
    mkdirSync(join(home, '.vscode'), { recursive: true });
    const out = spawnSync(
      process.execPath,
      [cli, 'init', '--no-claude-code', '--team-token', 'tok-cli'],
      { env: envFor(home), cwd: home, encoding: 'utf8' },
    );
    assert.equal(out.status, 0, `cli exit ${out.status}\nstdout:\n${out.stdout}\nstderr:\n${out.stderr}`);
    assert.match(out.stdout, /Copilot: MCP server registered/);
    const mcp = JSON.parse(readFileSync(join(home, '.vscode', 'mcp.json'), 'utf8'));
    assert.equal(mcp.servers.trailhead.command, 'npx');
    assert.equal(mcp.servers.trailhead.env.TRAILHEAD_TEAM_TOKEN, 'tok-cli');
    const instructions = readFileSync(
      join(home, '.github', 'copilot-instructions.md'),
      'utf8',
    );
    assert.match(instructions, /## Trailhead coaching/);
    assert.match(instructions, /\bcoach\b/);
    assert.equal(existsSync(join(home, '.claude.json')), false);
    assert.equal(existsSync(join(home, '.mcp.json')), false);
    assert.equal(existsSync(join(home, 'CLAUDE.md')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('`cli.mjs init` auto-derives a token when no flag/env given (sentinel fallback)', () => {
  const home = mkdtempSync(join(tmpdir(), 'trailhead-cli-smoke-'));
  try {
    // No --team-token; no env; no .git in cwd → derivation should fall back
    // to the random `repo_local_*` sentinel and write `.trailhead-team`.
    const out = spawnSync(
      process.execPath,
      [cli, 'init', '--no-copilot'],
      { env: envFor(home), cwd: home, encoding: 'utf8' },
    );
    assert.equal(out.status, 0, `cli exit ${out.status}\nstdout:\n${out.stdout}\nstderr:\n${out.stderr}`);
    // Sentinel created.
    assert.ok(existsSync(join(home, '.trailhead-team')));
    const sentinel = readFileSync(join(home, '.trailhead-team'), 'utf8').trim();
    assert.match(sentinel, /^repo_local_[0-9a-f]+$/);
    // .gitignore appended.
    const gi = readFileSync(join(home, '.gitignore'), 'utf8');
    assert.match(gi, /\.trailhead-team/);
    // Token in .mcp.json matches sentinel.
    const mcp = JSON.parse(readFileSync(join(home, '.mcp.json'), 'utf8'));
    assert.equal(mcp.mcpServers.trailhead.env.TRAILHEAD_TEAM_TOKEN, sentinel);
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
