// MCP tool implementations. Each tool wraps an HTTP call to the Trailhead API
// in a stable structured-content shape. Errors are returned as
// `isError: true` content blocks so the model can react instead of crashing.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ApiClient, ContextResponse, SearchResponse } from './api-client.ts';

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
