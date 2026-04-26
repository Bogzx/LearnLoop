// Rich-bootstrap async worker. Triggered by POST /onboard/repo/full's
// setImmediate; never imported elsewhere on the hot path.
//
// Three passes (spec §6):
//   1. Folders — for each folder, build a Karpathy-style narrative page
//      from the file contents inside that folder. Output schema enforced
//      by Gemini Flash.
//   2. Files — for each code file, a short summary using the file content
//      AND the folder's narrative as cross-context.
//   3. Root — one call that takes every folder narrative + manifests +
//      root-file seed text and produces the repo overview.
//
// Concurrency: 4 in flight per pass (spec §7). Hard time budget: 10 min;
// breaches mark remaining paths as failed and the job ends `done` with
// paths_failed > 0.
//
// Bundle (file contents) lives in memory only — never persisted on the
// server. Privacy: the API discards the bundle when runJob returns. Only
// generated `body_md` and `learnings.body` text reaches the DB.
//
// Spec ref: docs/superpowers/specs/2026-04-26-wiki-bootstrap-rich-design.md
import { GoogleGenAI, Type } from '@google/genai';
import { normalize as normalizeBody } from '@trailhead/scoring';
import type {
  OnboardRepoFullFile,
  OnboardRepoFullRequest,
  WikiJobPathKind,
} from '@trailhead/shared';
import { q, upsertNode } from './db.ts';

// Reuse the same client GEMINI_API_KEY env var — the API server's index.ts
// asserts this is set on startup so we can lean on it being present.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Flash for all three passes (spec §6 reasoning). Sourced from the shared
// model registry so a single rename in packages/scoring/src/models.mjs
// flows everywhere — was a hardcoded 'gemini-2.5-flash' before the
// 2026-04-26 migration to gemini-3-flash-preview.
import { SCORE_MODEL } from '@trailhead/scoring';
const MODEL = SCORE_MODEL;

// Per spec §7. Hard ceilings the worker enforces regardless of what the
// client sent.
const CONCURRENCY = 4;
const TIME_BUDGET_MS = 10 * 60 * 1000;       // 10 minutes
const MAX_OUTPUT_TOKENS_FOLDER = 4_000;
const MAX_OUTPUT_TOKENS_FILE = 700;
const MAX_OUTPUT_TOKENS_ROOT = 5_000;

// Per-call timeout. Same posture as gemini.ts withRetry: timeouts are
// non-retryable to avoid the repetition-loop class of failures (2026-04-25
// incident). One long Gemini call hanging shouldn't take down the job.
const PER_CALL_TIMEOUT_MS = 90_000;

// Cap on raw source we embed in a file node's body_md. The team-context
// bundle injected into Claude.ai sends concatenates body_md across every
// node in the picked subtree — at 3000 chars/file, a 20-file folder
// produces a ~60 KB context blob, which is comfortable in Claude.ai's
// window and Gemini's 1M one. Larger files get head/tail truncation with
// an "[N chars omitted]" marker so the LLM knows the middle is missing.
const MAX_SOURCE_CHARS = 3000;

// ============================================================================
// Public entry
// ============================================================================

export interface JobBundle {
  folders: string[];                                  // folder-shaped, e.g. 'src/api/'
  files: OnboardRepoFullFile[];                       // file-shaped, with content
  manifests: Record<string, string>;
  initialRules: Record<string, string>;
  force: boolean;
}

export function bundleFromRequest(body: OnboardRepoFullRequest): JobBundle {
  return {
    folders: body.folders ?? [],
    files: body.files ?? [],
    manifests: body.manifests ?? {},
    initialRules: body.initial_rules ?? {},
    force: body.force === true,
  };
}

// runJob is fire-and-forget. The endpoint that creates the job row calls
// `setImmediate(() => runJob(...))` and immediately returns the job_id.
// Errors are caught and recorded on the wiki_jobs row; nothing throws to
// the caller.
export async function runJob(jobId: string, teamId: string, bundle: JobBundle): Promise<void> {
  const startedAt = new Date();
  try {
    await q(
      `UPDATE wiki_jobs SET status = 'running', started_at = $1 WHERE id = $2`,
      [startedAt, jobId],
    );

    const deadline = startedAt.getTime() + TIME_BUDGET_MS;

    // ---- Pass 1: folders -------------------------------------------------
    // Group files by their immediate parent folder. The folder LLM call
    // sees every file inside that folder (subject to the client-side
    // sampling already applied in the bundle).
    const filesByFolder = new Map<string, OnboardRepoFullFile[]>();
    for (const f of bundle.files) {
      const idx = f.path.lastIndexOf('/');
      const folder = idx === -1 ? '' : `${f.path.slice(0, idx)}/`;
      const arr = filesByFolder.get(folder) ?? [];
      arr.push(f);
      filesByFolder.set(folder, arr);
    }

    const folderNarratives = new Map<string, string>();   // folder path → narrative_md
    await runWithConcurrency(bundle.folders, CONCURRENCY, async (folder) => {
      if (Date.now() > deadline) {
        await markPathFailed(jobId, folder, 'time_budget_exceeded');
        return;
      }
      // Pre-flight: skip the LLM call entirely when the row is already
      // populated (and we're not forcing a refresh). Saves Gemini tokens
      // on incidental re-runs. The DB write below would have no-op'd
      // anyway via the upsert WHERE clause; this just avoids the wasted
      // LLM round-trip.
      if (await shouldSkipPath(teamId, folder, bundle.force)) {
        await markPathDone(jobId, folder);
        return;
      }
      await markPathRunning(jobId, folder);
      try {
        const filesInFolder = filesByFolder.get(folder) ?? [];
        const out = await callFolderPass(folder, filesInFolder);
        await writeFolderNode(teamId, folder, out, bundle.force);
        folderNarratives.set(folder, out.narrative_md);
        await markPathDone(jobId, folder);
      } catch (e) {
        const msg = errMsg(e);
        console.error(`[wiki-job ${jobId}] folder pass failed for ${folder}: ${msg}`);
        await markPathFailed(jobId, folder, msg);
      }
    });

    // ---- Pass 2: files ---------------------------------------------------
    // File pass: each file gets the folder's narrative as cross-context so
    // the per-file page can reference siblings without re-deriving.
    await runWithConcurrency(bundle.files, CONCURRENCY, async (file) => {
      if (Date.now() > deadline) {
        await markPathFailed(jobId, file.path, 'time_budget_exceeded');
        return;
      }
      if (await shouldSkipPath(teamId, file.path, bundle.force)) {
        await markPathDone(jobId, file.path);
        return;
      }
      await markPathRunning(jobId, file.path);
      try {
        const idx = file.path.lastIndexOf('/');
        const folder = idx === -1 ? '' : `${file.path.slice(0, idx)}/`;
        const folderNarrative = folderNarratives.get(folder) ?? '';
        const out = await callFilePass(file, folder, folderNarrative);
        await writeFileNode(teamId, file, out, bundle.force);
        await markPathDone(jobId, file.path);
      } catch (e) {
        const msg = errMsg(e);
        console.error(`[wiki-job ${jobId}] file pass failed for ${file.path}: ${msg}`);
        await markPathFailed(jobId, file.path, msg);
      }
    });

    // ---- Pass 3: root ----------------------------------------------------
    if (Date.now() > deadline) {
      await markPathFailed(jobId, '', 'time_budget_exceeded');
    } else if (await shouldSkipPath(teamId, '', bundle.force)) {
      await markPathDone(jobId, '');
    } else {
      await markPathRunning(jobId, '');
      try {
        const out = await callRootPass({
          folderNarratives: Array.from(folderNarratives.entries()),
          manifests: bundle.manifests,
          initialRules: bundle.initialRules,
        });
        await writeRootNode(teamId, out, bundle.initialRules, bundle.force);
        await markPathDone(jobId, '');
      } catch (e) {
        const msg = errMsg(e);
        console.error(`[wiki-job ${jobId}] root pass failed: ${msg}`);
        await markPathFailed(jobId, '', msg);
      }
    }

    await q(
      `UPDATE wiki_jobs SET status = 'done', finished_at = NOW() WHERE id = $1`,
      [jobId],
    );
  } catch (e) {
    const msg = errMsg(e);
    console.error(`[wiki-job ${jobId}] fatal error: ${msg}`);
    try {
      await q(
        `UPDATE wiki_jobs SET status = 'failed', finished_at = NOW(), error = $1 WHERE id = $2`,
        [msg, jobId],
      );
    } catch (e2) {
      console.error(`[wiki-job ${jobId}] could not record failure: ${errMsg(e2)}`);
    }
  }
}

// ============================================================================
// LLM passes
// ============================================================================

interface FolderPassOutput {
  narrative_md: string;
  conventions: string[];
  gotchas: string[];
}

async function callFolderPass(folderPath: string, files: OnboardRepoFullFile[]): Promise<FolderPassOutput> {
  const truncationNote = files.some((f) => f.truncated)
    ? '\n\nNote: some file contents below have been head/tail-truncated. Hedge any claims that depend on the middle of the file.'
    : '';
  const filesBlock = files.length === 0
    ? '(no files in this folder were included in the bundle — write a brief overview based on the folder path itself)'
    : files.map((f) => `### ${f.path}${f.truncated ? ' [truncated]' : ''}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');

  const userPrompt =
    `You are documenting the folder \`${folderPath || '/'}\` of a software repository for a Karpathy-style auto-generated wiki. ` +
    `Output a single Markdown document with these sections in this order:\n\n` +
    `1. Overview — 2-4 sentences answering "what is this folder for?"\n` +
    `2. Architecture / data flow — prose only (no diagrams). How the pieces interact. Skip if there's nothing to say.\n` +
    `3. Key files — bullet list. Each: \`**filename.ext**\` then 2-3 sentences citing the most important exports/functions. Optional 5-15 line code excerpt where it clarifies behavior.\n` +
    `4. Conventions — bullet list of rules visible in the code (e.g., "All errors return JSON \`{error, detail}\`"). Each one MUST also be returned in the conventions[] array. Skip the section if you can't find any.\n` +
    `5. Gotchas — bullet list of non-obvious invariants, "don't do X" comments, workarounds. Each MUST also be returned in gotchas[]. Skip the section if you can't find any.\n` +
    `6. See also — cross-links to parent and obvious sibling folders, e.g. \`[src/api/](src/api/)\`. Use just the parent path if no clear siblings.\n\n` +
    `Target length: 800-1500 words. Write for a new joiner who has never seen this codebase. ` +
    `Do not invent behavior — if a file's purpose is unclear, say so.${truncationNote}\n\n` +
    `=== Files in \`${folderPath || '/'}\` ===\n\n${filesBlock}`;

  const resp = await withTimeout(
    () => ai.models.generateContent({
      model: MODEL,
      contents: userPrompt,
      config: {
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: MAX_OUTPUT_TOKENS_FOLDER,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['narrative_md', 'conventions', 'gotchas'],
          properties: {
            narrative_md: { type: Type.STRING },
            conventions:  { type: Type.ARRAY, items: { type: Type.STRING } },
            gotchas:      { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
      },
    }),
    `folder(${folderPath})`,
  );
  return parseStructured<FolderPassOutput>(resp, ['narrative_md']);
}

interface FilePassOutput {
  narrative_md: string;
  conventions: string[];
}

async function callFilePass(
  file: OnboardRepoFullFile,
  folderPath: string,
  folderNarrative: string,
): Promise<FilePassOutput> {
  const folderHint = folderNarrative
    ? `\n\nFolder context (already-written narrative for \`${folderPath || '/'}\`):\n${folderNarrative.slice(0, 4_000)}\n`
    : '';

  const userPrompt =
    `You are documenting the file \`${file.path}\`${file.truncated ? ' (content head/tail-truncated)' : ''} for a Karpathy-style wiki. ` +
    `Output a single short Markdown document with these sections:\n\n` +
    `1. One paragraph (2-4 sentences) summarizing what the file does.\n` +
    `2. Key exports — bullet list, one line each (function/type name + one-line purpose).\n` +
    `3. Notes — optional bullet for any gotcha or non-obvious behavior. Omit the section if there is nothing.\n\n` +
    `Target length: 100-200 words. Be concrete, name actual exports. Do not invent behavior. ` +
    `Conventions visible in this file (e.g. "throws on invalid input", "logs to stderr only") MUST be returned in the conventions[] array — short imperative phrases, one rule each.${folderHint}\n\n` +
    `=== \`${file.path}\` ===\n\`\`\`\n${file.content}\n\`\`\``;

  const resp = await withTimeout(
    () => ai.models.generateContent({
      model: MODEL,
      contents: userPrompt,
      config: {
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: MAX_OUTPUT_TOKENS_FILE,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['narrative_md', 'conventions'],
          properties: {
            narrative_md: { type: Type.STRING },
            conventions:  { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
      },
    }),
    `file(${file.path})`,
  );
  return parseStructured<FilePassOutput>(resp, ['narrative_md']);
}

interface RootPassOutput {
  narrative_md: string;
}

async function callRootPass(args: {
  folderNarratives: Array<[string, string]>;
  manifests: Record<string, string>;
  initialRules: Record<string, string>;
}): Promise<RootPassOutput> {
  // Truncate per-folder summaries before stitching so we don't blow the
  // input window. Each folder gets the first ~1500 chars of its narrative.
  const folderBlock = args.folderNarratives
    .map(([path, narrative]) => `### \`${path || '/'}\`\n${narrative.slice(0, 1500)}`)
    .join('\n\n');

  const manifestBlock = Object.keys(args.manifests).length
    ? Object.entries(args.manifests).map(([name, content]) => `### \`${name}\`\n\`\`\`\n${content}\n\`\`\``).join('\n\n')
    : '(no manifest files found)';

  const seedBlock = args.initialRules['']?.trim()
    ? `\n\n=== Existing root conventions (from CLAUDE.md / copilot-instructions.md) ===\n${args.initialRules['']}`
    : '';

  const userPrompt =
    `You are writing the top-level page of a Karpathy-style auto-generated wiki for a software repository. ` +
    `You will see a per-folder summary for every folder in the repo, plus the project's manifest files. ` +
    `Output a single Markdown document with these sections in this order:\n\n` +
    `1. The pitch — 2-4 paragraphs answering "what is this codebase?" Written for a new joiner. Concrete; name actual subsystems.\n` +
    `2. Subsystem index — bullet list, every TOP-LEVEL folder (depth 1, e.g. \`apps/\`, \`packages/\`) on its own line: \`[apps/](apps/)\` — one-line description of what lives there.\n` +
    `3. Tech stack — bullet list derived from the manifest files. Languages, frameworks, key dependencies.\n` +
    `4. Conventions — bullet list of repo-wide rules. Include verbatim any rules from the existing root-conventions block, plus any cross-cutting patterns visible across multiple folder summaries.\n\n` +
    `Target length: 1500-2500 words. Concrete, no marketing fluff.\n\n` +
    `=== Per-folder summaries ===\n\n${folderBlock}\n\n` +
    `=== Manifests ===\n\n${manifestBlock}${seedBlock}`;

  const resp = await withTimeout(
    () => ai.models.generateContent({
      model: MODEL,
      contents: userPrompt,
      config: {
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: MAX_OUTPUT_TOKENS_ROOT,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['narrative_md'],
          properties: {
            narrative_md: { type: Type.STRING },
          },
        },
      },
    }),
    'root',
  );
  return parseStructured<RootPassOutput>(resp, ['narrative_md']);
}

// ============================================================================
// DB writes (idempotency rules per spec §4.1 / §8)
// ============================================================================

async function writeFolderNode(teamId: string, path: string, out: FolderPassOutput, force: boolean): Promise<void> {
  await upsertBootstrapNode(teamId, path, out.narrative_md, force);
  for (const insight of out.conventions) await proposeLearning(teamId, path, insight);
  for (const insight of out.gotchas)     await proposeLearning(teamId, path, insight);
}

async function writeFileNode(
  teamId: string,
  file: OnboardRepoFullFile,
  out: FilePassOutput,
  force: boolean,
): Promise<void> {
  // body_md = source first, summary second. The team-context bundle
  // (apps/api/src/team-context.ts) feeds body_md straight to Claude.ai
  // and Gemini, so this is the difference between the LLM seeing real
  // code vs. just a description of the file. Source goes first so that
  // when the bundle is truncated downstream, the most concrete material
  // is what survives.
  const cappedSource = capSource(file.content, MAX_SOURCE_CHARS);
  const lang = langFor(file.path);
  const truncatedNote = file.truncated || cappedSource !== file.content
    ? ' (truncated)'
    : '';
  const bodyMd =
    `## Source${truncatedNote}\n\`\`\`${lang}\n${cappedSource}\n\`\`\`\n\n` +
    `## Summary\n${out.narrative_md}`;
  await upsertBootstrapNode(teamId, file.path, bodyMd, force);
  for (const insight of out.conventions) await proposeLearning(teamId, file.path, insight);
}

// Head/tail truncation that keeps both ends of the file. Picks half the
// budget for the head and half for the tail with an explicit "[N chars
// omitted]" marker so the LLM knows the middle is missing and can hedge.
function capSource(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const half = Math.floor(maxChars / 2) - 50;
  const head = content.slice(0, half);
  const tail = content.slice(-half);
  const omitted = content.length - 2 * half;
  return `${head}\n\n... [${omitted} chars omitted] ...\n\n${tail}`;
}

// Best-effort language hint for the markdown code fence — purely cosmetic
// (helps the LLM pattern-match the dialect). Falls back to '' which renders
// as a plain code fence.
function langFor(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return '';
  const ext = path.slice(dot + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php',
    sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
    md: 'markdown', json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml',
    html: 'html', css: 'css', scss: 'scss', vue: 'vue', svelte: 'svelte',
    dart: 'dart', ex: 'elixir', exs: 'elixir', erl: 'erlang',
  };
  return map[ext] ?? '';
}

async function writeRootNode(
  teamId: string,
  out: RootPassOutput,
  initialRules: Record<string, string>,
  force: boolean,
): Promise<void> {
  // The initial-rules text from CLAUDE.md / copilot-instructions.md is
  // surfaced verbatim within the LLM-generated overview (the prompt told
  // the model to include it). No separate seed concat here.
  void initialRules;
  await upsertBootstrapNode(teamId, '', out.narrative_md, force);
}

// Pre-flight skip check (mirror of the WHERE clause in upsertBootstrapNode).
// Returns true when the LLM call should be skipped because the resulting
// upsert would be a no-op anyway. Saves Gemini tokens on incidental re-runs.
//
// Spec §4.1 / §8 idempotency rule:
//   - body_md = ''                                 → never skip (empty rows always fillable)
//   - body_source = 'bootstrap', force = true      → never skip (refresh allowed)
//   - body_source = 'bootstrap', force = false     → SKIP (default re-run is no-op)
//   - body_source = 'manual',    body_md non-empty → SKIP (manual edits inviolate)
async function shouldSkipPath(teamId: string, path: string, force: boolean): Promise<boolean> {
  const rows = await q<{ body_md: string; body_source: string }>(
    `SELECT body_md, body_source FROM nodes WHERE team_id = $1 AND path = $2 LIMIT 1`,
    [teamId, path],
  );
  if (rows.length === 0) return false;        // node doesn't exist → fillable
  const r = rows[0]!;
  if (r.body_md === '') return false;         // empty body → fillable
  if (r.body_source === 'manual') return true; // manual edits never overwritten
  // body_source = 'bootstrap': overwrite only with force
  return !force;
}

// Body upsert with the spec §4.1 protection rule: don't clobber manual
// edits, allow overwriting empty rows always, allow overwriting bootstrap-
// generated rows only with force=true. Returns whether a write actually
// happened.
async function upsertBootstrapNode(
  teamId: string,
  path: string,
  bodyMd: string,
  force: boolean,
): Promise<boolean> {
  // First insert the row if it doesn't exist (path-only, body empty so the
  // protection rule below treats it as fillable). Then conditionally update
  // body_md based on the current body_source state.
  await q(
    `INSERT INTO nodes (team_id, path, body_md, body_source)
       VALUES ($1, $2, '', 'manual')
     ON CONFLICT (team_id, path) DO NOTHING`,
    [teamId, path],
  );

  const updated = await q<{ id: string }>(
    `UPDATE nodes
        SET body_md = $3,
            body_source = 'bootstrap',
            updated_at = NOW()
      WHERE team_id = $1 AND path = $2
        AND (
          body_md = ''
          OR (body_source = 'bootstrap' AND $4::boolean = true)
        )
      RETURNING id`,
    [teamId, path, bodyMd, force],
  );
  return updated.length > 0;
}

// Replicates the /wiki/propose dedup: insert-or-reinforce on
// (node_id, body_normalized). Promotes to durable at >= 3.
async function proposeLearning(teamId: string, nodePath: string, insight: string): Promise<void> {
  const trimmed = insight.trim();
  if (!trimmed) return;
  // Skip pathologically long bullet text — the LLM occasionally returns a
  // wall of prose where it should have returned one rule. 400 chars covers
  // any sane convention; longer entries are likely malformed.
  if (trimmed.length > 400) return;

  const nodeId = await upsertNode(teamId, nodePath);
  const norm = normalizeBody(trimmed);
  if (!norm) return;

  const existing = await q<{ id: string }>(
    `SELECT id FROM learnings WHERE node_id = $1 AND body_normalized = $2 LIMIT 1`,
    [nodeId, norm],
  );
  if (existing.length === 0) {
    await q(
      `INSERT INTO learnings (node_id, body, body_normalized) VALUES ($1, $2, $3)`,
      [nodeId, trimmed, norm],
    );
  } else {
    await q(
      `UPDATE learnings
          SET reinforcement_count = reinforcement_count + 1,
              last_seen_at = NOW(),
              status = CASE WHEN reinforcement_count + 1 >= 3 THEN 'durable' ELSE status END
        WHERE id = $1`,
      [existing[0]!.id],
    );
  }
}

// ============================================================================
// wiki_job_paths state machine
// ============================================================================

async function markPathRunning(jobId: string, path: string): Promise<void> {
  await q(
    `UPDATE wiki_job_paths SET status = 'running' WHERE job_id = $1 AND path = $2`,
    [jobId, path],
  );
}

async function markPathDone(jobId: string, path: string): Promise<void> {
  await q(
    `UPDATE wiki_job_paths SET status = 'done' WHERE job_id = $1 AND path = $2`,
    [jobId, path],
  );
  await q(
    `UPDATE wiki_jobs SET paths_done = paths_done + 1 WHERE id = $1`,
    [jobId],
  );
}

async function markPathFailed(jobId: string, path: string, error: string): Promise<void> {
  await q(
    `UPDATE wiki_job_paths SET status = 'failed', error = $3 WHERE job_id = $1 AND path = $2`,
    [jobId, path, error.slice(0, 500)],
  );
  await q(
    `UPDATE wiki_jobs SET paths_failed = paths_failed + 1 WHERE id = $1`,
    [jobId],
  );
}

// ============================================================================
// Helpers
// ============================================================================

// Bounded-concurrency pool. Promise.all(items.map(fn)) would fan out the
// whole list at once and DOS the Gemini key on a 200-folder repo. This
// caps the in-flight count at `cap`.
async function runWithConcurrency<T>(items: T[], cap: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let nextIdx = 0;
  const workers: Promise<void>[] = [];
  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) return;
      await fn(items[i]!);
    }
  };
  for (let i = 0; i < Math.min(cap, items.length); i++) workers.push(worker());
  await Promise.all(workers);
}

// Hard timeout. Mirrors gemini.ts withRetry's posture but without retries —
// repetition-loop risk is real on long-form prose and the time budget at
// the job level (10 min) is the safety net.
function withTimeout<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`__trailhead_timeout__:${label}`)), PER_CALL_TIMEOUT_MS);
  });
  return Promise.race([fn(), timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }) as Promise<T>;
}

type GenResp = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };

function extractAnswer(resp: GenResp): string {
  const parts = resp.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => p.thought !== true && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
}

function tryParseJson<T = unknown>(raw: string): T | null {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end > start) s = s.slice(start, end + 1);
  try { return JSON.parse(s) as T; } catch { return null; }
}

function parseStructured<T extends object>(resp: GenResp, requiredStrings: (keyof T & string)[]): T {
  const text = extractAnswer(resp);
  const parsed = tryParseJson<T>(text);
  if (!parsed) throw new Error('LLM response not parseable as JSON');
  for (const k of requiredStrings) {
    const v = (parsed as Record<string, unknown>)[k];
    if (typeof v !== 'string' || !v.trim()) {
      throw new Error(`LLM response missing required string field: ${k}`);
    }
  }
  return parsed;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
