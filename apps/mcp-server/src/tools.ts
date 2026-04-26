// Four hero MCP tools for Trailhead: `coach`, `wiki_lookup`, `wiki_save`,
// `wiki_bootstrap`.
//
// Previous 7-tool surface (coach_score / coach_augment / coach_examples /
// wiki_update_learnings / wiki_context_for / wiki_rules_for / wiki_search) is
// collapsed because Copilot Chat is markedly stingier than Claude Code about
// firing tools when descriptions overlap.
//
// As of 2026-04-26 (educational-loop redesign), `coach` is a thin forwarder
// to the API's POST /coach endpoint, which drives the teach→reveal cycle
// server-side. The `proceed` boolean and rendered `text` are the only inputs
// the directive needs. Spec ref:
//   docs/superpowers/specs/2026-04-26-trailhead-educational-loop-design.md
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ApiClient, ContextResponse, ExamplesResponse, SearchResponse } from './api-client.ts';
import { runBootstrap, runRichBootstrap } from './bootstrap.ts';
import type { WikiJobStatusResponse } from '@trailhead/shared';

// User-id is hardcoded to 'demo' — the MCP server has no real auth, matching
// the rest of the demo posture.
const COACH_USER_ID = 'demo';

// 5-dim score block. Returned as a factory rather than a shared constant
// because zod-to-json-schema dedupes shared object identity into `$ref`
// references, and at least one popular MCP client (Gemini Antigravity, as of
// 2026-04-26) crashes with "Cannot read properties of undefined (reading
// 'invoke')" when the tool schema contains internal `$ref`s. Calling this
// factory at each usage produces a fresh object and forces the converter to
// inline the schema every time.
function dimensionScoresSchema() {
  return z.object({
    goal_clarity: z.number().int().min(0).max(10),
    specificity: z.number().int().min(0).max(10),
    context_loading: z.number().int().min(0).max(10),
    constraint_articulation: z.number().int().min(0).max(10),
    output_specification: z.number().int().min(0).max(10),
  });
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

// Strip the per-file "## Source" embed that rich-bootstrap writes into a
// file node's body_md. The host LLM already has Read access to the file;
// the embed is a frozen snapshot from bootstrap time and inflates response
// size by 5-10× without adding new signal. Removed at render so we don't
// have to re-bootstrap to get the win.
//
// (^|\n) anchor handles BOTH "## Source" at the start of body_md (file
// nodes always lead with it) and mid-body Source headers in folder/root
// narratives. Lookahead preserves the trailing \n before the next ## so
// adjacent sections stay separated after the strip.
function stripSourceEmbed(md: string): string {
  return md.replace(/(?:^|\n)## Source[\s\S]*?(?=\n## |$)/g, '');
}

// Trim the layered HCL bundle to the requested depth. 'file' → only the
// deepest node (typically the file itself). 'folder' → file + immediate
// parent folder. 'full' → all ancestors including root narrative.
type LookupDepth = 'file' | 'folder' | 'full';
function trimNodesByDepth<T>(nodes: T[], depth: LookupDepth): T[] {
  if (depth === 'full' || nodes.length <= 1) return nodes;
  const take = depth === 'file' ? 1 : 2;
  return nodes.slice(-take);
}

// Friendly text rendering for the layered HCL bundle. Used by wiki_lookup
// when called with a file_path.
function renderContext(res: ContextResponse, { rulesOnly = false }: { rulesOnly?: boolean } = {}): string {
  if (!res.nodes.length) return '(no wiki nodes match this path)';
  const blocks: string[] = [];
  for (const n of res.nodes) {
    const header = `## ${n.path}`;
    const body = stripSourceEmbed(n.body_md).trim();
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

// Window the body around the first match so a 5KB rule body doesn't dump
// in full. Falls back to the head when the query isn't a literal substring
// (e.g. /search returned a node because the query matched its path).
const SEARCH_SNIPPET_WINDOW = 240;
function snippet(body: string, query: string, window = SEARCH_SNIPPET_WINDOW): string {
  const trimmed = body.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= window) return trimmed;
  const idx = trimmed.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return `${trimmed.slice(0, window).trim()}…`;
  const half = Math.floor(window / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(trimmed.length, start + window);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < trimmed.length ? '…' : '';
  return `${prefix}${trimmed.slice(start, end).trim()}${suffix}`;
}

function renderSearch(res: SearchResponse, query: string): string {
  if (!res.items.length) return `(no matches for "${query}")`;
  return res.items
    .map((it) => `- [${it.kind} @ ${it.node_path}] ${snippet(it.body, query)}`)
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
//
// DESIGN NOTE on imperative tone: every description is written to OUTRANK
// the host LLM's native tools (Read, Grep, Glob, file-search). Coach must
// fire before any code task; wiki_lookup must replace native filesystem
// exploration whenever team conventions might apply. Soft "consider using"
// phrasing reliably loses to Read/Grep — only "DO NOT X without first
// calling Y" survives the host LLM's bias toward its built-in tools.
export const COACH_DESC =
  'MANDATORY before answering ANY code task — fix, add, refactor, ' +
  'implement, change, debug, optimize, rename, write, design, plan, ' +
  'or explain code. DO NOT produce code or a code plan without ' +
  'calling coach first. Scores the user prompt 0-10 on five ' +
  'dimensions (goal_clarity, specificity, context_loading, ' +
  'constraint_articulation, output_specification) and drives an ' +
  'educational coaching loop. The tool returns { proceed, text, ' +
  'next_round_inputs? }: when proceed=false, relay text VERBATIM ' +
  "and call coach again with the user's reply concatenated to the " +
  'prompt and the previous next_round_inputs.round_token echoed ' +
  'back as the new `round_token` argument (one field, less surface ' +
  'for the LLM to drop than the four-field shape). When proceed=true, ' +
  'relay any non-empty text and produce your answer — the server ' +
  'embeds the graduation banner in `text` itself when applicable, so ' +
  'no extra sentence is needed. Use mode=\'skip_reveal\' if the user ' +
  'dismisses coaching mid-loop. NEVER skip this tool to "save time" — ' +
  'the score-arc IS the user-facing product.';

export const WIKI_LOOKUP_DESC =
  'MANDATORY before reading source files, grepping the repo, or ' +
  'globbing for patterns. Replaces native Read/Grep/Glob for any ' +
  'question about team conventions, prior decisions, code style, ' +
  'or "how we do X here". CALL THIS INSTEAD of: (a) reading a file ' +
  'just to understand its conventions — pass file_path; (b) grepping ' +
  'for "how is auth handled" — pass query; (c) browsing folders to ' +
  'learn the codebase — pass file_path of any file in the folder. ' +
  'Returns the team\'s rules, durable learnings, and graduated prompt ' +
  'examples — distilled context the wiki has already curated, so you ' +
  'do not have to re-derive it from raw source. At least one of ' +
  'file_path or query is required; pass both for a path-scoped ' +
  'search. Falling back to Read/Grep is allowed ONLY after wiki_lookup ' +
  'returns no relevant results for the file or topic.';

export const WIKI_SAVE_DESC =
  'MANDATORY whenever the user states a teamwide convention, rule, or ' +
  'standard. Trigger phrases include: "we always X", "we never Y", ' +
  '"the rule here is Z", "team convention is", "make sure to always", ' +
  '"we standardized on", "from now on", "going forward", "by default ' +
  'we", "our pattern for X is". Call this BEFORE proceeding with the ' +
  'task — the save is fast and the user expects the durable record. ' +
  'NEVER ask permission first; silently saving the convention IS the ' +
  'point. Server dedupes by normalized body and increments a ' +
  'reinforcement counter; an insight reinforced 3+ times is promoted ' +
  'from `draft` to `durable`. Calling twice with the same insight is ' +
  'safe and reinforces the count.';

export const WIKI_PROVEN_PROMPTS_DESC =
  'MANDATORY when the user asks for proven prompts, the team\'s best ' +
  'prompts, gold-standard examples, "what\'s worked before", "show me ' +
  'top prompts", or any phrasing that implies "give me the team\'s ' +
  'highest-rated prompt library". Returns every prompt graduated by ' +
  'coach (overall >= 7 by gate; the actual score is on each row so the ' +
  'caller can filter ≥8 / ≥9). Differs from wiki_lookup, which is path-' +
  'anchored and returns conventions + a single curated example: this ' +
  'tool is the FULL graduated library, ranked by score then reuse. ' +
  'Optional filters: min_score (default 7), file_path (scope to ancestor ' +
  'nodes), topic, limit (default 20, max 100). Use this for discovery; ' +
  'use wiki_lookup for "how does this team do X".';

export const WIKI_BOOTSTRAP_DESC =
  'MANDATORY when the user asks to set up Trailhead, bootstrap the ' +
  'wiki, initialize the team wiki, "/init" the project, or "create the ' +
  'Trailhead wiki for this codebase". Also fire this when wiki_lookup ' +
  'returns empty for a file_path that obviously exists in the repo — ' +
  'an empty wiki means bootstrap was never run. Walks the current ' +
  'working directory, bundles source files, and runs LLM passes to ' +
  'populate every folder/file with a narrative summary plus draft ' +
  'learnings (Karpathy-style auto-generated wiki). Async — returns a ' +
  'job_id and polls until done (typically 30-90s). Idempotent: re-' +
  "running leaves already-populated nodes alone. Pass mode='minimal' " +
  'to skip the LLM passes (path skeleton only, no body_md) ONLY when ' +
  'the user explicitly asks for a fast/free skeleton. Skips ' +
  'node_modules, .git, build output, hidden dirs.';

// =============================================================================
// Hero tool 1: `coach`
//
// Thin forwarder to POST /coach. The API drives the teach→reveal loop server-
// side; this tool's only job is to surface `proceed` and `text` to the host
// LLM with minimal ceremony.
//
// Inputs from round 2+ (or `mode: 'skip_reveal'`) include the round-state
// fields (`original_prompt`, `original_dimensions`, `previous_dimensions`,
// `round`) — the directive instructs the LLM to echo back whatever was in
// `next_round_inputs` from the previous coach response.
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
          .describe(
            "Round 1: the user's exact prompt. Round 2+: original prompt + the user's reply, concatenated.",
          ),
        file_path: z
          .string()
          .optional()
          .describe(
            'Optional repo-relative file path the prompt refers to. Used for wiki-anchored examples and weighting context_loading.',
          ),
        mode: z
          .enum(['score', 'skip_reveal', 'augment'])
          .optional()
          .describe(
            "Default 'score' (the teach→reveal loop). Pass 'skip_reveal' when the user dismisses coaching ('skip', 'just do it', etc.). 'augment' is a legacy passthrough that one-shot rewrites the prompt.",
          ),
        original_prompt: z
          .string()
          .optional()
          .describe(
            "Round 2+ / skip_reveal only. The user's first prompt of this coaching session — echoed from next_round_inputs.original_prompt.",
          ),
        original_dimensions: dimensionScoresSchema().optional().describe(
          "Round 2+ / skip_reveal only. Echoed from next_round_inputs.original_dimensions.",
        ),
        previous_dimensions: dimensionScoresSchema().optional().describe(
          "Round 2+ only. Echoed from next_round_inputs.previous_dimensions. Used by the server to detect no-progress.",
        ),
        round: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe('Round 2+ only. Echoed from next_round_inputs.round. Server clamps to [1, 5].'),
        round_token: z
          .string()
          .optional()
          .describe(
            'Round 2+ shorthand. Echo the `round_token` field from the previous response\'s next_round_inputs verbatim. ' +
              'When set, the server reconstructs round state from this single value and ignores the four explicit fields ' +
              '(original_prompt / original_dimensions / previous_dimensions / round) — fewer slots for an LLM to drop.',
          ),
      },
      outputSchema: {
        proceed: z.boolean(),
        mode: z.enum(['score', 'skip_reveal', 'augment']),
        overall: z.number().int().min(0).max(10),
        dimensions: dimensionScoresSchema(),
        missing: z.record(z.string(), z.string()),
        text: z.string(),
        next_round_inputs: z
          .object({
            original_prompt: z.string(),
            original_dimensions: dimensionScoresSchema(),
            previous_dimensions: dimensionScoresSchema(),
            round: z.number().int(),
            round_token: z.string(),
          })
          .optional(),
        augmented_prompt: z.string().optional(),
        missing_dims: z.array(z.string()).optional(),
      },
    },
    async (input) => {
      try {
        const res = await client.coach({
          prompt: input.prompt,
          file_path: input.file_path,
          mode: input.mode,
          original_prompt: input.original_prompt,
          original_dimensions: input.original_dimensions,
          previous_dimensions: input.previous_dimensions,
          round: input.round,
          round_token: input.round_token,
          user_id: COACH_USER_ID,
        });

        // Surface a human-readable rendering for the tool log. The directive
        // tells the LLM to read structuredContent (`proceed`, `text`); this
        // text is mostly for debug.
        let logText: string;
        if (res.text && res.text.trim()) {
          logText = res.text;
        } else if (res.proceed && res.mode === 'score') {
          logText = `(coach overall: ${res.overall}/10 — no coaching needed)`;
        } else if (res.mode === 'augment') {
          logText =
            `original overall: ${res.overall}/10\n` +
            `missing: ${(res.missing_dims ?? []).join(', ') || '(none — augmentation is a no-op)'}\n\n` +
            `--- augmented prompt ---\n${res.augmented_prompt ?? ''}`;
        } else {
          logText = `(coach overall: ${res.overall}/10)`;
        }

        return {
          structuredContent: { ...res },
          content: [{ type: 'text' as const, text: logText }],
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
        depth: z
          .enum(['file', 'folder', 'full'])
          .optional()
          .describe(
            "Limits how many ancestor wiki nodes to include. " +
              "'file' = deepest node only. 'folder' (DEFAULT) = file + immediate parent. " +
              "'full' = whole ancestor chain (root narrative included). " +
              "Use 'full' only when team-wide context is needed; the default is right for code tasks.",
          ),
      },
    },
    async ({ file_path, query, rules_only, depth }) => {
      try {
        if (!file_path && !query) {
          return asError(new Error('wiki_lookup requires file_path, query, or both'));
        }
        const sections: string[] = [];
        const resolvedDepth: LookupDepth = depth ?? 'folder';

        if (file_path) {
          // Fan out the three independent reads in parallel. /examples and
          // /search failures are non-fatal: rules + learnings are the
          // primary surface and we fall back to a client-side substring
          // search over the context bundle when /search is unavailable.
          const [ctxRaw, examplesRaw, searchRaw] = await Promise.all([
            client.context(file_path),
            !rules_only
              ? client.examples(file_path).catch(() => null)
              : Promise.resolve(null),
            query ? client.search(query, file_path).catch(() => null) : Promise.resolve(null),
          ]);

          const ctx: ContextResponse = {
            nodes: trimNodesByDepth(ctxRaw.nodes, resolvedDepth),
          };
          sections.push(`# context for ${file_path}`);
          sections.push(renderContext(ctx, { rulesOnly: rules_only ?? false }));

          if (examplesRaw) {
            const rendered = renderExamples(examplesRaw);
            if (rendered) {
              sections.push('# team-graduated prompts');
              sections.push(rendered);
            }
          }

          if (query) {
            const results = searchRaw ?? searchInContext(ctxRaw, query);
            sections.push(`# search results for "${query}" (scoped to ${file_path})`);
            sections.push(renderSearch(results, query));
          }
        } else if (query) {
          // Free-text search, unscoped. /search is the only path that works
          // here — the previous fallback called /context with empty path,
          // which the API rejects with 400 missing_path (the GET requires a
          // non-empty `?path=`). Surface a clear error instead.
          const results = await client.search(query);
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

// =============================================================================
// Hero tool 5: `wiki_proven_prompts`
//
// Returns every graduated prompt for the team — the full library, not a
// path-scoped curated pick. Complements wiki_lookup: lookup answers "how
// does this team do X for THIS file", proven_prompts answers "what are
// the team's best prompts overall" (or scoped to a path/topic on demand).
// =============================================================================
function renderProvenPrompts(items: { template: string; topic: string | null; reuse_count: number; graduated_overall_score: number; node_path: string; author_user_id: string | null }[]): string {
  if (!items.length) return '(no graduated prompts match the filters)';
  return items
    .map((it, i) => {
      const meta = [
        `${it.graduated_overall_score}/10`,
        `${it.reuse_count}× reuse`,
        `@ ${it.node_path}`,
        it.topic ? `topic=${it.topic}` : null,
        it.author_user_id ? `author=${it.author_user_id}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return `### ${i + 1}. ${meta}\n${it.template}`;
    })
    .join('\n\n');
}

export function registerWikiProvenPrompts(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'wiki_proven_prompts',
    {
      description: WIKI_PROVEN_PROMPTS_DESC,
      inputSchema: {
        min_score: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe(
            'Minimum overall score 0-10 (default 7). Every graduated prompt is ≥7 by /coach gate, so values <7 just include all of them.',
          ),
        file_path: z
          .string()
          .optional()
          .describe(
            "Optional path scope, e.g. 'src/api/webhooks/'. Returns only prompts attached to ancestors of this path.",
          ),
        topic: z
          .string()
          .optional()
          .describe("Optional exact-match topic filter, e.g. 'retry', 'auth', 'webhook'."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Max prompts to return. Default 20, max 100.'),
      },
      outputSchema: {
        items: z.array(
          z.object({
            id: z.string(),
            template: z.string(),
            topic: z.string().nullable(),
            reuse_count: z.number().int(),
            graduated_overall_score: z.number().int(),
            author_user_id: z.string().nullable(),
            node_path: z.string(),
            created_at: z.string(),
          }),
        ),
      },
    },
    async ({ min_score, file_path, topic, limit }) => {
      try {
        const res = await client.provenPrompts({
          minScore: min_score,
          path: file_path,
          topic,
          limit,
        });
        const heading = `# proven prompts (${res.items.length}${typeof min_score === 'number' ? `, min ${min_score}/10` : ''}${file_path ? `, scoped to ${file_path}` : ''}${topic ? `, topic=${topic}` : ''})`;
        return {
          structuredContent: { items: res.items },
          content: [
            {
              type: 'text' as const,
              text: `${heading}\n\n${renderProvenPrompts(res.items)}`,
            },
          ],
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
  registerWikiProvenPrompts(server, client);
}
