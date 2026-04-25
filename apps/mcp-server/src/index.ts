// trailhead-mcp — standalone MCP server, registered in Claude Code or Claude
// Desktop via .mcp.json / ~/.claude/settings.json. STDIO transport.
//
// Tool names use underscores (`wiki_update_learnings`) because MCP requires
// `[a-zA-Z0-9_-]+`. The spec's dotted form (`wiki.update_learnings`) is the
// conceptual namespace; the wire-name uses underscores.
//
// IMPORTANT: nothing must write to stdout except the MCP protocol. All logs
// go to stderr — Claude Code surfaces them in its tool log.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { clientFromEnv, type ApiClient } from './api-client.ts';
import { registerWikiTools } from './tools.ts';

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
    version: '0.0.1',
  });

  registerWikiTools(server, client);

  // Pings let the demo machine confirm the server is alive even when the model
  // isn't calling any tools.
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
