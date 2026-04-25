// Tests for the trailhead-mcp init logic. Each test uses a fresh temp dir
// as $HOME so we never touch the real config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyInit, COACH_DIRECTIVE } from './init.mjs';

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'trailhead-init-'));
}

function makeCwd() {
  return mkdtempSync(join(tmpdir(), 'trailhead-cwd-'));
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

// Default opts skip the coach directive so existing tests keep working.
// New coach-related tests opt in explicitly.
const baseOpts = (home) => ({
  serverEntry: '/abs/path/server/index.ts',
  hookEntry: '/abs/path/trailhead-hook.mjs',
  apiUrl: 'https://api.example.com',
  teamToken: 'tok-123',
  anthropicKey: '',
  home,
  preservePaths: true,
  autoCoach: false,
});

test('creates ~/.claude.json with mcpServers.trailhead from scratch', async () => {
  const home = makeHome();
  try {
    const r = await applyInit(baseOpts(home));
    assert.equal(r.serverInstalled, 'created');
    const cfg = readJson(r.claudeJsonPath);
    assert.ok(cfg.mcpServers?.trailhead);
    assert.equal(cfg.mcpServers.trailhead.command, 'npx');
    assert.deepEqual(cfg.mcpServers.trailhead.args.slice(0, 2), ['--yes', 'tsx']);
    assert.equal(cfg.mcpServers.trailhead.env.TRAILHEAD_API_URL, 'https://api.example.com');
    assert.equal(cfg.mcpServers.trailhead.env.TRAILHEAD_TEAM_TOKEN, 'tok-123');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('preserves unrelated keys in ~/.claude.json', async () => {
  const home = makeHome();
  try {
    const claudeJsonPath = join(home, '.claude.json');
    writeFileSync(claudeJsonPath, JSON.stringify({
      mcpServers: { other: { command: 'echo', args: ['hi'] } },
      someOtherKey: 'preserve me',
    }));
    await applyInit(baseOpts(home));
    const cfg = readJson(claudeJsonPath);
    assert.equal(cfg.someOtherKey, 'preserve me');
    assert.ok(cfg.mcpServers.other);
    assert.ok(cfg.mcpServers.trailhead);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('idempotent — second run reports unchanged', async () => {
  const home = makeHome();
  try {
    const r1 = await applyInit(baseOpts(home));
    const r2 = await applyInit(baseOpts(home));
    assert.equal(r1.serverInstalled, 'created');
    assert.equal(r2.serverInstalled, 'unchanged');
    assert.equal(r2.hookInstalled, 'unchanged');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('changing apiUrl on second run reports updated', async () => {
  const home = makeHome();
  try {
    await applyInit(baseOpts(home));
    const r2 = await applyInit({ ...baseOpts(home), apiUrl: 'https://other.example.com' });
    assert.equal(r2.serverInstalled, 'updated');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('creates ~/.claude/settings.json with Stop hook', async () => {
  const home = makeHome();
  try {
    const r = await applyInit(baseOpts(home));
    assert.equal(r.hookInstalled, 'created');
    const settings = readJson(r.settingsJsonPath);
    assert.ok(Array.isArray(settings.hooks?.Stop));
    assert.equal(settings.hooks.Stop.length, 1);
    const cmd = settings.hooks.Stop[0].hooks[0].command;
    assert.match(cmd, /trailhead-hook\.mjs/);
    assert.match(cmd, /^node /);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('preserves existing Stop hooks added by the user', async () => {
  const home = makeHome();
  try {
    const settingsPath = join(home, '.claude', 'settings.json');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'my-other-hook.sh' }] }],
      },
    }));
    await applyInit(baseOpts(home));
    const settings = readJson(settingsPath);
    assert.equal(settings.hooks.Stop.length, 2, 'kept user hook AND added ours');
    const commands = settings.hooks.Stop.flatMap((b) => b.hooks).map((h) => h.command);
    assert.ok(commands.some((c) => c.includes('my-other-hook.sh')));
    assert.ok(commands.some((c) => c.includes('trailhead-hook.mjs')));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('does not duplicate the Stop hook on re-run', async () => {
  const home = makeHome();
  try {
    await applyInit(baseOpts(home));
    await applyInit(baseOpts(home));
    const settings = readJson(join(home, '.claude', 'settings.json'));
    const matches = settings.hooks.Stop.flatMap((b) => b.hooks)
      .filter((h) => h.command.includes('trailhead-hook.mjs'));
    assert.equal(matches.length, 1, 'only one trailhead Stop hook entry');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('writes ANTHROPIC_API_KEY into env when provided', async () => {
  const home = makeHome();
  try {
    await applyInit({ ...baseOpts(home), anthropicKey: 'sk-test-123' });
    const cfg = readJson(join(home, '.claude.json'));
    assert.equal(cfg.mcpServers.trailhead.env.ANTHROPIC_API_KEY, 'sk-test-123');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// --- Coach-directive (B.2) ---------------------------------------------------

test('autoCoach=true (default) creates ./CLAUDE.md with the directive', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const r = await applyInit({ ...baseOpts(home), autoCoach: true, cwd });
    assert.equal(r.projectCoachInstalled, 'created');
    assert.equal(r.userCoachInstalled, 'skipped');
    const projectPath = join(cwd, 'CLAUDE.md');
    assert.equal(r.projectClaudeMdPath, projectPath);
    assert.ok(existsSync(projectPath));
    const content = readFileSync(projectPath, 'utf8');
    assert.match(content, /## Trailhead coaching/);
    assert.match(content, /coach_score/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('autoCoach=true appends to existing ./CLAUDE.md without overwriting', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const projectPath = join(cwd, 'CLAUDE.md');
    writeFileSync(projectPath, '# Project conventions\n\nUse 2-space indents.\n');
    const r = await applyInit({ ...baseOpts(home), autoCoach: true, cwd });
    assert.equal(r.projectCoachInstalled, 'appended');
    const content = readFileSync(projectPath, 'utf8');
    assert.match(content, /Project conventions/);
    assert.match(content, /Use 2-space indents/);
    assert.match(content, /## Trailhead coaching/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('autoCoach=true is idempotent — second run reports unchanged', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const r1 = await applyInit({ ...baseOpts(home), autoCoach: true, cwd });
    const r2 = await applyInit({ ...baseOpts(home), autoCoach: true, cwd });
    assert.equal(r1.projectCoachInstalled, 'created');
    assert.equal(r2.projectCoachInstalled, 'unchanged');
    const content = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    const matches = content.match(/## Trailhead coaching/g) ?? [];
    assert.equal(matches.length, 1, 'directive heading appears exactly once');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('autoCoach=false (the --no-auto-coach flag) writes no CLAUDE.md', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const r = await applyInit({ ...baseOpts(home), autoCoach: false, cwd });
    assert.equal(r.projectCoachInstalled, 'skipped');
    assert.equal(r.projectClaudeMdPath, null);
    assert.equal(existsSync(join(cwd, 'CLAUDE.md')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('userScope=true writes both project and user CLAUDE.md', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const r = await applyInit({
      ...baseOpts(home), autoCoach: true, userScope: true, cwd,
    });
    assert.equal(r.projectCoachInstalled, 'created');
    assert.equal(r.userCoachInstalled, 'created');
    assert.equal(r.userClaudeMdPath, join(home, '.claude', 'CLAUDE.md'));
    const userContent = readFileSync(r.userClaudeMdPath, 'utf8');
    assert.match(userContent, /## Trailhead coaching/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('COACH_DIRECTIVE references the correct tool name (coach_score)', () => {
  // Underscore form is required — MCP tool names must match [a-zA-Z0-9_-]+,
  // and our index.ts registers `coach_score`. Keep the directive consistent.
  assert.match(COACH_DIRECTIVE, /coach_score/);
  assert.doesNotMatch(COACH_DIRECTIVE, /coach\.score/);
});
