// CLI entry point for `trailhead-mcp bootstrap`. Spawned via tsx by the
// dispatcher in bin/cli.mjs. Walks cwd (or a passed --paths list), POSTs to
// /onboard/repo, prints a summary.
//
// Args:
//   --paths "src/api/,src/db/"   comma-separated explicit list (skips walk)
//   --no-seed                    skip CLAUDE.md / copilot-instructions.md seed
//   --dry-run                    print what would be sent; don't POST
//   --max-depth N                cap discovery depth (default 3)
//   --yes                        skip the confirmation prompt
//   --team-token <t>             use this exact token (skips auto-derivation)
//   --api-url <url>              override TRAILHEAD_API_URL
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ApiClient } from './api-client.ts';
import { discoverPaths, readSeedRules, runBootstrap } from './bootstrap.ts';
import { deriveRepoToken } from './token.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const candidate of ['../../../.env', '../../.env', '.env']) {
  const p = resolve(__dirname, candidate);
  if (existsSync(p)) {
    try { process.loadEnvFile(p); } catch {}
    break;
  }
}

const args = process.argv.slice(2);
const flags = new Set<string>(args.filter((a) => a.startsWith('--') && !a.includes('=')));
const flagValues = new Map<string, string>();
for (const a of args) {
  if (a.startsWith('--') && a.includes('=')) {
    const [k, v] = a.split('=', 2);
    flagValues.set(k!, v ?? '');
  }
}
for (let i = 0; i < args.length - 1; i++) {
  const a = args[i]!;
  const next = args[i + 1]!;
  if (a.startsWith('--') && !a.includes('=') && !next.startsWith('--')) {
    flagValues.set(a, next);
  }
}

if (flags.has('--help') || flags.has('-h')) {
  console.log(`trailhead-mcp bootstrap — bootstrap a Trailhead wiki for the cwd

Usage:
  trailhead-mcp bootstrap [--paths "src/,packages/"] [--no-seed]
                          [--dry-run] [--yes] [--max-depth 3]
                          [--team-token <t>] [--api-url <url>]

Without --paths, walks cwd up to --max-depth (default 3) and submits every
folder that contains at least one source file. node_modules / .git / build
output / hidden dirs are skipped automatically.

Without --no-seed, the contents of ./CLAUDE.md and
./.github/copilot-instructions.md (if present) are seeded onto the wiki's
synthetic root node.

Token is auto-derived from cwd (git remote → ./.trailhead-team) unless
overridden. Confirmation prompt unless --yes.
`);
  process.exit(0);
}

const dryRun = flags.has('--dry-run');
const seedFromFiles = !flags.has('--no-seed');
const skipPrompt = flags.has('--yes');
const maxDepth = Number(flagValues.get('--max-depth') ?? 3);
const pathsArg = flagValues.get('--paths');
const explicitPaths = pathsArg
  ? pathsArg.split(',').map((s) => s.trim()).filter(Boolean)
  : undefined;
const cwd = process.cwd();

// Cwd-safety: walking ~ would try to onboard the entire home directory.
function looksLikeProjectRoot(p: string): boolean {
  const markers = [
    'package.json', '.git', 'pyproject.toml', 'Cargo.toml',
    'go.mod', 'pom.xml', 'build.gradle', '.trailhead-team',
  ];
  return markers.some((m) => existsSync(join(p, m)));
}
if (!looksLikeProjectRoot(cwd) && !explicitPaths) {
  console.error(
    `! cwd "${cwd}" doesn't look like a project root.\n` +
      `  Refusing to walk — pass --paths "..." explicitly if this is intentional,\n` +
      `  or cd to a project root before running bootstrap.`,
  );
  process.exit(2);
}

const explicitToken = flagValues.get('--team-token');
const tokenInfo = explicitToken
  ? { token: explicitToken, source: 'flag' as const, remoteUrl: undefined as string | undefined }
  : deriveRepoToken(cwd);
const apiUrl =
  flagValues.get('--api-url') ??
  process.env.TRAILHEAD_API_URL ??
  'https://trailheadapi-production.up.railway.app';

const discovered = explicitPaths ?? discoverPaths(cwd, { maxDepth });

if (!discovered.length) {
  console.error(
    `! No source folders found under ${cwd} (max depth ${maxDepth}). ` +
      `Pass --paths "..." to bootstrap explicit folders.`,
  );
  process.exit(1);
}

console.log(`Bootstrapping wiki for ${cwd}`);
console.log(`API:    ${apiUrl}`);
console.log(`Token:  ${tokenInfo.token}  (source: ${tokenInfo.source})`);
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

if (!skipPrompt) {
  console.log('');
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(`Proceed? Type "y" to bootstrap: `)).trim().toLowerCase();
  rl.close();
  if (answer !== 'y' && answer !== 'yes') {
    console.log('Aborted.');
    process.exit(0);
  }
}

const client = new ApiClient({ apiUrl, teamToken: tokenInfo.token });

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
