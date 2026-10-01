#!/usr/bin/env node
// trailhead-mcp CLI. Four modes:
//   `trailhead-mcp init`        — wire MCP server into Claude Code AND/OR Copilot
//   `trailhead-mcp bootstrap`   — bootstrap a Trailhead wiki for the cwd
//   `trailhead-mcp reset`       — wipe all wiki data for the current team
//   `trailhead-mcp run`         — start the MCP server (stdio transport)
//
// Init sets up the repo's team (bin/team-setup.mjs): it registers the team on
// the API — team id derived from the normalised git remote, secret minted by
// the server and saved in the gitignored ./.trailhead-team — or joins an
// existing one with --team-token <secret>. The generated MCP configs point at
// that file (TRAILHEAD_TEAM_FILE) rather than embedding the secret.
//
// `reset` is destructive and per-team. The CLI prompts for confirmation
// unless `--yes` is passed.
//
// Init flags:
//   --no-claude-code   skip Claude Code wiring even if detected
//   --no-copilot       skip Copilot wiring even if detected
//   --no-auto-coach    skip writing the directive to *.md (tools still register)
//   --user-scope       also write ~/.claude.json + ~/.claude/CLAUDE.md
//   --team-token <s>   join an existing team with its secret
//   --team-id <id>     register under this id instead of the derived one
//   --upgrade-legacy   switch a pre-2026-09-30 (remote-derived) team to a secret
//   --admin-token <t>  for servers that set TRAILHEAD_ADMIN_TOKEN
//   --api-url <url>    override TRAILHEAD_API_URL
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInit } from './init.mjs';
import { maskSecret, SENTINEL_FILENAME } from '../src/token.mjs';
import { setupTeam, TeamSetupError } from './team-setup.mjs';
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

if (cmd === 'init') {
  const cwd = process.cwd();
  const apiUrl = resolveApiUrl(flagValue('--api-url'));

  let team;
  try {
    team = await setupTeam({
      cwd,
      apiUrl,
      explicitToken: flagValue('--team-token'),
      upgradeLegacy: flags.includes('--upgrade-legacy'),
      teamIdOverride: flagValue('--team-id'),
      adminToken: flagValue('--admin-token') ?? process.env.TRAILHEAD_ADMIN_TOKEN,
    });
  } catch (err) {
    if (err instanceof TeamSetupError) {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const sourceLabel = {
    flag: '--team-token',
    env: 'TRAILHEAD_TEAM_TOKEN env',
    sentinel: '.trailhead-team (existing)',
    registered: 'registered a new team',
    'legacy-remote': 'legacy team derived from the git remote (deprecated)',
    'legacy-upgraded': 'legacy team upgraded to a secret',
  }[team.source];
  console.log(`API:    ${apiUrl}`);
  console.log(`Team:   ${team.name ?? '(unvalidated)'}${team.teamId ? `  [id ${team.teamId}]` : ''}`);
  console.log(`Secret: ${maskSecret(team.token)}  (${sourceLabel}; stored in ./${SENTINEL_FILENAME}, gitignored)`);
  for (const note of team.notes) console.log(`! ${note}`);
  console.log('');

  await runInit({
    serverEntry: resolve(__dirname, '../src/index.ts'),
    apiUrl,
    // Relative, so the generated configs hold no path from this machine for
    // the secret; the server finds it from its cwd up to the git root.
    teamFile: SENTINEL_FILENAME,
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
  trailhead-mcp init [--team-token <secret>] [--api-url <url>]
                     [--upgrade-legacy] [--team-id <id>] [--admin-token <t>]
                     [--no-claude-code] [--no-copilot]
                     [--no-auto-coach] [--user-scope]
        Set up this repo's team and wire trailhead into Claude Code and/or
        Copilot for cwd. Without --team-token, registers the repo's team on
        the API (team id from the normalised git remote) and saves the
        returned secret in ./.trailhead-team (gitignored). If the team is
        already registered, ask a teammate for the secret and pass
        --team-token. --upgrade-legacy switches a pre-2026-09-30 team to a
        secret. Always writes per-repo .mcp.json (Claude Code) and
        .vscode/mcp.json (Copilot), which reference the sentinel instead of
        embedding the secret. Writes ~/.claude.json only if it already has a
        trailhead entry, or with --user-scope.

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
