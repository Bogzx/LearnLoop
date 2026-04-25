#!/usr/bin/env node
// trailhead-mcp CLI. Three modes:
//   `trailhead-mcp init`        — wire MCP server into Claude Code AND/OR Copilot
//   `trailhead-mcp bootstrap`   — bootstrap a Trailhead wiki for the cwd
//   `trailhead-mcp run`         — start the MCP server (stdio transport)
//
// `init` is idempotent: re-running won't duplicate entries; if a directive
// section already exists in CLAUDE.md or .github/copilot-instructions.md, it
// is replaced with the latest content from src/coaching-directive.md.
//
// `bootstrap` walks cwd for source folders and POSTs them to /onboard/repo,
// creating one wiki node per folder. Idempotent.
//
// Flags (init):
//   --no-claude-code  skip Claude Code wiring even if detected
//   --no-copilot      skip Copilot wiring even if detected
//   --no-auto-coach   skip writing the directive to *.md (tools still register)
//   --user-scope      also append the directive to ~/.claude/CLAUDE.md (global)
//
// Flags (bootstrap): see `trailhead-mcp bootstrap --help`.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInit } from './init.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2] ?? 'help';
const flags = process.argv.slice(3);

if (cmd === 'init') {
  await runInit({
    serverEntry: resolve(__dirname, '../src/index.ts'),
    apiUrl: process.env.TRAILHEAD_API_URL ?? 'https://trailheadapi-production.up.railway.app',
    teamToken: process.env.TRAILHEAD_TEAM_TOKEN ?? 'trailhead_demo_acme_2026',
    autoCoach: !flags.includes('--no-auto-coach'),
    userScope: flags.includes('--user-scope'),
    wireClaudeCode: !flags.includes('--no-claude-code'),
    wireCopilot: !flags.includes('--no-copilot'),
  });
  process.exit(0);
}

if (cmd === 'bootstrap') {
  // Spawn tsx on the bootstrap CLI module so the user's repo is the cwd
  // (process.cwd() inside bootstrap-cli.ts == where they ran `trailhead-mcp
  // bootstrap`). Pass through all remaining args (--paths, --no-seed, etc.).
  const target = resolve(__dirname, '../src/bootstrap-cli.ts');
  const result = spawnSync(
    'npx',
    ['--yes', 'tsx', target, ...flags],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  process.exit(result.status ?? 1);
}

if (cmd === 'run') {
  // Re-spawn the server entry under tsx. Kept simple — for distribution we'd
  // ship a precompiled bundle, but the hackathon runs the .ts directly.
  await import('../src/index.ts');
  process.exit(0);
}

console.log(`trailhead-mcp — usage:
  trailhead-mcp init [--no-claude-code] [--no-copilot]
                     [--no-auto-coach] [--user-scope]
        Autodetects Claude Code and Copilot in the current environment and
        wires both. Writes:
          ~/.claude.json                     (Claude Code MCP server entry)
          ./CLAUDE.md                        (Claude Code coaching directive)
          .vscode/mcp.json                   (Copilot MCP server entry)
          .github/copilot-instructions.md    (Copilot coaching directive)
        Idempotent — replaces the directive section if it already exists.

  trailhead-mcp bootstrap [--paths ...] [--no-seed] [--dry-run] [--max-depth N]
        Walk cwd for source folders and create one wiki node per folder.
        Run --help for full flag list. Idempotent.

  trailhead-mcp run
        Start the MCP server (stdio transport).
`);
process.exit(cmd === 'help' ? 0 : 2);
