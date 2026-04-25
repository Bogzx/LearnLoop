// Tests for the trailhead-mcp init logic. Each test uses a fresh temp dir
// as $HOME so we never touch the real config.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
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

// Default opts skip the coach directive so existing tests keep working,
// and skip Copilot wiring so tests that focus on Claude Code don't get
// noise from the dev machine's PATH detection.
// New coach-related tests opt in explicitly.
const baseOpts = (home) => ({
  serverEntry: '/abs/path/server/index.ts',
  apiUrl: 'https://api.example.com',
  teamToken: 'tok-123',
  home,
  preservePaths: true,
  autoCoach: false,
  wireCopilot: false,
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
    assert.match(content, /\bcoach\b/);
    assert.match(content, /\bwiki_lookup\b/);
    assert.match(content, /\bwiki_save\b/);
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

test('COACH_DIRECTIVE references the 4 hero tool names', () => {
  // The directive (loaded from src/coaching-directive.md) must mention all
  // four hero tools by their MCP wire names, since these are what the
  // host LLM sees in the tool list.
  assert.match(COACH_DIRECTIVE, /\bcoach\b/);
  assert.match(COACH_DIRECTIVE, /\bwiki_lookup\b/);
  assert.match(COACH_DIRECTIVE, /\bwiki_save\b/);
  assert.match(COACH_DIRECTIVE, /\bwiki_bootstrap\b/);
  // Old names must be gone — referencing them confuses Copilot's tool selector.
  assert.doesNotMatch(COACH_DIRECTIVE, /coach_score/);
  assert.doesNotMatch(COACH_DIRECTIVE, /wiki_update_learnings/);
  assert.doesNotMatch(COACH_DIRECTIVE, /wiki_context_for/);
});

// --- Copilot wiring (new in mcp-plugin-ux-design.md §5) ----------------------

test('wireCopilot=true writes .vscode/mcp.json and .github/copilot-instructions.md', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const r = await applyInit({
      ...baseOpts(home),
      autoCoach: true,
      cwd,
      wireCopilot: true,
      // Force-detect by setting one of the env vars detectCopilot looks at.
      // Otherwise we'd rely on the dev machine's PATH for the `code` binary.
    });
    // The detection has to match — if it didn't, copilot will be { wired: false }
    // and the test should still pass on dev machines where `code` is in PATH.
    if (r.copilot.wired) {
      assert.equal(r.copilot.mcpJsonInstalled, 'created');
      assert.ok(existsSync(join(cwd, '.vscode', 'mcp.json')));
      const mcp = JSON.parse(readFileSync(join(cwd, '.vscode', 'mcp.json'), 'utf8'));
      assert.equal(mcp.servers.trailhead.command, 'npx');
      assert.equal(mcp.servers.trailhead.env.TRAILHEAD_API_URL, 'https://api.example.com');
      assert.equal(mcp.servers.trailhead.env.TRAILHEAD_TEAM_TOKEN, 'tok-123');
      assert.equal(r.copilot.instructionsInstalled, 'created');
      const instructions = readFileSync(
        join(cwd, '.github', 'copilot-instructions.md'),
        'utf8',
      );
      assert.match(instructions, /## Trailhead coaching/);
      assert.match(instructions, /\bcoach\b/);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('wireCopilot=true is idempotent — second run reports unchanged', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    // Force Copilot detection by creating .vscode/ in cwd.
    mkdirSync(join(cwd, '.vscode'), { recursive: true });
    const opts = { ...baseOpts(home), autoCoach: true, cwd, wireCopilot: true };
    const r1 = await applyInit(opts);
    const r2 = await applyInit(opts);
    assert.equal(r1.copilot.wired, true);
    assert.equal(r1.copilot.mcpJsonInstalled, 'created');
    assert.equal(r2.copilot.mcpJsonInstalled, 'unchanged');
    assert.equal(r2.copilot.instructionsInstalled, 'unchanged');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('wireCopilot=false skips Copilot wiring', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    // Force-detect Copilot — would normally write — but the flag overrides.
    mkdirSync(join(cwd, '.vscode'), { recursive: true });
    const r = await applyInit({
      ...baseOpts(home),
      autoCoach: true,
      cwd,
      wireCopilot: false,
    });
    assert.equal(r.copilot.wired, false);
    assert.equal(existsSync(join(cwd, '.vscode', 'mcp.json')), false);
    assert.equal(existsSync(join(cwd, '.github', 'copilot-instructions.md')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('wireClaudeCode=false skips Claude Code wiring', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const r = await applyInit({
      ...baseOpts(home),
      autoCoach: true,
      cwd,
      wireClaudeCode: false,
    });
    assert.equal(r.claudeCode.wired, false);
    assert.equal(existsSync(join(home, '.claude.json')), false);
    assert.equal(existsSync(join(cwd, 'CLAUDE.md')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('directive section is replaced (not duplicated) when src/coaching-directive.md changes', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    // First run with one directive text.
    const opts1 = {
      ...baseOpts(home),
      autoCoach: true,
      cwd,
      directiveText: '## Trailhead coaching v1\n\nfirst version body\n',
    };
    await applyInit(opts1);
    const after1 = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    assert.match(after1, /first version body/);

    // Second run with a different directive — section must be replaced.
    const opts2 = {
      ...opts1,
      directiveText: '## Trailhead coaching v2\n\nSECOND version body\n',
    };
    const r2 = await applyInit(opts2);
    assert.equal(r2.projectCoachInstalled, 'replaced');
    const after2 = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    assert.match(after2, /SECOND version body/);
    assert.doesNotMatch(after2, /first version body/);
    // No duplication.
    const matches = after2.match(/## Trailhead coaching/g) ?? [];
    assert.equal(matches.length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});
