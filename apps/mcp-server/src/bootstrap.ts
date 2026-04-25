// Bootstrap a new repo's Trailhead wiki — shared logic for the
// `wiki_bootstrap` MCP tool and the `trailhead-mcp bootstrap` CLI subcommand.
//
// Two flavors:
//   - Minimal (original): discoverPaths + runBootstrap → POST /onboard/repo
//     with folder paths only. body_md only seeded from CLAUDE.md on root.
//   - Rich (2026-04-26): discoverPaths + discoverFiles + readManifests +
//     buildRichBundle → POST /onboard/repo/full with file contents. Server
//     runs three Gemini passes (folders, files, root) and fills body_md.
//     Async — returns a job_id; caller polls /onboard/jobs/:id.
//
// The CLI surface lives at src/bootstrap-cli.ts; the MCP tool registers in
// tools.ts. Both call through here.
//
// Spec refs:
//   2026-04-25-mcp-plugin-ux-design.md (minimal bootstrap)
//   2026-04-26-wiki-bootstrap-rich-design.md (rich bootstrap, this rollout)
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import type { ApiClient } from './api-client.ts';
import type {
  OnboardRepoFullFile,
  OnboardRepoFullRequest,
  OnboardRepoFullResponse,
  OnboardRepoResponse,
} from '@trailhead/shared';

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
//
// The list errs on the side of excluding more — the rich bootstrap walks
// every survivor and POSTs file contents to the API server, so a single
// missed `node_modules/` would explode the bundle into hundreds of MB of
// third-party JavaScript. Any folder you actually wrote yourself can be
// re-added explicitly via `--paths "weird-vendor-folder/"`.
const DEFAULT_IGNORE = new Set<string>([
  // SCM
  'node_modules', '.git', '.hg', '.svn', '.bzr',
  // JS/TS build output + framework caches
  'dist', 'build', 'out', 'target', 'lib-cov', 'release',
  '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache', '.svelte-kit',
  '.docusaurus', '.astro', '.serverless', '.vercel', '.netlify',
  '.expo', '.expo-shared', '.fleet', '.history', '.pnpm-store',
  'bower_components', 'jspm_packages',
  // Test/coverage output
  'coverage', '.nyc_output', 'htmlcov',
  // Python
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox',
  '.venv', 'venv', 'env', '.eggs', '*.egg-info',
  // Go / Rust / Java / .NET artifacts that share names with source dirs
  'vendor', '.gradle', '.mvn', '.dart_tool',
  // Editor / OS
  '.idea', '.vscode', '.fleet', '.vs', '.DS_Store', 'Thumbs.db',
  // iOS / macOS build
  'Pods', 'DerivedData', 'Carthage',
  // Junk
  'tmp', 'temp', '.tmp', 'log', 'logs',
  // Project-specific noise the user explicitly flagged: archive folders are
  // typically old/dead code we don't want in the wiki.
  'archive', 'archived', 'deprecated', 'legacy',
]);

// Files we exclude even when their extension matches CODE_EXTS — typically
// generated output or minified bundles that add tokens without insight.
// Matched against the basename (case-insensitive, anchored).
const GENERATED_FILE_PATTERNS: RegExp[] = [
  /\.generated\./i,            // foo.generated.ts, foo.generated.js
  /\.gen\./i,                  // foo.gen.go, schema.gen.ts
  /-generated\./i,             // openapi-generated.ts
  /\.pb\.(ts|js|go|py|java|rb|cs)$/i, // protobuf
  /\.grpc\.(ts|js|go|py)$/i,
  /\.min\.(js|css|mjs|cjs)$/i, // minified bundles
  /\.bundle\.(js|mjs|cjs|css)$/i,
  /\.tsbuildinfo$/i,
  /\.snap$/i,                  // jest snapshots
  /^\.eslintrc\./i,            // most config (we already have manifests)
];

function isGeneratedFile(basename: string): boolean {
  return GENERATED_FILE_PATTERNS.some((re) => re.test(basename));
}

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
      if (
        e.isFile &&
        CODE_EXTS.has(extname(e.name).toLowerCase()) &&
        !isGeneratedFile(e.name)
      ) {
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

// =============================================================================
// Rich bootstrap (2026-04-26 rollout)
// =============================================================================

// Defaults match spec §7. CLI/tool callers can override per repo.
// Note: the minimal-bootstrap default depth is 3; rich uses 5 because
// React/Next/Rust/Java repos commonly have source folders at depth 4-5
// (e.g. `apps/dashboard/src/app/wiki/`, `src/main/java/com/foo/bar/`).
export const RICH_DEFAULTS = {
  maxCharsPerFile:    8_000,
  maxFilesPerFolder:  30,
  maxFiles:           500,
  maxBundleBytes:     5 * 1024 * 1024,  // 5 MB
  maxDepth:           5,
} as const;

export interface RichBundleCaps {
  maxCharsPerFile?:   number;
  maxFilesPerFolder?: number;
  maxFiles?:          number;
  maxBundleBytes?:    number;
}

// Walk the same tree as discoverPaths and return every code-file path
// (file-shaped, no trailing slash), repo-relative, with forward slashes.
// Same ignore-list and CODE_EXTS filter so folders and files stay in sync.
export function discoverFiles(cwd: string, opts: DiscoverOptions = {}): string[] {
  const maxDepth = opts.maxDepth ?? 3;
  const ignore = opts.ignore ?? DEFAULT_IGNORE;
  const found: string[] = [];

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

    for (const e of entries) {
      if (
        e.isFile &&
        CODE_EXTS.has(extname(e.name).toLowerCase()) &&
        !isGeneratedFile(e.name)
      ) {
        const rel = relative(cwd, join(absDir, e.name)).split(sep).filter(Boolean).join('/');
        if (rel) found.push(rel);
      }
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
  // Stable ordering: shallow → deep, alphabetical within each depth. Matches
  // discoverPaths' shape so the bundle reads consistently.
  return found.sort((a, b) => {
    const da = a.split('/').length;
    const db = b.split('/').length;
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });
}

// Read top-level manifest files (package.json / Cargo.toml / pyproject.toml /
// go.mod / pom.xml / build.gradle). Used by the root-page LLM pass to derive
// the tech stack section. Capped at 16K each — manifests are usually small,
// but a giant lockfile-as-manifest shouldn't blow the bundle.
const MANIFEST_FILES = [
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'requirements.txt',
] as const;
const MAX_MANIFEST_CHARS = 16_000;

export function readManifests(cwd: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of MANIFEST_FILES) {
    const p = join(cwd, name);
    if (!existsSync(p)) continue;
    try {
      const text = readFileSync(p, 'utf8');
      out[name] = text.length > MAX_MANIFEST_CHARS
        ? `${text.slice(0, MAX_MANIFEST_CHARS)}\n... [manifest truncated]`
        : text;
    } catch {
      // skip read errors
    }
  }
  return out;
}

// Head + tail truncation. Keeps the first ~62% (imports, top-of-file
// declarations) and the last ~38% (often the public surface / module main /
// default export) of files that exceed the per-file cap. The middle is
// usually the densest implementation detail and the LLM doesn't need every
// helper to summarize the file.
export function truncateForBundle(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false };
  const headLen = Math.floor(maxChars * 0.62);
  const tailLen = maxChars - headLen;
  const omitted = content.length - headLen - tailLen;
  const head = content.slice(0, headLen);
  const tail = content.slice(content.length - tailLen);
  return {
    content: `${head}\n\n... [truncated; ${omitted.toLocaleString()} chars omitted from middle] ...\n\n${tail}`,
    truncated: true,
  };
}

// Pick a representative subset when a folder has more files than the
// per-folder cap allows. Heuristic: prioritize obvious entry points
// (`index.*`, `main.*`, `mod.*`, `lib.*`), then sort the rest by file size
// descending so the LLM sees the meatier files first.
function pickFolderSample(filesInFolder: { rel: string; absSize: number }[], cap: number): string[] {
  if (filesInFolder.length <= cap) return filesInFolder.map((f) => f.rel);
  const isEntry = (rel: string): boolean => {
    const b = basename(rel).toLowerCase();
    return /^(index|main|mod|lib)\.[a-z0-9.]+$/i.test(b);
  };
  const entries = filesInFolder.filter((f) => isEntry(f.rel));
  const others = filesInFolder
    .filter((f) => !isEntry(f.rel))
    .sort((a, b) => b.absSize - a.absSize);
  return [...entries, ...others].slice(0, cap).map((f) => f.rel);
}

// Group files by their immediate parent folder. Used for per-folder
// sampling. Folder key is the slash-terminated relative path.
function groupByFolder(files: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of files) {
    const idx = f.lastIndexOf('/');
    const folder = idx === -1 ? '' : `${f.slice(0, idx)}/`;
    const arr = out.get(folder) ?? [];
    arr.push(f);
    out.set(folder, arr);
  }
  return out;
}

export interface RichBundle {
  folders: string[];
  files: OnboardRepoFullFile[];
  manifests: Record<string, string>;
  initialRules: Record<string, string>;
  truncatedBy: { perFile: number; perFolder: number; globalCap: number };
  bundleBytes: number;
}

export interface BuildRichBundleOptions {
  cwd?: string;
  folders?: string[];                        // override discoverPaths()
  files?: string[];                          // override discoverFiles()
  caps?: RichBundleCaps;
  seedFromFiles?: boolean;                   // default true
  initialRules?: Record<string, string>;
  discoverOpts?: DiscoverOptions;
}

// Build the request payload for POST /onboard/repo/full. Reads file
// contents from disk subject to the §7 caps. The LLM-callable bundle is
// just data — actual Gemini work happens server-side.
export function buildRichBundle(opts: BuildRichBundleOptions = {}): RichBundle {
  const cwd = opts.cwd ?? process.cwd();
  const caps = {
    maxCharsPerFile:   opts.caps?.maxCharsPerFile   ?? RICH_DEFAULTS.maxCharsPerFile,
    maxFilesPerFolder: opts.caps?.maxFilesPerFolder ?? RICH_DEFAULTS.maxFilesPerFolder,
    maxFiles:          opts.caps?.maxFiles          ?? RICH_DEFAULTS.maxFiles,
    maxBundleBytes:    opts.caps?.maxBundleBytes    ?? RICH_DEFAULTS.maxBundleBytes,
  };

  const discoverOpts: DiscoverOptions = {
    maxDepth: opts.discoverOpts?.maxDepth ?? RICH_DEFAULTS.maxDepth,
    ignore:   opts.discoverOpts?.ignore,
  };
  const folders = opts.folders ?? discoverPaths(cwd, discoverOpts);
  let allFiles = opts.files ?? discoverFiles(cwd, discoverOpts);
  // When the caller passed an explicit folder list (e.g. `--paths "packages/db/"`),
  // restrict files to those whose parent folder is in the list. Otherwise
  // a `--paths` invocation would still ship every file in the repo to the
  // server, defeating the point of scoping.
  if (opts.folders && opts.folders.length) {
    const folderPrefixes = opts.folders.map((p) => (p.endsWith('/') ? p : `${p}/`));
    allFiles = allFiles.filter((f) => folderPrefixes.some((prefix) => f.startsWith(prefix)));
  }

  // Per-folder cap: sample if a folder exceeds maxFilesPerFolder.
  const grouped = groupByFolder(allFiles);
  let sampledFiles: string[] = [];
  let perFolderTrunc = 0;
  for (const [folder, list] of grouped) {
    const sized = list.map((rel) => {
      let absSize = 0;
      try { absSize = statSync(join(cwd, rel)).size; } catch {}
      return { rel, absSize };
    });
    const picked = pickFolderSample(sized, caps.maxFilesPerFolder);
    if (picked.length < list.length) perFolderTrunc += list.length - picked.length;
    sampledFiles.push(...picked);
    void folder;
  }

  // Global file-count cap.
  let globalCapTrunc = 0;
  if (sampledFiles.length > caps.maxFiles) {
    globalCapTrunc = sampledFiles.length - caps.maxFiles;
    sampledFiles = sampledFiles.slice(0, caps.maxFiles);
  }

  // Read content for each surviving file with per-file truncation. Track
  // bundle bytes; cut off when we'd cross maxBundleBytes.
  let perFileTrunc = 0;
  let bundleBytes = 0;
  const files: OnboardRepoFullFile[] = [];
  for (const rel of sampledFiles) {
    let raw = '';
    try { raw = readFileSync(join(cwd, rel), 'utf8'); }
    catch { continue; }
    const trim = truncateForBundle(raw, caps.maxCharsPerFile);
    if (trim.truncated) perFileTrunc += 1;
    const entryBytes = Buffer.byteLength(rel, 'utf8') + Buffer.byteLength(trim.content, 'utf8');
    if (bundleBytes + entryBytes > caps.maxBundleBytes) {
      // Hit the global byte cap. Mark remaining files as global-cap drops.
      globalCapTrunc += sampledFiles.length - files.length;
      break;
    }
    bundleBytes += entryBytes;
    files.push({ path: rel, content: trim.content, truncated: trim.truncated || undefined });
  }

  const initialRules = {
    ...(opts.seedFromFiles !== false ? readSeedRules(cwd) : {}),
    ...(opts.initialRules ?? {}),
  };

  return {
    folders,
    files,
    manifests: readManifests(cwd),
    initialRules,
    truncatedBy: { perFile: perFileTrunc, perFolder: perFolderTrunc, globalCap: globalCapTrunc },
    bundleBytes,
  };
}

export interface RunRichBootstrapOptions extends BuildRichBundleOptions {
  force?: boolean;
}

export interface RunRichBootstrapResult {
  bundle: RichBundle;
  response: OnboardRepoFullResponse;
}

// Build the bundle and POST it. Returns the server's job_id +
// paths_total — does NOT poll. The CLI / MCP tool drive the polling loop
// so they can render progress on their side.
export async function runRichBootstrap(
  client: ApiClient,
  opts: RunRichBootstrapOptions = {},
): Promise<RunRichBootstrapResult> {
  const bundle = buildRichBundle(opts);
  if (!bundle.folders.length && !bundle.files.length) {
    throw new Error(
      `no source folders/files found under ${opts.cwd ?? process.cwd()}. Either the repo is empty or the discovery filters excluded everything.`,
    );
  }
  const req: OnboardRepoFullRequest = {
    folders: bundle.folders,
    files: bundle.files,
    initial_rules: Object.keys(bundle.initialRules).length ? bundle.initialRules : undefined,
    manifests: Object.keys(bundle.manifests).length ? bundle.manifests : undefined,
    force: opts.force ?? false,
  };
  const response = await client.onboardRepoFull(req);
  return { bundle, response };
}
