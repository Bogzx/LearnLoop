// Tests for the trailhead-mcp init logic. Each test uses a fresh temp dir
// as $HOME so we never touch the real config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyInit } from './init.mjs';

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'trailhead-init-'));
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

const baseOpts = (home) => ({
  serverEntry: '/abs/path/server/index.ts',
  hookEntry: '/abs/path/trailhead-hook.mjs',
  apiUrl: 'https://api.example.com',
  teamToken: 'tok-123',
  anthropicKey: '',
  home,
  preservePaths: true,
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
