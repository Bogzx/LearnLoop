// Bootstrap a new repo's Trailhead wiki — shared logic for the
// `wiki_bootstrap` MCP tool and the `trailhead-mcp bootstrap` CLI subcommand.
//
// Two pieces:
//   1. discoverPaths(cwd) — recursive walk that surfaces folders containing
//      source files, excluding well-known noise (node_modules, .git, build
//      output). Used when the caller doesn't supply paths explicitly.
//   2. runBootstrap(client, opts) — POST to /onboard/repo with the discovered
//      or supplied paths.
//
// The CLI surface lives at src/bootstrap-cli.ts; the MCP tool registers in
// tools.ts. Both call through here.
//
// Spec ref: 2026-04-25-mcp-plugin-ux-design.md (bootstrap follow-up)
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import type { ApiClient } from './api-client.ts';
import type { OnboardRepoResponse } from '@trailhead/shared';

// Code-file extensions that mark a folder as worth bootstrapping. Lowercased.
// Conservative list — if a user has Cobol or Erlang they can pass --paths.
const CODE_EXTS = new Set<string>([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.cts', '.mts',
  '.py', '.go', '.rs', '.java', '.kt', '.kts', '.rb', '.php',
  '.swift', '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp',
  '.cs', '.fs', '.scala', '.clj', '.cljs', '.ex', '.exs',
  '.sh', '.bash', '.zsh', '.ps1',
  '.sql',
]);

// Folders we never descend into. Names matched by basename (case-sensitive).
// Note: `bin` and `obj` are not on this list — JS/Python projects often have
// meaningful project-root `bin/` directories (e.g. our own apps/mcp-server/bin).
// For .NET/Java users where bin/obj are build output, those land inside
// `target/` (already ignored) on the canonical layouts.
const DEFAULT_IGNORE = new Set<string>([
  'node_modules', '.git', '.hg', '.svn',
  'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache',
  'coverage', '.nyc_output',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  '.venv', 'venv', '.env',
  'vendor',
  '.idea', '.vscode',
  'tmp', 'temp', '.tmp',
]);

export interface DiscoverOptions {
  maxDepth?: number;       // default 3
  ignore?: Set<string>;    // override DEFAULT_IGNORE
}

// Walk cwd and return repo-relative folder paths (trailing-slash) that
// contain at least one code file. Sorted shallow → deep, alphabetically
// within each depth.
//
// Hidden directories (`.foo`) are skipped — even if not in the ignore set —
// because they almost never contain user-authored source.
export function discoverPaths(cwd: string, opts: DiscoverOptions = {}): string[] {
  const maxDepth = opts.maxDepth ?? 3;
  const ignore = opts.ignore ?? DEFAULT_IGNORE;
  const found = new Set<string>();

  function walk(absDir: string, depth: number): void {
    let entries: { name: string; isDir: boolean; isFile: boolean }[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true }).map((e) => ({
        name: e.name,
        isDir: e.isDirectory(),
        isFile: e.isFile(),
      }));
    } catch {
      return;
    }

    let hasCode = false;
    for (const e of entries) {
      if (e.isFile && CODE_EXTS.has(extname(e.name).toLowerCase())) {
        hasCode = true;
        break;
      }
    }

    if (hasCode) {
      // Repo-relative path with forward slashes. Empty for cwd itself — we
      // skip the root because /onboard/repo doesn't need it (the synthetic
      // root node is implicit).
      const rel = relative(cwd, absDir).split(sep).filter(Boolean).join('/');
      if (rel) found.add(`${rel}/`);
    }

    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (!e.isDir) continue;
      if (e.name.startsWith('.')) continue;
      if (ignore.has(e.name)) continue;
      walk(join(absDir, e.name), depth + 1);
    }
  }

  walk(cwd, 0);

  return [...found].sort((a, b) => {
    const da = a.split('/').length;
    const db = b.split('/').length;
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });
}

// Best-effort heuristic for "the team's existing top-level conventions" —
// drops the contents of CLAUDE.md or .github/copilot-instructions.md (if
// either exists in cwd) onto the synthetic root path so the wiki starts with
// real seed text instead of empty body_md fields.
//
// Skipped if neither file exists. The caller can override / extend via
// opts.initialRules.
export function readSeedRules(cwd: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const candidate of ['CLAUDE.md', '.github/copilot-instructions.md']) {
    const p = join(cwd, candidate);
    if (!existsSync(p)) continue;
    try {
      const text = readFileSync(p, 'utf8').trim();
      if (text) {
        // Seed onto the root path (''). Multiple files concat under one node.
        out[''] = out['']
          ? `${out['']}\n\n---\n\n${text}`
          : text;
      }
    } catch {
      // Ignore read errors — seed is best-effort.
    }
  }
  return out;
}

export interface BootstrapOptions {
  cwd?: string;
  paths?: string[];                       // skip discovery if provided
  initialRules?: Record<string, string>;  // override readSeedRules
  seedFromFiles?: boolean;                // default true — read CLAUDE.md etc.
}

export interface BootstrapResult {
  paths: string[];
  response: OnboardRepoResponse;
}

export async function runBootstrap(
  client: ApiClient,
  opts: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const cwd = opts.cwd ?? process.cwd();
  const paths = opts.paths && opts.paths.length ? opts.paths : discoverPaths(cwd);

  if (!paths.length) {
    throw new Error(
      `no paths to bootstrap. Either no source folders found under ${cwd} or the explicit --paths list was empty.`,
    );
  }

  let initialRules = opts.initialRules ?? {};
  const seedFromFiles = opts.seedFromFiles !== false;
  if (seedFromFiles) {
    // File-based seed loses to caller-supplied initial_rules on collision.
    const seeded = readSeedRules(cwd);
    initialRules = { ...seeded, ...initialRules };
  }

  const response = await client.onboardRepo({
    paths,
    initial_rules: Object.keys(initialRules).length ? initialRules : undefined,
  });

  return { paths, response };
}
