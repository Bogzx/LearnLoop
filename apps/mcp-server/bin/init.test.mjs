// Tests for the trailhead-mcp init logic. Each test uses fresh temp dirs as
// $HOME and cwd so we never touch real config or pollute the repo.
//
// Multi-tenant init (per docs/superpowers/specs/2026-04-25-mcp-plugin-ux-design.md
// follow-up):
//   - Always writes project-scoped ./.mcp.json for Claude Code.
//   - Writes ~/.claude.json only if a trailhead entry already exists OR
//     userScope is true (Q2 c).
//   - Always writes .vscode/mcp.json for Copilot when detected.
//   - Coach directive: ./CLAUDE.md (project) and optionally
//     ~/.claude/CLAUDE.md (--user-scope).
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
import { join } from 'node:path';
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

// Default opts: skip the directive write (autoCoach false) and skip Copilot
// (wireCopilot false) so each test focuses on one slice. Tests that need
// those behaviors opt in explicitly.
const baseOpts = (home, cwd) => ({
  serverEntry: '/abs/path/server/index.ts',
  apiUrl: 'https://api.example.com',
  teamToken: 'tok-123',
  home,
  cwd,
  preservePaths: true,
  autoCoach: false,
  wireCopilot: false,
});

// ---------------------------------------------------------------------------
// Project-scoped .mcp.json (the new default)
// ---------------------------------------------------------------------------

test('writes project-scoped .mcp.json from scratch; does not touch ~/.claude.json', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const r = await applyInit(baseOpts(home, cwd));
    assert.equal(r.claudeCode.wired, true);
    assert.equal(r.claudeCode.projectMcpInstalled, 'created');
    assert.equal(r.claudeCode.projectMcpJsonPath, join(cwd, '.mcp.json'));
    assert.equal(r.claudeCode.userServerInstalled, 'skipped');
    assert.equal(r.claudeCode.claudeJsonPath, null);
    assert.equal(existsSync(join(home, '.claude.json')), false);

    const cfg = readJson(join(cwd, '.mcp.json'));
    assert.equal(cfg.mcpServers.trailhead.command, 'npx');
    assert.deepEqual(cfg.mcpServers.trailhead.args.slice(0, 2), ['--yes', 'tsx']);
    assert.equal(cfg.mcpServers.trailhead.env.TRAILHEAD_API_URL, 'https://api.example.com');
    assert.equal(cfg.mcpServers.trailhead.env.TRAILHEAD_TEAM_TOKEN, 'tok-123');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('idempotent — second run reports unchanged for .mcp.json', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const r1 = await applyInit(baseOpts(home, cwd));
    const r2 = await applyInit(baseOpts(home, cwd));
    assert.equal(r1.claudeCode.projectMcpInstalled, 'created');
    assert.equal(r2.claudeCode.projectMcpInstalled, 'unchanged');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('changing apiUrl on second run reports updated', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    await applyInit(baseOpts(home, cwd));
    const r2 = await applyInit({ ...baseOpts(home, cwd), apiUrl: 'https://other.example.com' });
    assert.equal(r2.claudeCode.projectMcpInstalled, 'updated');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// User-scoped ~/.claude.json — Q2 (c) conditional behavior
// ---------------------------------------------------------------------------

test('legacy ~/.claude.json with trailhead entry IS updated automatically', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    // Simulate a legacy install: ~/.claude.json already has a trailhead entry.
    const claudeJsonPath = join(home, '.claude.json');
    writeFileSync(claudeJsonPath, JSON.stringify({
      mcpServers: { trailhead: { command: 'old', args: [], env: {} } },
      someOtherKey: 'preserve me',
    }));

    const r = await applyInit(baseOpts(home, cwd));
    assert.equal(r.claudeCode.userServerInstalled, 'updated');
    const after = readJson(claudeJsonPath);
    assert.equal(after.someOtherKey, 'preserve me');
    assert.equal(after.mcpServers.trailhead.command, 'npx');
    assert.equal(after.mcpServers.trailhead.env.TRAILHEAD_TEAM_TOKEN, 'tok-123');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('~/.claude.json with NO trailhead entry is left alone (Q2 c)', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const claudeJsonPath = join(home, '.claude.json');
    writeFileSync(claudeJsonPath, JSON.stringify({
      mcpServers: { other: { command: 'echo', args: ['hi'] } },
    }));
    const r = await applyInit(baseOpts(home, cwd));
    assert.equal(r.claudeCode.userServerInstalled, 'skipped');
    const after = readJson(claudeJsonPath);
    assert.ok(!after.mcpServers.trailhead, 'should not have added trailhead to user-scope');
    assert.ok(after.mcpServers.other, 'unrelated entry preserved');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('--user-scope forces ~/.claude.json write even on a fresh user', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const r = await applyInit({ ...baseOpts(home, cwd), userScope: true });
    assert.equal(r.claudeCode.userServerInstalled, 'created');
    const cfg = readJson(join(home, '.claude.json'));
    assert.equal(cfg.mcpServers.trailhead.env.TRAILHEAD_TEAM_TOKEN, 'tok-123');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Coaching directive
// ---------------------------------------------------------------------------

test('autoCoach=true creates ./CLAUDE.md with the directive', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const r = await applyInit({ ...baseOpts(home, cwd), autoCoach: true });
    assert.equal(r.projectCoachInstalled, 'created');
    assert.equal(r.userCoachInstalled, 'skipped');
    const projectPath = join(cwd, 'CLAUDE.md');
    assert.equal(r.projectClaudeMdPath, projectPath);
    const content = readFileSync(projectPath, 'utf8');
    assert.match(content, /## Trailhead coaching/);
    assert.match(content, /\bcoach\b/);
    assert.match(content, /\bwiki_lookup\b/);
    assert.match(content, /\bwiki_save\b/);
    assert.match(content, /\bwiki_bootstrap\b/);
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
    const r = await applyInit({ ...baseOpts(home, cwd), autoCoach: true });
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
    const r1 = await applyInit({ ...baseOpts(home, cwd), autoCoach: true });
    const r2 = await applyInit({ ...baseOpts(home, cwd), autoCoach: true });
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

test('autoCoach=false writes no CLAUDE.md', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const r = await applyInit({ ...baseOpts(home, cwd), autoCoach: false });
    assert.equal(r.projectCoachInstalled, 'skipped');
    assert.equal(existsSync(join(cwd, 'CLAUDE.md')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('--user-scope writes both project and user CLAUDE.md', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const r = await applyInit({
      ...baseOpts(home, cwd), autoCoach: true, userScope: true,
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
  assert.match(COACH_DIRECTIVE, /\bcoach\b/);
  assert.match(COACH_DIRECTIVE, /\bwiki_lookup\b/);
  assert.match(COACH_DIRECTIVE, /\bwiki_save\b/);
  assert.match(COACH_DIRECTIVE, /\bwiki_bootstrap\b/);
  assert.doesNotMatch(COACH_DIRECTIVE, /coach_score/);
  assert.doesNotMatch(COACH_DIRECTIVE, /wiki_update_learnings/);
  assert.doesNotMatch(COACH_DIRECTIVE, /wiki_context_for/);
});

test('directive section is replaced (not duplicated) when content changes', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const opts1 = {
      ...baseOpts(home, cwd),
      autoCoach: true,
      directiveText: '## Trailhead coaching v1\n\nfirst version body\n',
    };
    await applyInit(opts1);
    const after1 = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    assert.match(after1, /first version body/);

    const opts2 = {
      ...opts1,
      directiveText: '## Trailhead coaching v2\n\nSECOND version body\n',
    };
    const r2 = await applyInit(opts2);
    assert.equal(r2.projectCoachInstalled, 'replaced');
    const after2 = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    assert.match(after2, /SECOND version body/);
    assert.doesNotMatch(after2, /first version body/);
    const matches = after2.match(/## Trailhead coaching/g) ?? [];
    assert.equal(matches.length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Copilot wiring
// ---------------------------------------------------------------------------

test('wireCopilot=true writes .vscode/mcp.json + .github/copilot-instructions.md', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    mkdirSync(join(cwd, '.vscode'), { recursive: true });
    const r = await applyInit({
      ...baseOpts(home, cwd),
      autoCoach: true,
      wireCopilot: true,
    });
    assert.equal(r.copilot.wired, true);
    assert.equal(r.copilot.mcpJsonInstalled, 'created');
    const mcp = readJson(join(cwd, '.vscode', 'mcp.json'));
    assert.equal(mcp.servers.trailhead.command, 'npx');
    assert.equal(mcp.servers.trailhead.env.TRAILHEAD_API_URL, 'https://api.example.com');
    assert.equal(mcp.servers.trailhead.env.TRAILHEAD_TEAM_TOKEN, 'tok-123');
    assert.equal(r.copilot.instructionsInstalled, 'created');
    const instructions = readFileSync(join(cwd, '.github', 'copilot-instructions.md'), 'utf8');
    assert.match(instructions, /## Trailhead coaching/);
    assert.match(instructions, /\bcoach\b/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('wireCopilot=true is idempotent — second run reports unchanged', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    mkdirSync(join(cwd, '.vscode'), { recursive: true });
    const opts = { ...baseOpts(home, cwd), autoCoach: true, wireCopilot: true };
    const r1 = await applyInit(opts);
    const r2 = await applyInit(opts);
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
    mkdirSync(join(cwd, '.vscode'), { recursive: true });
    const r = await applyInit({
      ...baseOpts(home, cwd),
      autoCoach: true,
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

test('wireClaudeCode=false skips Claude Code wiring entirely', async () => {
  const home = makeHome();
  const cwd = makeCwd();
  try {
    const r = await applyInit({
      ...baseOpts(home, cwd),
      autoCoach: true,
      wireClaudeCode: false,
    });
    assert.equal(r.claudeCode.wired, false);
    assert.equal(existsSync(join(cwd, '.mcp.json')), false);
    assert.equal(existsSync(join(home, '.claude.json')), false);
    assert.equal(existsSync(join(cwd, 'CLAUDE.md')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});
