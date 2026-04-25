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
  apiUrl: 'https://api.example.com',
  teamToken: 'tok-123',
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
