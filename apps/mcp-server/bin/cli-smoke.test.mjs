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
    TRAILHEAD_ADMIN_TOKEN: undefined,
    // A port nothing listens on, so `init` takes its offline path instead of
    // talking to whatever API the dev machine happens to run on :3000.
    TRAILHEAD_API_URL: 'http://127.0.0.1:9',
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
    // The secret is masked on screen and kept out of the generated config.
    assert.match(out.stdout, /Secret: tok-…/);
    assert.doesNotMatch(out.stdout, /tok-cli/);
    assert.match(out.stdout, /project MCP config/);
    assert.match(out.stdout, /Coach directive/);

    // Project-scoped .mcp.json — the new default.
    const mcp = JSON.parse(readFileSync(join(home, '.mcp.json'), 'utf8'));
    assert.equal(mcp.mcpServers.trailhead.env.TRAILHEAD_API_URL, 'https://test.example');
    assert.equal(mcp.mcpServers.trailhead.env.TRAILHEAD_TEAM_TOKEN, undefined);
    assert.equal(mcp.mcpServers.trailhead.env.TRAILHEAD_TEAM_FILE, '.trailhead-team');
    assert.doesNotMatch(readFileSync(join(home, '.mcp.json'), 'utf8'), /tok-cli/);
    assert.equal(readFileSync(join(home, '.trailhead-team'), 'utf8').trim(), 'tok-cli');
    assert.match(readFileSync(join(home, '.gitignore'), 'utf8'), /^\.trailhead-team$/m);
    // the generated config points at this machine's clone, so init ignores it
    assert.match(readFileSync(join(home, '.gitignore'), 'utf8'), /^\.mcp\.json$/m);
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
    assert.equal(claudeJson.mcpServers.trailhead.env.TRAILHEAD_TEAM_FILE, '.trailhead-team');
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
    assert.equal(mcp.servers.trailhead.env.TRAILHEAD_TEAM_FILE, '.trailhead-team');
    assert.equal(mcp.servers.trailhead.env.TRAILHEAD_TEAM_TOKEN, undefined);
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

test('`cli.mjs init` with no credential and no reachable API fails loudly and writes nothing', () => {
  const home = mkdtempSync(join(tmpdir(), 'trailhead-cli-smoke-'));
  try {
    // No --team-token, no env, no sentinel: init must register a team, which
    // needs the API. It used to invent a random token offline; now it stops
    // and says how to fix it rather than wiring a credential nobody issued.
    const out = spawnSync(
      process.execPath,
      [cli, 'init', '--no-copilot'],
      { env: envFor(home), cwd: home, encoding: 'utf8' },
    );
    assert.equal(out.status, 1, `cli exit ${out.status}\nstdout:\n${out.stdout}\nstderr:\n${out.stderr}`);
    assert.match(out.stderr, /Can't reach the Trailhead API at http:\/\/127\.0\.0\.1:9/);
    assert.match(out.stderr, /--team-token <secret>/);
    assert.equal(existsSync(join(home, '.mcp.json')), false);
    assert.equal(existsSync(join(home, '.trailhead-team')), false);
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
