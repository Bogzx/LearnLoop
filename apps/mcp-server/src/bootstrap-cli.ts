// CLI entry point for `trailhead-mcp bootstrap`. Spawned via tsx by the
// dispatcher in bin/cli.mjs. Walks cwd (or a passed --paths list), POSTs to
// /onboard/repo (or /onboard/repo/full for --rich), prints a summary.
//
// Args:
//   --paths "src/api/,src/db/"      comma-separated explicit list (skips walk)
//   --no-seed                       skip CLAUDE.md / copilot-instructions.md seed
//   --dry-run                       print what would be sent; don't POST
//   --max-depth N                   cap discovery depth (default 3 minimal / 5 rich)
//   --yes                           skip the confirmation prompt
//   --team-token <t>                use this exact token (skips auto-derivation)
//   --api-url <url>                 override TRAILHEAD_API_URL
//   --rich                          use the LLM-populated bootstrap (spec 2026-04-26)
//   --force                         (rich only) overwrite bootstrap-generated body_md
//   --max-chars-per-file N          rich cap (default 8000)
//   --max-files-per-folder N        rich cap (default 30)
//   --max-files N                   rich cap (default 500)
//   --max-bundle-mb N               rich cap (default 5)
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ApiClient } from './api-client.ts';
import {
  buildRichBundle,
  discoverPaths,
  readSeedRules,
  RICH_DEFAULTS,
  runBootstrap,
  runRichBootstrap,
} from './bootstrap.ts';
import type { WikiJobStatusResponse } from '@trailhead/shared';
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
                          [--dry-run] [--yes] [--max-depth N]
                          [--team-token <t>] [--api-url <url>]
                          [--rich] [--force]
                          [--max-chars-per-file N] [--max-files-per-folder N]
                          [--max-files N] [--max-bundle-mb N]

Default (minimal mode):
  Walks cwd up to --max-depth (default 3) and submits every folder that
  contains at least one source file. body_md stays empty per folder; the
  root node is seeded from CLAUDE.md / copilot-instructions.md.

--rich (Karpathy-style auto-generated wiki):
  Bundles file contents (subject to caps) and POSTs to /onboard/repo/full.
  The API runs three Gemini passes (per-folder, per-file, root) to fill
  every body_md with a narrative summary, plus extracts conventions into
  the learnings table. Async — the CLI polls for progress and prints a
  live progress bar. Default --max-depth bumps to 5 in rich mode.

  Re-runs are a no-op for already-populated nodes. Use --force to refresh
  bootstrap-generated body_md (manual edits via wiki_save are always
  preserved).

In every mode: node_modules / .git / build output / hidden dirs / archive
are skipped automatically. Token is auto-derived from cwd (git remote →
./.trailhead-team) unless overridden. Confirmation prompt unless --yes.
`);
  process.exit(0);
}

const dryRun = flags.has('--dry-run');
const seedFromFiles = !flags.has('--no-seed');
const skipPrompt = flags.has('--yes');
const richMode = flags.has('--rich');
const force = flags.has('--force');
const maxDepth = Number(flagValues.get('--max-depth') ?? (richMode ? 5 : 3));
const pathsArg = flagValues.get('--paths');
const explicitPaths = pathsArg
  ? pathsArg.split(',').map((s) => s.trim()).filter(Boolean)
  : undefined;

// Rich-mode caps. Mirror the spec §7 defaults; CLI flags allow per-repo
// overrides.
const richCaps = {
  maxCharsPerFile:   Number(flagValues.get('--max-chars-per-file')   ?? RICH_DEFAULTS.maxCharsPerFile),
  maxFilesPerFolder: Number(flagValues.get('--max-files-per-folder') ?? RICH_DEFAULTS.maxFilesPerFolder),
  maxFiles:          Number(flagValues.get('--max-files')            ?? RICH_DEFAULTS.maxFiles),
  maxBundleBytes:    Number(flagValues.get('--max-bundle-mb')        ?? 5) * 1024 * 1024,
};

if (force && !richMode) {
  console.error('! --force only applies with --rich. Re-run without --force or add --rich.');
  process.exit(2);
}

const cwd = process.cwd();

// Polling constants for rich-mode progress rendering. Hoisted to module
// scope so they're initialized before the top-level rich-mode block uses
// them (the helper functions defined further down close over these).
const POLL_INTERVAL_MS = 2_000;
const PROGRESS_BAR_WIDTH = 28;

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

const seed = seedFromFiles ? readSeedRules(cwd) : {};

console.log(`Bootstrapping ${richMode ? 'RICH (LLM-populated) ' : ''}wiki for ${cwd}`);
console.log(`API:    ${apiUrl}`);
console.log(`Token:  ${tokenInfo.token}  (source: ${tokenInfo.source})`);
console.log('');

const client = new ApiClient({ apiUrl, teamToken: tokenInfo.token });

if (richMode) {
  // ---- RICH MODE -------------------------------------------------------
  // buildRichBundle() handles discovery + file reads + caps in one call.
  // We then preview the bundle, confirm, POST, and poll for progress.
  const bundle = buildRichBundle({
    cwd,
    folders: explicitPaths,
    discoverOpts: { maxDepth },
    seedFromFiles: false,           // we passed seed via initialRules below
    initialRules: seed,
    caps: richCaps,
  });

  if (!bundle.folders.length && !bundle.files.length) {
    console.error(
      `! No source folders/files found under ${cwd} (max depth ${maxDepth}). ` +
        `Pass --paths "..." to bootstrap explicit folders.`,
    );
    process.exit(1);
  }

  console.log(`Folders (${bundle.folders.length}):`);
  for (const p of bundle.folders.slice(0, 20)) console.log(`  - ${p}`);
  if (bundle.folders.length > 20) console.log(`  ... +${bundle.folders.length - 20} more`);
  console.log('');
  console.log(`Files (${bundle.files.length}, ${(bundle.bundleBytes / 1024).toFixed(0)} KB total):`);
  for (const f of bundle.files.slice(0, 20)) {
    console.log(`  - ${f.path}${f.truncated ? ' [truncated]' : ''}`);
  }
  if (bundle.files.length > 20) console.log(`  ... +${bundle.files.length - 20} more`);

  if (
    bundle.truncatedBy.perFile + bundle.truncatedBy.perFolder + bundle.truncatedBy.globalCap >
    0
  ) {
    console.log('');
    console.log('Truncation summary:');
    if (bundle.truncatedBy.perFile)
      console.log(`  - ${bundle.truncatedBy.perFile} files head/tail-truncated (>--max-chars-per-file)`);
    if (bundle.truncatedBy.perFolder)
      console.log(`  - ${bundle.truncatedBy.perFolder} files dropped per per-folder cap`);
    if (bundle.truncatedBy.globalCap)
      console.log(`  - ${bundle.truncatedBy.globalCap} files dropped per global cap`);
    console.log('  (raise --max-chars-per-file / --max-files-per-folder / --max-files to include more)');
  }

  if (seed['']) {
    const preview = seed['']!.slice(0, 80).replace(/\s+/g, ' ');
    console.log('');
    console.log(`Seed (root): ${preview}${seed['']!.length > 80 ? '…' : ''}`);
  }

  if (dryRun) {
    console.log('\n--dry-run set — nothing posted.');
    process.exit(0);
  }

  console.log('');
  console.log(
    `Source code for these files will be sent to the API server (${apiUrl}). ` +
      `\nThe LLM passes typically take 30-90s; the bundle is discarded after the job completes.`,
  );

  if (!skipPrompt) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = (await rl.question(`\nProceed? Type "y" to bootstrap: `)).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  try {
    const { response } = await runRichBootstrap(client, {
      cwd,
      folders: explicitPaths,
      discoverOpts: { maxDepth },
      seedFromFiles: false,
      initialRules: seed,
      caps: richCaps,
      force,
    });

    console.log('');
    console.log(`Job: ${response.job_id}  ·  ${response.paths_total} paths to process`);
    console.log('');

    const final = await pollWithProgress(client, response.job_id);

    console.log('');
    console.log(
      final.status === 'done'
        ? `✓ Rich bootstrap complete in ${formatDuration(final)}`
        : `! Rich bootstrap ${final.status}${final.error ? `: ${final.error}` : ''}`,
    );
    console.log(`  Done:    ${final.paths_done}/${final.paths_total}`);
    console.log(`  Failed:  ${final.paths_failed}`);

    const failures = final.paths.filter((p) => p.status === 'failed');
    if (failures.length) {
      console.log('');
      console.log('Failures:');
      for (const f of failures.slice(0, 25)) {
        console.log(`  - ${f.kind} ${f.path || '/'}: ${f.error ?? '(no error message)'}`);
      }
      if (failures.length > 25) console.log(`  ... +${failures.length - 25} more`);
    }

    console.log('');
    console.log(`View the populated wiki at the dashboard's /wiki page.`);
  } catch (e) {
    console.error(`! Bootstrap failed: ${(e as Error).message}`);
    process.exit(1);
  }
} else {
  // ---- MINIMAL MODE (existing behavior) --------------------------------
  const discovered = explicitPaths ?? discoverPaths(cwd, { maxDepth });

  if (!discovered.length) {
    console.error(
      `! No source folders found under ${cwd} (max depth ${maxDepth}). ` +
        `Pass --paths "..." to bootstrap explicit folders.`,
    );
    process.exit(1);
  }

  console.log(`Paths (${discovered.length}):`);
  for (const p of discovered) console.log(`  - ${p}`);

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
    console.log('');
    console.log('Tip: re-run with --rich to populate every wiki page from real code.');
  } catch (e) {
    console.error(`! Bootstrap failed: ${(e as Error).message}`);
    process.exit(1);
  }
}

// ----- Progress bar / poll helper ---------------------------------------

async function pollWithProgress(client: ApiClient, jobId: string): Promise<WikiJobStatusResponse> {
  let last: WikiJobStatusResponse | null = null;
  while (true) {
    const status = await client.jobStatus(jobId);
    last = status;
    renderProgress(status);
    if (status.status === 'done' || status.status === 'failed') {
      // Newline so subsequent log lines don't overwrite the bar.
      process.stdout.write('\n');
      return status;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

function renderProgress(status: WikiJobStatusResponse): void {
  const total = Math.max(1, status.paths_total);
  const done = status.paths_done + status.paths_failed;
  const filled = Math.round((done / total) * PROGRESS_BAR_WIDTH);
  const bar = '#'.repeat(filled) + '-'.repeat(PROGRESS_BAR_WIDTH - filled);
  const pct = Math.round((done / total) * 100);
  const elapsed = formatDuration(status);
  const failedNote = status.paths_failed ? ` · ${status.paths_failed} failed` : '';
  // Carriage-return overwrite — terminal-only; non-TTY callers see a fresh
  // line each tick (acceptable for log capture).
  const isTty = Boolean(process.stdout.isTTY);
  const line = `[${bar}] ${pct}%  ${done}/${total}${failedNote}  ${elapsed}`;
  if (isTty) {
    process.stdout.write(`\r${line}   `);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

function formatDuration(status: WikiJobStatusResponse): string {
  if (!status.started_at) return '0s';
  const startMs = new Date(status.started_at).getTime();
  const endMs = status.finished_at ? new Date(status.finished_at).getTime() : Date.now();
  const sec = Math.max(0, Math.floor((endMs - startMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
