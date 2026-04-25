#!/usr/bin/env node
// trailhead-mcp CLI. Two modes:
//   `trailhead-mcp init`     — wires this MCP server + Stop hook into Claude Code
//   `trailhead-mcp run`      — starts the MCP server (used by the registered command)
// `init` is idempotent: re-running won't duplicate entries.
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInit } from './init.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2] ?? 'help';

if (cmd === 'init') {
  await runInit({
    serverEntry: resolve(__dirname, '../src/index.ts'),
    hookEntry: resolve(__dirname, '../../stop-hook/trailhead-hook.mjs'),
    apiUrl: process.env.TRAILHEAD_API_URL ?? 'https://trailheadapi-production.up.railway.app',
    teamToken: process.env.TRAILHEAD_TEAM_TOKEN ?? 'trailhead_demo_acme_2026',
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
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
  trailhead-mcp init     register this MCP server + Stop hook with Claude Code
  trailhead-mcp run      start the MCP server (stdio)
`);
process.exit(cmd === 'help' ? 0 : 2);
