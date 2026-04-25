// Three hero MCP tools for Trailhead: `coach`, `wiki_lookup`, `wiki_save`.
//
// The previous 7-tool surface (coach_score / coach_augment / coach_examples /
// wiki_update_learnings / wiki_context_for / wiki_rules_for / wiki_search) is
// collapsed into 3 because Copilot Chat is markedly stingier than Claude Code
// about firing tools when descriptions overlap. Three tools is the sweet
// spot: one verb each (coach / lookup / save), no overlap, no jargon in the
// short description.
//
// All previous behavior is preserved by routing inside each handler:
//   coach        → /score (+ buildAugmentation when mode='augment')
//   wiki_lookup  → /context  (file_path) and/or /search (query)
//   wiki_save    → /wiki/propose
//
// Spec ref: docs/superpowers/specs/2026-04-25-mcp-plugin-ux-design.md §3
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildAugmentation } from '@trailhead/scoring';
import type { Dimension, MissingHints } from '@trailhead/shared';
import type { ApiClient, ContextResponse, ExamplesResponse, SearchResponse } from './api-client.ts';
import { runBootstrap, runRichBootstrap } from './bootstrap.ts';
import type { WikiJobStatusResponse } from '@trailhead/shared';

// User-id is hardcoded to 'demo' — the MCP server has no real auth, matching
// the rest of the demo posture.
const COACH_USER_ID = 'demo';

// Hardcoded clarifying questions per dimension. Keeps coach's "next question"
// path off the LLM hot path — one fewer round-trip to Gemini.
const NEXT_QUESTION_BY_DIMENSION: Record<Dimension, string> = {
  context_loading:
    'Which file or function is this about?',
  constraint_articulation:
    'What constraints apply? (max attempts, idempotency, side effects, etc.)',
  output_specification:
    'What output shape do you expect? (only the changed function, full file, etc.)',
  goal_clarity:
    'What outcome are you aiming for? Be concrete.',
  specificity:
    'What exactly should change? Name the function, error, or behavior.',
};

function pickNextQuestion(
  dimensions: Record<Dimension, number>,
  missing: MissingHints,
): { dimension: Dimension; question: string } | null {
  const sorted = (Object.entries(dimensions) as Array<[Dimension, number]>)
    .filter(([, score]) => score < 7)
    .sort(([, a], [, b]) => a - b);
  if (!sorted.length) return null;
  const [lowestDim] = sorted[0]!;
  const hint = missing[lowestDim];
  const question = hint
    ? `${NEXT_QUESTION_BY_DIMENSION[lowestDim]} (gap: ${hint})`
    : NEXT_QUESTION_BY_DIMENSION[lowestDim];
  return { dimension: lowestDim, question };
}

// All tools share the same error shape so the model can react instead of
// crashing.
function asError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: 'text' as const, text: `error: ${msg}` }],
    isError: true,
  };
}

// Friendly text rendering for the layered HCL bundle. Used by wiki_lookup
// when called with a file_path.
function renderContext(res: ContextResponse, { rulesOnly = false }: { rulesOnly?: boolean } = {}): string {
  if (!res.nodes.length) return '(no wiki nodes match this path)';
  const blocks: string[] = [];
  for (const n of res.nodes) {
    const header = `## ${n.path}`;
    const body = n.body_md.trim();
    const learnings = rulesOnly
      ? []
      : n.durable_learnings.map(
          (l) => `- (${l.reinforcement_count}×) ${l.body}`,
        );
    const parts: string[] = [header];
    if (body) parts.push(body);
    if (learnings.length) parts.push('### durable learnings', ...learnings);
    blocks.push(parts.join('\n'));
  }
  return blocks.join('\n\n');
}

// Client-side fallback when the server's /search endpoint isn't deployed.
function searchInContext(res: ContextResponse, query: string): SearchResponse {
  const q = query.toLowerCase();
  const items: SearchResponse['items'] = [];
  for (const n of res.nodes) {
    if (n.body_md.toLowerCase().includes(q)) {
      items.push({ kind: 'rule', body: n.body_md, node_path: n.path });
    }
    for (const l of n.durable_learnings) {
      if (l.body.toLowerCase().includes(q)) {
        items.push({ kind: 'learning', body: l.body, node_path: n.path });
      }
    }
  }
  return { items };
}

function renderSearch(res: SearchResponse, query: string): string {
  if (!res.items.length) return `(no matches for "${query}")`;
  return res.items
    .map((it) => `- [${it.kind} @ ${it.node_path}] ${it.body}`)
    .join('\n');
}

// Render team-graduated prompts (the curriculum) for a path. Surfaced when
// wiki_lookup is called with a file_path so the LLM can offer "here's how the
// team has phrased this before" without needing a second tool call. Replaces
// the demo-completion §4.1 coach.examples passthrough.
function renderExamples(res: ExamplesResponse): string {
  if (!res.items.length) return '';
  const blocks = res.items.map((it, i) => {
    const header = `### ${i + 1}. ${it.topic ?? 'team prompt'} (${it.reuse_count}× reused @ ${it.node_path})`;
    return `${header}\n${it.template}`;
  });
  return blocks.join('\n\n');
}

// Tool descriptions exported as constants so the replay harness can reuse
// the EXACT same prose when calling Gemini. Iterating on descriptions is a
// single-file change.
export const COACH_DESC =
  'Use BEFORE answering any code task (fix, add, refactor, implement, ' +
  'change, debug). Scores the user prompt 0-10 on five dimensions and ' +
  'returns a clarifying question to ask when the score is below 7. ' +
  'Default mode="score". Use mode="augment" to rewrite the prompt ' +
  'instead of scoring.';

export const WIKI_LOOKUP_DESC =
  'Use BEFORE writing code in a known file (pass file_path) OR when ' +
  'the user asks "how do we handle X / what is our convention for Y" ' +
  '(pass query). Returns the team\'s rules, durable learnings, and ' +
  'graduated prompt examples for that path or topic. At least one of ' +
  'file_path or query is required; pass both for a path-scoped search.';

export const WIKI_SAVE_DESC =
  'Use WHEN the user states a teamwide convention ("we always X", ' +
  '"we never Y", "the rule here is Z"). Saves the convention to the ' +
  'team wiki. Server dedupes by normalized body and increments a ' +
  'reinforcement counter; an insight reinforced 3+ times is promoted ' +
  'from `draft` to `durable`.';

export const WIKI_BOOTSTRAP_DESC =
  'Use WHEN the user asks to set up Trailhead for a new repo, bootstrap ' +
  'the wiki, initialize the team wiki, or "/init" the project. Walks the ' +
  'current working directory, bundles source files, and runs LLM passes ' +
  'to populate every folder/file with a narrative summary plus draft ' +
  'learnings (Karpathy-style auto-generated wiki). Async — returns a ' +
  'job_id and polls until done (typically 30-90s). Idempotent: re-running ' +
  "leaves already-populated nodes alone. Pass mode='minimal' to skip the " +
  'LLM passes (path skeleton only, no body_md). Skips node_modules, .git, ' +
  'build output, hidden dirs.';

// =============================================================================
// Hero tool 1: `coach`
//
// Replaces the legacy coach_score + coach_augment. `mode='score'` (default)
// returns the per-dimension scores and a next clarifying question.
// `mode='augment'` rewrites the prompt with a built-in coaching addendum
// for one-shot improvement.
// =============================================================================
export function registerCoach(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'coach',
    {
      description: COACH_DESC,
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .describe("The user's exact prompt, scored as-is."),
        file_path: z
          .string()
          .optional()
          .describe(
            "Optional repo-relative file path the prompt refers to. Used to weight context_loading.",
          ),
        mode: z
          .enum(['score', 'augment'])
          .optional()
          .describe('Default "score". Use "augment" to one-shot-rewrite the prompt instead.'),
      },
      outputSchema: {
        mode: z.enum(['score', 'augment']),
        // Populated when mode='score' (always on, even after augment for visibility).
        overall: z.number().int().min(0).max(10),
        dimensions: z.object({
          goal_clarity: z.number().int().min(0).max(10),
          specificity: z.number().int().min(0).max(10),
          context_loading: z.number().int().min(0).max(10),
          constraint_articulation: z.number().int().min(0).max(10),
          output_specification: z.number().int().min(0).max(10),
        }),
        missing: z.record(z.string(), z.string()),
        next_question: z
          .object({ dimension: z.string(), question: z.string() })
          .nullable(),
        // Populated when mode='augment'.
        augmented_prompt: z.string().optional(),
        missing_dims: z.array(z.string()).optional(),
      },
    },
    async ({ prompt, file_path, mode }) => {
      try {
        const resolvedMode = mode ?? 'score';
        const score = await client.score({
          prompt,
          file_path,
          user_id: COACH_USER_ID,
        });
        const next = pickNextQuestion(score.dimensions, score.missing);

        if (resolvedMode === 'augment') {
          const augmented = buildAugmentation({
            original: prompt,
            missing: score.missing as Record<string, string>,
          });
          const missingDims = Object.keys(score.missing);
          return {
            structuredContent: {
              mode: 'augment' as const,
              overall: score.overall,
              dimensions: score.dimensions,
              missing: score.missing as Record<string, string>,
              next_question: next,
              augmented_prompt: augmented,
              missing_dims: missingDims,
            },
            content: [
              {
                type: 'text' as const,
                text:
                  `original overall: ${score.overall}/10\n` +
                  `missing: ${missingDims.length ? missingDims.join(', ') : '(none — augmentation is a no-op)'}\n\n` +
                  `--- augmented prompt ---\n${augmented}`,
              },
            ],
          };
        }

        // mode === 'score'
        const lines = [
          `overall: ${score.overall}/10`,
          ...(Object.entries(score.dimensions) as Array<[Dimension, number]>).map(
            ([d, s]) => `  ${s >= 7 ? '✓' : '✗'} ${d}: ${s}`,
          ),
        ];
        if (next) lines.push('', `next question: ${next.question}`);
        else lines.push('', 'no coaching needed (score >= 7)');
        return {
          structuredContent: {
            mode: 'score' as const,
            overall: score.overall,
            dimensions: score.dimensions,
            missing: score.missing as Record<string, string>,
            next_question: next,
          },
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (e) {
        return asError(e);
      }
    },
  );
}

// =============================================================================
// Hero tool 2: `wiki_lookup`
//
// Replaces wiki_context_for + wiki_rules_for + wiki_search. At least one of
// `file_path` and `query` is required; both can be combined for path-scoped
// search.
// =============================================================================
export function registerWikiLookup(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'wiki_lookup',
    {
      description: WIKI_LOOKUP_DESC,
      inputSchema: {
        file_path: z
          .string()
          .optional()
          .describe("Repo-relative path, e.g. 'src/api/webhooks/handler.ts'."),
        query: z
          .string()
          .optional()
          .describe("Free-text search, e.g. 'webhook idempotency'."),
        rules_only: z
          .boolean()
          .optional()
          .describe("If true, omit durable learnings AND graduated prompts; return only the rules. Default false."),
      },
    },
    async ({ file_path, query, rules_only }) => {
      try {
        if (!file_path && !query) {
          return asError(new Error('wiki_lookup requires file_path, query, or both'));
        }
        const sections: string[] = [];

        if (file_path) {
          const ctx = await client.context(file_path);
          sections.push(`# context for ${file_path}`);
          sections.push(renderContext(ctx, { rulesOnly: rules_only ?? false }));

          // Graduated team prompts for this path — rendered alongside rules so
          // the LLM can suggest the team's prior phrasing without a second
          // tool call. Skipped under rules_only.
          if (!rules_only) {
            try {
              const examples = await client.examples(file_path);
              const rendered = renderExamples(examples);
              if (rendered) {
                sections.push('# team-graduated prompts');
                sections.push(rendered);
              }
            } catch {
              // /examples 404 / 500 is non-fatal — rules + learnings are the
              // primary surface; examples are bonus context.
            }
          }

          if (query) {
            // Path-scoped search: try /search first, fall back to client-side
            // filter against the same context bundle.
            let results: SearchResponse;
            try {
              results = await client.search(query, file_path);
            } catch {
              results = searchInContext(ctx, query);
            }
            sections.push(`# search results for "${query}" (scoped to ${file_path})`);
            sections.push(renderSearch(results, query));
          }
        } else if (query) {
          // Free-text search, unscoped.
          let results: SearchResponse;
          try {
            results = await client.search(query);
          } catch {
            const ctx = await client.context('');
            results = searchInContext(ctx, query);
          }
          sections.push(`# search results for "${query}"`);
          sections.push(renderSearch(results, query));
        }

        return {
          content: [{ type: 'text' as const, text: sections.join('\n\n') }],
        };
      } catch (e) {
        return asError(e);
      }
    },
  );
}

// =============================================================================
// Hero tool 3: `wiki_save`
//
// Renames wiki_update_learnings. Same input shape, same server-side dedup +
// reinforcement-counter behavior.
// =============================================================================
export function registerWikiSave(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'wiki_save',
    {
      description: WIKI_SAVE_DESC,
      inputSchema: {
        node_path: z
          .string()
          .min(1)
          .describe(
            "Folder path the convention applies to, e.g. 'src/api/webhooks/'. Trailing slash is added if missing.",
          ),
        insight: z
          .string()
          .min(3)
          .describe('One sentence stating the convention.'),
      },
      outputSchema: {
        action: z.enum(['created', 'reinforced', 'promoted']),
        current_count: z.number().int(),
        promoted_to_durable: z.boolean().optional(),
      },
    },
    async ({ node_path, insight }) => {
      try {
        const path = node_path.endsWith('/') ? node_path : `${node_path}/`;
        const res = await client.wikiPropose({ node_path: path, insight });
        const summary =
          res.action === 'created'
            ? `created new learning at ${path} (count=1)`
            : res.action === 'reinforced'
              ? `reinforced existing learning at ${path} (count=${res.current_count})`
              : `promoted learning at ${path} to durable (count=${res.current_count})`;
        return {
          structuredContent: { ...res },
          content: [{ type: 'text' as const, text: summary }],
        };
      } catch (e) {
        return asError(e);
      }
    },
  );
}

// =============================================================================
// Hero tool 4: `wiki_bootstrap`
//
// Spin up a fresh wiki for a new repo. Walks the MCP server's working
// directory (where Claude Code / Copilot spawned us — usually the user's
// project root), upserts one node per source folder, optionally seeds
// body_md from CLAUDE.md or .github/copilot-instructions.md.
//
// Two modes:
//   - mode='minimal' (default): folder paths only, body_md seeded from
//     CLAUDE.md on root. Synchronous, fast (<1s).
//   - mode='rich' (2026-04-26 rollout): file contents bundled and sent to
//     the API; server runs three Gemini passes (folders, files, root) and
//     fills body_md with Karpathy-style narratives. Async — the tool
//     polls in-line for up to 60s, returns either the completion summary
//     or a job_id for later polling.
//
// Safe to re-run: paths that already exist are not duplicated, and existing
// non-empty body_md is not overwritten without `force=true`.
// =============================================================================

// In-tool poll deadline. Spec §9.1: tool blocks up to 60s waiting for the
// rich job; if it's still running at the deadline, return the job_id and
// let the caller poll later.
const RICH_POLL_DEADLINE_MS = 60_000;
const RICH_POLL_INTERVAL_MS = 2_000;

async function pollJob(client: ApiClient, jobId: string, deadlineMs: number): Promise<WikiJobStatusResponse> {
  const start = Date.now();
  let last: WikiJobStatusResponse | null = null;
  while (true) {
    const status = await client.jobStatus(jobId);
    last = status;
    if (status.status === 'done' || status.status === 'failed') return status;
    if (Date.now() - start >= deadlineMs) return status;
    await new Promise((r) => setTimeout(r, RICH_POLL_INTERVAL_MS));
  }
  // Unreachable, but keep TS happy.
  return last as WikiJobStatusResponse;
}

function summarizeJobStatus(status: WikiJobStatusResponse): string {
  const head =
    status.status === 'done'
      ? `Rich wiki bootstrap complete: ${status.paths_done} paths populated, ${status.paths_failed} failed.`
      : status.status === 'failed'
        ? `Rich wiki bootstrap failed: ${status.error ?? 'unknown error'}`
        : `Rich wiki bootstrap in progress: ${status.paths_done}/${status.paths_total} paths done` +
          (status.paths_failed ? ` (${status.paths_failed} failed)` : '') +
          `. Job id: ${status.job_id}. Call wiki_bootstrap again with job_id="${status.job_id}" to check again.`;
  const failures = status.paths
    .filter((p) => p.status === 'failed' && p.error)
    .slice(0, 8)
    .map((p) => `  - ${p.kind} ${p.path || '/'}: ${p.error}`);
  return failures.length
    ? `${head}\n\nRecent failures:\n${failures.join('\n')}`
    : head;
}

export function registerWikiBootstrap(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'wiki_bootstrap',
    {
      description: WIKI_BOOTSTRAP_DESC,
      inputSchema: {
        paths: z
          .array(z.string())
          .optional()
          .describe(
            "Optional explicit folder list, e.g. ['src/api/', 'src/db/']. " +
              'If omitted, the server walks its cwd and auto-discovers source folders.',
          ),
        seed_from_files: z
          .boolean()
          .optional()
          .describe(
            "If true (default), seed the wiki's root node from ./CLAUDE.md " +
              'and ./.github/copilot-instructions.md when they exist.',
          ),
        mode: z
          .enum(['minimal', 'rich'])
          .optional()
          .describe(
            "'rich' (DEFAULT) bundles file contents and asks Gemini to write per-folder, " +
              'per-file, and root narratives + extract conventions. ~30-90s, uses LLM ' +
              "credits, produces a real codebase wiki. 'minimal' skips the LLM passes " +
              'and just creates empty folder nodes seeded from CLAUDE.md — much faster, ' +
              'no LLM credits, but the wiki is empty.',
          ),
        force: z
          .boolean()
          .optional()
          .describe(
            "Default false. When true (rich mode only), overwrites bootstrap-generated body_md. " +
              'Manual edits via wiki_save are still preserved.',
          ),
        job_id: z
          .string()
          .optional()
          .describe(
            'Poll status of an in-progress rich-bootstrap job started by a previous call. ' +
              'When set, no new walk/POST happens; only status is returned.',
          ),
      },
      outputSchema: {
        // Minimal-mode fields (also populated when no work was needed)
        nodes_created: z.number().int().optional(),
        nodes_total: z.number().int().optional(),
        paths_submitted: z.array(z.string()).optional(),
        // Rich/status fields
        mode: z.enum(['minimal', 'rich', 'status']).optional(),
        job_id: z.string().optional(),
        job_status: z.enum(['pending', 'running', 'done', 'failed']).optional(),
        paths_total: z.number().int().optional(),
        paths_done: z.number().int().optional(),
        paths_failed: z.number().int().optional(),
      },
    },
    async ({ paths, seed_from_files, mode, force, job_id }) => {
      try {
        // ---- Status check path ---------------------------------------
        if (job_id) {
          const status = await pollJob(client, job_id, RICH_POLL_DEADLINE_MS);
          return {
            structuredContent: {
              mode: 'status' as const,
              job_id: status.job_id,
              job_status: status.status,
              paths_total: status.paths_total,
              paths_done: status.paths_done,
              paths_failed: status.paths_failed,
            },
            content: [{ type: 'text' as const, text: summarizeJobStatus(status) }],
          };
        }

        // Default mode is 'rich' — produces a real codebase wiki with
        // narrative body_md and extracted draft learnings on first run.
        // 'minimal' is the explicit opt-out for the path-skeleton-only path.
        const resolvedMode = mode ?? 'rich';

        // ---- Minimal mode (explicit opt-out) -------------------------
        if (resolvedMode === 'minimal') {
          const { paths: submitted, response } = await runBootstrap(client, {
            paths,
            seedFromFiles: seed_from_files !== false,
          });
          const summary =
            `Wiki bootstrapped (minimal): ${response.nodes_created} new, ` +
            `${response.nodes.length - response.nodes_created} already existed. ` +
            `Total: ${response.nodes.length} nodes across ${submitted.length} paths.`;
          return {
            structuredContent: {
              mode: 'minimal' as const,
              nodes_created: response.nodes_created,
              nodes_total: response.nodes.length,
              paths_submitted: submitted,
            },
            content: [
              {
                type: 'text' as const,
                text:
                  `${summary}\n\nPaths:\n${submitted.map((p) => `  - ${p}`).join('\n')}` +
                  `\n\nFor a Karpathy-style wiki populated from real code, call again without mode="minimal".`,
              },
            ],
          };
        }

        // ---- Rich mode (default) -------------------------------------
        const { bundle, response } = await runRichBootstrap(client, {
          folders: paths,
          seedFromFiles: seed_from_files !== false,
          force: force === true,
        });
        const status = await pollJob(client, response.job_id, RICH_POLL_DEADLINE_MS);
        const summary = summarizeJobStatus(status);
        const truncationLine =
          bundle.truncatedBy.perFile + bundle.truncatedBy.perFolder + bundle.truncatedBy.globalCap > 0
            ? `\n\nBundle: ${bundle.folders.length} folders, ${bundle.files.length} files, ${(bundle.bundleBytes / 1024).toFixed(0)} KB. ` +
              `Truncated: ${bundle.truncatedBy.perFile} files head/tail-truncated, ` +
              `${bundle.truncatedBy.perFolder} files dropped per per-folder cap, ` +
              `${bundle.truncatedBy.globalCap} dropped per global cap.`
            : `\n\nBundle: ${bundle.folders.length} folders, ${bundle.files.length} files, ${(bundle.bundleBytes / 1024).toFixed(0)} KB.`;
        return {
          structuredContent: {
            mode: 'rich' as const,
            job_id: status.job_id,
            job_status: status.status,
            paths_total: status.paths_total,
            paths_done: status.paths_done,
            paths_failed: status.paths_failed,
          },
          content: [{ type: 'text' as const, text: `${summary}${truncationLine}` }],
        };
      } catch (e) {
        return asError(e);
      }
    },
  );
}

// Convenience: register all hero tools at once.
export function registerHeroTools(server: McpServer, client: ApiClient): void {
  registerCoach(server, client);
  registerWikiLookup(server, client);
  registerWikiSave(server, client);
  registerWikiBootstrap(server, client);
}
