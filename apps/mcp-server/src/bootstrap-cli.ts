// CLI entry point for `trailhead-mcp bootstrap`. Spawned via tsx by the
// dispatcher in bin/cli.mjs. Walks cwd (or a passed --paths list), POSTs to
// /onboard/repo, prints a summary.
//
// Args:
//   --paths "src/api/,src/db/"   comma-separated explicit list (skips walk)
//   --no-seed                    skip CLAUDE.md / copilot-instructions.md seed
//   --dry-run                    print what would be sent; don't POST
//   --max-depth N                cap discovery depth (default 3)
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiClient, clientFromEnv } from './api-client.ts';
import { discoverPaths, readSeedRules, runBootstrap } from './bootstrap.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env from repo root .env if available — same pattern as smoke-test.mjs
// and the harness. The CLI typically runs from a user's repo where .env
// won't exist; in that case env vars must be set externally (or use the
// hardcoded demo defaults below).
for (const candidate of ['../../../.env', '../../.env', '.env']) {
  const p = resolve(__dirname, candidate);
  if (existsSync(p)) {
    try { process.loadEnvFile(p); } catch {}
    break;
  }
}

// Demo defaults — match bin/cli.mjs's init defaults so a user can `bootstrap`
// without setting env vars first. Real teams override via env.
process.env.TRAILHEAD_API_URL =
  process.env.TRAILHEAD_API_URL ?? 'https://trailheadapi-production.up.railway.app';
process.env.TRAILHEAD_TEAM_TOKEN =
  process.env.TRAILHEAD_TEAM_TOKEN ?? 'trailhead_demo_acme_2026';

const args = process.argv.slice(2);
const flags = new Set<string>(args.filter((a) => a.startsWith('--') && !a.includes('=')));
const flagValues = new Map<string, string>();
for (const a of args) {
  if (a.startsWith('--') && a.includes('=')) {
    const [k, v] = a.split('=', 2);
    flagValues.set(k!, v ?? '');
  }
}
// Allow space-separated `--paths "..."`
for (let i = 0; i < args.length - 1; i++) {
  const a = args[i]!;
  const next = args[i + 1]!;
  if (a.startsWith('--') && !a.includes('=') && !next.startsWith('--')) {
    flagValues.set(a, next);
  }
}

const dryRun = flags.has('--dry-run');
const seedFromFiles = !flags.has('--no-seed');
const maxDepth = Number(flagValues.get('--max-depth') ?? 3);
const pathsArg = flagValues.get('--paths');
const explicitPaths = pathsArg
  ? pathsArg.split(',').map((s) => s.trim()).filter(Boolean)
  : undefined;
const cwd = process.cwd();

if (flags.has('--help') || flags.has('-h')) {
  console.log(`trailhead-mcp bootstrap — bootstrap a Trailhead wiki for the cwd

Usage:
  trailhead-mcp bootstrap [--paths "src/,packages/"] [--no-seed]
                          [--dry-run] [--max-depth 3]

Without --paths, walks cwd up to --max-depth (default 3) and submits every
folder that contains at least one source file. node_modules / .git / build
output / hidden dirs are skipped automatically.

Without --no-seed, the contents of ./CLAUDE.md and
./.github/copilot-instructions.md (if present) are seeded onto the wiki's
synthetic root node.

Env: TRAILHEAD_API_URL, TRAILHEAD_TEAM_TOKEN. Defaults to the public demo team.
`);
  process.exit(0);
}

const discovered = explicitPaths ?? discoverPaths(cwd, { maxDepth });

if (!discovered.length) {
  console.error(
    `! No source folders found under ${cwd} (max depth ${maxDepth}). ` +
      `Pass --paths "..." to bootstrap explicit folders.`,
  );
  process.exit(1);
}

console.log(`Bootstrapping wiki for ${cwd}`);
console.log(`Source: ${process.env.TRAILHEAD_API_URL}`);
console.log('');
console.log(`Paths (${discovered.length}):`);
for (const p of discovered) console.log(`  - ${p}`);

const seed = seedFromFiles ? readSeedRules(cwd) : {};
if (seed['']) {
  const preview = seed['']!.slice(0, 80).replace(/\s+/g, ' ');
  console.log('');
  console.log(`Seed (root): ${preview}${seed['']!.length > 80 ? '…' : ''}`);
}

if (dryRun) {
  console.log('\n--dry-run set — nothing posted.');
  process.exit(0);
}

let client: ApiClient;
try {
  client = clientFromEnv();
} catch (e) {
  console.error(`! ${(e as Error).message}`);
  process.exit(1);
}

try {
  const { response } = await runBootstrap(client, {
    cwd,
    paths: explicitPaths,
    initialRules: seed,
    seedFromFiles: false, // already read above
  });
  console.log('');
  console.log(
    `✓ Bootstrap complete: ${response.nodes_created} new node${response.nodes_created === 1 ? '' : 's'}, ` +
      `${response.nodes.length - response.nodes_created} already existed.`,
  );
  console.log('');
  console.log('Next: have your team start prompting in Claude Code or Copilot.');
  console.log('Conventions stated as "we always X" will be saved automatically.');
} catch (e) {
  console.error(`! Bootstrap failed: ${(e as Error).message}`);
  process.exit(1);
}
