#!/usr/bin/env node
// trailhead-mcp CLI. Four modes:
//   `trailhead-mcp init`        — wire MCP server into Claude Code AND/OR Copilot
//   `trailhead-mcp bootstrap`   — bootstrap a Trailhead wiki for the cwd
//   `trailhead-mcp reset`       — wipe all wiki data for the current team
//   `trailhead-mcp run`         — start the MCP server (stdio transport)
//
// Init writes per-repo MCP config (`.mcp.json`, `.vscode/mcp.json`) so each
// repo can carry its own team token. By default the token is auto-derived
// from the repo's git remote (deterministic, shared across teammates) or a
// machine-local sentinel file (`.trailhead-team`, gitignored) for repos
// without a remote. Pass `--team-token <t>` to override.
//
// `reset` is destructive and per-team. The CLI prompts for confirmation
// unless `--yes` is passed.
//
// Init flags:
//   --no-claude-code   skip Claude Code wiring even if detected
//   --no-copilot       skip Copilot wiring even if detected
//   --no-auto-coach    skip writing the directive to *.md (tools still register)
//   --user-scope       also write ~/.claude.json + ~/.claude/CLAUDE.md
//   --team-token <t>   use this exact token (skips auto-derivation)
//   --api-url <url>    override TRAILHEAD_API_URL
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInit } from './init.mjs';
import { deriveRepoToken } from '../src/token.mjs';
import { resolveApiUrl } from '../src/api-url.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2] ?? 'help';
const flags = process.argv.slice(3);

// Tiny arg parser — supports `--flag value` and `--flag=value` forms.
function flagValue(name) {
  for (let i = 0; i < flags.length; i++) {
    const a = flags[i];
    if (a === name && i + 1 < flags.length && !flags[i + 1].startsWith('--')) return flags[i + 1];
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return undefined;
}

function resolveToken({ cwd }) {
  const explicit = flagValue('--team-token');
  if (explicit) return { token: explicit, source: 'flag' };
  return deriveRepoToken(cwd);
}

if (cmd === 'init') {
  const cwd = process.cwd();
  const { token, source, remoteUrl } = resolveToken({ cwd });
  const apiUrl = resolveApiUrl(flagValue('--api-url'));

  const sourceLabel = {
    flag: '--team-token',
    env: 'TRAILHEAD_TEAM_TOKEN env',
    sentinel: '.trailhead-team (existing)',
    'sentinel-new': '.trailhead-team (just created, gitignored)',
    remote: `git remote (${remoteUrl ?? 'origin'})`,
  }[source];
  console.log(`Token: ${token}`);
  console.log(`Source: ${sourceLabel}`);
  console.log(`API: ${apiUrl}`);
  console.log('');

  await runInit({
    serverEntry: resolve(__dirname, '../src/index.ts'),
    apiUrl,
    teamToken: token,
    autoCoach: !flags.includes('--no-auto-coach'),
    userScope: flags.includes('--user-scope'),
    wireClaudeCode: !flags.includes('--no-claude-code'),
    wireCopilot: !flags.includes('--no-copilot'),
  });
  process.exit(0);
}

if (cmd === 'bootstrap') {
  // Spawn tsx on the bootstrap CLI module so the user's repo is the cwd.
  const target = resolve(__dirname, '../src/bootstrap-cli.ts');
  const result = spawnSync(
    'npx',
    ['--yes', 'tsx', target, ...flags],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  process.exit(result.status ?? 1);
}

if (cmd === 'reset') {
  const target = resolve(__dirname, '../src/reset-cli.ts');
  const result = spawnSync(
    'npx',
    ['--yes', 'tsx', target, ...flags],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  process.exit(result.status ?? 1);
}

if (cmd === 'run') {
  await import('../src/index.ts');
  process.exit(0);
}

console.log(`trailhead-mcp — usage:
  trailhead-mcp init [--team-token <t>] [--api-url <url>]
                     [--no-claude-code] [--no-copilot]
                     [--no-auto-coach] [--user-scope]
        Wire trailhead into Claude Code and/or Copilot for cwd. Token is
        auto-derived from git remote OR ./.trailhead-team unless overridden.
        Always writes per-repo .mcp.json (Claude Code) and .vscode/mcp.json
        (Copilot). Writes ~/.claude.json only if it already has a trailhead
        entry, or with --user-scope.

  trailhead-mcp bootstrap [--paths "src/,packages/"] [--no-seed]
                          [--dry-run] [--yes] [--max-depth N]
        Walk cwd for source folders and create one wiki node per folder.
        Run --help for full flag list. Idempotent.

  trailhead-mcp reset [--yes]
        Wipe ALL wiki data for the current team. Confirmation required
        unless --yes is passed.

  trailhead-mcp run
        Start the MCP server (stdio transport).
`);
process.exit(cmd === 'help' ? 0 : 2);
