// MCP tool implementations. Each tool wraps an HTTP call to the Trailhead API
// in a stable structured-content shape. Errors are returned as
// `isError: true` content blocks so the model can react instead of crashing.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildAugmentation } from '@trailhead/scoring';
import type { Dimension, MissingHints } from '@trailhead/shared';
import type { ApiClient, ContextResponse, SearchResponse } from './api-client.ts';

// Question hints for the always-on coach (spec: 2026-04-25-demo-completion-design.md
// §4.1). Hardcoded so coach_score doesn't need an extra LLM round-trip — keeps
// the always-on directive cheap. v2 polish would let the LLM phrase its own.
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

// Lowest-scoring dimension in the result drives the next clarifying question.
// Returns null when nothing is below 7 (no coaching needed).
function pickNextQuestion(
  dimensions: Record<Dimension, number>,
  missing: MissingHints,
): { dimension: Dimension; question: string } | null {
  const sorted = (Object.entries(dimensions) as Array<[Dimension, number]>)
    .filter(([, score]) => score < 7)
    .sort(([, a], [, b]) => a - b);
  if (!sorted.length) return null;
  const [lowestDim] = sorted[0]!;
  // Prefer the API's missing hint (specific to the prompt) over the static
  // fallback (generic, dimension-only).
  const hint = missing[lowestDim];
  const question = hint
    ? `${NEXT_QUESTION_BY_DIMENSION[lowestDim]} (gap: ${hint})`
    : NEXT_QUESTION_BY_DIMENSION[lowestDim];
  return { dimension: lowestDim, question };
}

// All tools share the same error shape: a single `text` content block with
// the message, plus `isError: true`. The model sees a tool error and can
// decide to retry or apologize.
function asError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: 'text' as const, text: `error: ${msg}` }],
    isError: true,
  };
}

// Friendly text rendering for the layered HCL bundle. Used by both
// wiki_context_for (full bundle) and wiki_rules_for (rules only).
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

// Client-side fallback search when the server doesn't ship /search yet.
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

export function registerWikiTools(server: McpServer, client: ApiClient): void {
  // (1) wiki_update_learnings — the dramatic demo call.
  server.registerTool(
    'wiki_update_learnings',
    {
      description:
        'Save a teamwide engineering convention to the wiki. Server dedupes by ' +
        'normalized body and increments a reinforcement counter; an insight ' +
        'reinforced 3+ times is promoted from `draft` to `durable`. Use this when ' +
        "the user states a convention (e.g. 'we always use exponential backoff " +
        "with jitter here').",
      inputSchema: {
        node_path: z
          .string()
          .min(1)
          .describe(
            "Folder path (relative, trailing slash) the learning applies to, e.g. 'src/api/webhooks/'.",
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
        // Normalize trailing slash defensively — the spec requires it for
        // the HCL ancestor query but the model may forget.
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

  // (2) wiki_context_for — layered HCL bundle.
  server.registerTool(
    'wiki_context_for',
    {
      description:
        "Return the team's hierarchical context for a given file path: " +
        'concatenated node.md from each ancestor folder plus durable learnings, ' +
        'ordered shallow → deep. Call this before answering a code question to ' +
        "use the team's conventions.",
      inputSchema: {
        file_path: z
          .string()
          .min(1)
          .describe(
            "Repo-relative file path, e.g. 'src/api/webhooks/handler.ts'. The server resolves ancestor folders.",
          ),
      },
    },
    async ({ file_path }) => {
      try {
        const res = await client.context(file_path);
        return {
          content: [{ type: 'text' as const, text: renderContext(res) }],
        };
      } catch (e) {
        return asError(e);
      }
    },
  );

  // (3) wiki_rules_for — same as context_for but rules-only.
  server.registerTool(
    'wiki_rules_for',
    {
      description:
        "Return only the rules / node.md content from each ancestor folder " +
        'of a given file path (no durable learnings). Lighter-weight than ' +
        'wiki_context_for when you only need the conventions.',
      inputSchema: {
        file_path: z
          .string()
          .min(1)
          .describe("Repo-relative file path, e.g. 'src/api/webhooks/handler.ts'."),
      },
    },
    async ({ file_path }) => {
      try {
        const res = await client.context(file_path);
        return {
          content: [
            { type: 'text' as const, text: renderContext(res, { rulesOnly: true }) },
          ],
        };
      } catch (e) {
        return asError(e);
      }
    },
  );

  // (4) wiki_search — ILIKE on learnings/rules. Falls back to client-side
  // filter against wiki_context_for output if /search isn't deployed.
  server.registerTool(
    'wiki_search',
    {
      description:
        "Search the team's wiki rules and durable learnings for a query string. " +
        "Use to recall a known convention without specifying a path (e.g. 'how do " +
        "we handle webhook idempotency').",
      inputSchema: {
        query: z.string().min(1).describe('Free-text search query.'),
        scope: z
          .string()
          .optional()
          .describe(
            "Optional folder scope, e.g. 'src/api/'. If omitted, searches the whole wiki.",
          ),
      },
    },
    async ({ query, scope }) => {
      try {
        let result: SearchResponse;
        try {
          result = await client.search(query, scope);
        } catch {
          // /search isn't live yet — fall back to context-walk + ILIKE.
          const ctx = await client.context(scope ?? '');
          result = searchInContext(ctx, query);
        }
        const lines = result.items.map(
          (it) => `- [${it.kind} @ ${it.node_path}] ${it.body}`,
        );
        const text = lines.length
          ? lines.join('\n')
          : `(no matches for "${query}")`;
        return { content: [{ type: 'text' as const, text }] };
      } catch (e) {
        return asError(e);
      }
    },
  );
}

// =============================================================================
// Coach tools — spec: 2026-04-25-demo-completion-design.md §4
//
// These tools mirror the browser-extension coaching loop on the MCP surface.
// The always-on directive in CLAUDE.md (written by `bin/init.ts --auto-coach`)
// instructs the host LLM to call `coach_score` before answering any code
// task and to ask the returned `next_question` if the score is < 7.
//
// User-id is hardcoded to 'demo' to match the rest of the demo posture; the
// MCP server has no real auth.
// =============================================================================

const COACH_USER_ID = 'demo';

export function registerCoachTools(server: McpServer, client: ApiClient): void {
  // (1) coach_score — score the user's prompt and surface the lowest-scoring
  // dimension as a clarifying question for the host LLM to ask the user.
  server.registerTool(
    'coach_score',
    {
      description:
        "Score a developer's draft prompt on five dimensions (goal_clarity, " +
        'specificity, context_loading, constraint_articulation, ' +
        'output_specification, each 0-10). Returns overall, per-dimension scores, ' +
        'missing-hints, and a `next_question` the LLM should ask the user when ' +
        'overall < 7. When overall >= 7, `next_question` is null and the LLM ' +
        'should proceed without coaching.',
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .describe("The user's draft prompt, scored as-is."),
        file_path: z
          .string()
          .optional()
          .describe(
            "Optional repo-relative file path the prompt refers to, e.g. 'src/api/webhooks/handler.ts'. Used by the scorer to weight context_loading.",
          ),
      },
      outputSchema: {
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
          .object({
            dimension: z.string(),
            question: z.string(),
          })
          .nullable(),
      },
    },
    async ({ prompt, file_path }) => {
      try {
        const res = await client.score({
          prompt,
          file_path,
          user_id: COACH_USER_ID,
        });
        const next = pickNextQuestion(res.dimensions, res.missing);
        const summaryLines = [
          `overall: ${res.overall}/10`,
          ...(Object.entries(res.dimensions) as Array<[Dimension, number]>).map(
            ([d, s]) => `  ${s >= 7 ? '✓' : '✗'} ${d}: ${s}`,
          ),
        ];
        if (next) {
          summaryLines.push('', `next question: ${next.question}`);
        } else {
          summaryLines.push('', 'no coaching needed (score >= 7)');
        }
        return {
          structuredContent: {
            overall: res.overall,
            dimensions: res.dimensions,
            missing: res.missing as Record<string, string>,
            next_question: next,
          },
          content: [{ type: 'text' as const, text: summaryLines.join('\n') }],
        };
      } catch (e) {
        return asError(e);
      }
    },
  );

  // (2) coach_examples — surface the team's graduated prompts for a path.
  // Lets the LLM offer "here's how the team has handled this before" before
  // asking the user to refine.
  server.registerTool(
    'coach_examples',
    {
      description:
        "Return the team's top graduated prompts (templates) for a given file " +
        "path, ranked by reuse_count. Use to show the user how the team has " +
        'phrased similar requests before.',
      inputSchema: {
        file_path: z
          .string()
          .min(1)
          .describe("Repo-relative file path, e.g. 'src/api/webhooks/handler.ts'."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Max prompts to return (default 3).'),
      },
    },
    async ({ file_path, limit }) => {
      try {
        const res = await client.examples(file_path);
        const items = limit ? res.items.slice(0, limit) : res.items;
        if (!items.length) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `(no graduated team prompts match ${file_path})`,
              },
            ],
          };
        }
        const blocks = items.map((it, i) => {
          const header = `### ${i + 1}. ${it.topic ?? 'team prompt'} (${it.reuse_count}× reused @ ${it.node_path})`;
          return `${header}\n${it.template}`;
        });
        return {
          content: [{ type: 'text' as const, text: blocks.join('\n\n') }],
        };
      } catch (e) {
        return asError(e);
      }
    },
  );

  // (3) coach_augment — return the prompt rewritten with a coaching addendum
  // that asks the AI itself to clarify before answering. The MCP equivalent
  // of the browser ext's "Have Claude clarify" button. Useful when the user
  // wants the LLM to refine the prompt mechanically rather than answer
  // clarifying questions interactively.
  server.registerTool(
    'coach_augment',
    {
      description:
        "Rewrite the user's prompt to ask the AI to first clarify with 2-3 " +
        'questions before answering. Mechanical equivalent of the browser ' +
        'extension\'s "Have Claude clarify" button. Use when the user wants ' +
        'a one-shot improvement instead of multi-turn coaching.',
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .describe('The original prompt to augment.'),
        file_path: z
          .string()
          .optional()
          .describe('Optional repo-relative file path the prompt refers to.'),
      },
      outputSchema: {
        augmented_prompt: z.string(),
        missing_dims: z.array(z.string()),
        original_overall: z.number().int().min(0).max(10),
      },
    },
    async ({ prompt, file_path }) => {
      try {
        const score = await client.score({
          prompt,
          file_path,
          user_id: COACH_USER_ID,
        });
        const augmented = buildAugmentation({
          original: prompt,
          missing: score.missing as Record<string, string>,
        });
        const missingDims = Object.keys(score.missing);
        return {
          structuredContent: {
            augmented_prompt: augmented,
            missing_dims: missingDims,
            original_overall: score.overall,
          },
          content: [
            {
              type: 'text' as const,
              text: `original overall: ${score.overall}/10\nmissing: ${missingDims.length ? missingDims.join(', ') : '(none — augmentation is a no-op)'}\n\n--- augmented prompt ---\n${augmented}`,
            },
          ],
        };
      } catch (e) {
        return asError(e);
      }
    },
  );
}
