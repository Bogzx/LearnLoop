# mcp-server — standalone MCP server (Node binary)

The autonomous-write path. Any MCP client (Claude Code in VS Code's
integrated terminal, Claude Desktop, Continue) can call our tools to
update the wiki mid-conversation. The dramatic demo moment.

**Tech:** Node + TypeScript + MCP SDK. Published as `trailhead-mcp` on npm.

**Tools exposed (spec §7 B):**
- `wiki.context_for(file_path)`       — layered node.md + learnings stack
- `wiki.update_learnings(path, body)` — POST `/wiki/propose`
- `wiki.search(query, scope)`         — SQL ILIKE (no vector search)
- `wiki.rules_for(file_path)`         — active rules from ancestor nodes

**Install CLI:** `bin/init.ts` writes the user's `.mcp.json` and the
`.claude/settings.json` Stop hook entry. One command for the demo machine:
`npx trailhead-mcp init`.

**Talks to:** `apps/api` (POST /wiki/propose, GET /context, etc.).

**Spec refs:** §7 B, §17 (autonomous tool calls)
