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
import { runBootstrap } from './bootstrap.ts';

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
  'current working directory and creates one wiki node per source folder ' +
  '(skipping node_modules, .git, build output). Idempotent — safe to re-run.';

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
// Safe to re-run: paths that already exist are not duplicated, and existing
// non-empty body_md is not overwritten.
// =============================================================================
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
      },
      outputSchema: {
        nodes_created: z.number().int(),
        nodes_total: z.number().int(),
        paths_submitted: z.array(z.string()),
      },
    },
    async ({ paths, seed_from_files }) => {
      try {
        const { paths: submitted, response } = await runBootstrap(client, {
          paths,
          seedFromFiles: seed_from_files !== false,
        });
        const summary =
          `Wiki bootstrapped: ${response.nodes_created} new, ` +
          `${response.nodes.length - response.nodes_created} already existed. ` +
          `Total: ${response.nodes.length} nodes across ${submitted.length} paths.`;
        return {
          structuredContent: {
            nodes_created: response.nodes_created,
            nodes_total: response.nodes.length,
            paths_submitted: submitted,
          },
          content: [
            {
              type: 'text' as const,
              text: `${summary}\n\nPaths:\n${submitted.map((p) => `  - ${p}`).join('\n')}`,
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
}
