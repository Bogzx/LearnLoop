#!/usr/bin/env node
// trailhead-mcp CLI. Two modes:
//   `trailhead-mcp init`     — wires this MCP server + Stop hook + coach
//                              directive into Claude Code
//   `trailhead-mcp run`      — starts the MCP server (used by the registered command)
// `init` is idempotent: re-running won't duplicate entries.
//
// init flags:
//   --no-auto-coach   skip writing the coach directive to CLAUDE.md
//                     (coach.* tools still register, just not always-on)
//   --user-scope      additionally append the directive to ~/.claude/CLAUDE.md
//                     (default is project-scoped only — ./CLAUDE.md in cwd)
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInit } from './init.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2] ?? 'help';
const flags = process.argv.slice(3);

if (cmd === 'init') {
  await runInit({
    serverEntry: resolve(__dirname, '../src/index.ts'),
    hookEntry: resolve(__dirname, '../../stop-hook/trailhead-hook.mjs'),
    apiUrl: process.env.TRAILHEAD_API_URL ?? 'https://trailheadapi-production.up.railway.app',
    teamToken: process.env.TRAILHEAD_TEAM_TOKEN ?? 'trailhead_demo_acme_2026',
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
    autoCoach: !flags.includes('--no-auto-coach'),
    userScope:  flags.includes('--user-scope'),
  });
  process.exit(0);
}

if (cmd === 'run') {
  // Re-spawn the server entry under tsx. Kept simple — for distribution we'd
  // ship a precompiled bundle, but the hackathon runs the .ts directly.
  await import('../src/index.ts');
  process.exit(0);
}

console.log(`trailhead-mcp — usage:
  trailhead-mcp init [--no-auto-coach] [--user-scope]
        register this MCP server + Stop hook with Claude Code, and append
        the always-on coach directive to ./CLAUDE.md.

        --no-auto-coach   skip the CLAUDE.md write (tools still register,
                          but the coach loop won't run automatically)
        --user-scope      also append to ~/.claude/CLAUDE.md (global)

  trailhead-mcp run
        start the MCP server (stdio)
`);
process.exit(cmd === 'help' ? 0 : 2);
