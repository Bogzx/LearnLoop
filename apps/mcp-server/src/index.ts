// trailhead-mcp — standalone MCP server, registered in Claude Code via
// ~/.claude.json and in Copilot via .vscode/mcp.json. STDIO transport.
//
// Tool names use underscores because MCP requires `[a-zA-Z0-9_-]+`. The 3
// hero tools — `coach`, `wiki_lookup`, `wiki_save` — replace the previous
// 7-tool surface (see docs/superpowers/specs/2026-04-25-mcp-plugin-ux-design.md).
//
// IMPORTANT: nothing must write to stdout except the MCP protocol. All logs
// go to stderr — Claude Code surfaces them in its tool log.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { clientFromEnv, type ApiClient } from './api-client.ts';
import { COACHING_DIRECTIVE_TEXT, COACHING_DIRECTIVE_URI } from './directive.ts';
import { registerHeroTools } from './tools.ts';

function log(msg: string): void {
  process.stderr.write(`[trailhead-mcp] ${msg}\n`);
}

async function main(): Promise<void> {
  let client: ApiClient;
  try {
    client = clientFromEnv();
  } catch (e) {
    log(`fatal: ${(e as Error).message}`);
    process.exit(1);
  }

  const server = new McpServer({
    name: 'trailhead',
    version: '0.1.0',
  });

  // 3 hero tools.
  registerHeroTools(server, client);

  // Coaching directive as an MCP resource. Both Claude Code and Copilot can
  // read this URI to pull the canonical instructions. The init script also
  // inlines the directive into CLAUDE.md / copilot-instructions.md as a
  // fallback for clients that don't auto-read resources.
  server.registerResource(
    'coaching-directive',
    COACHING_DIRECTIVE_URI,
    {
      title: 'Trailhead coaching directive',
      description:
        'Always-on instructions for when to call coach, wiki_lookup, and wiki_save. ' +
        'Read this resource at session start; the rules apply to every code task.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'text/markdown',
          text: COACHING_DIRECTIVE_TEXT,
        },
      ],
    }),
  );

  // Health check — useful when nothing else is firing.
  server.registerTool(
    'ping',
    {
      description: 'Health check — confirms the trailhead-mcp server is alive and reachable.',
      inputSchema: {},
      outputSchema: { ok: z.literal(true), message: z.string() },
    },
    async () => ({
      structuredContent: { ok: true as const, message: 'trailhead-mcp ok' },
      content: [{ type: 'text', text: 'trailhead-mcp ok' }],
    }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('connected via stdio transport');
}

main().catch((e) => {
  log(`unhandled: ${(e as Error).stack ?? (e as Error).message}`);
  process.exit(1);
});
