# mcp-server — standalone MCP server for Trailhead

Single MCP server that wires Trailhead into both **Claude Code** and **GitHub
Copilot Chat**. STDIO transport, Node + TypeScript, MCP SDK.

**Spec:** `docs/superpowers/specs/2026-04-25-mcp-plugin-ux-design.md`

## Install

```sh
npx trailhead-mcp init
```

Autodetects which clients are available and writes:

| Target | Files |
|--------|-------|
| Claude Code | `~/.claude.json` (server entry) + `./CLAUDE.md` (directive) |
| Copilot | `.vscode/mcp.json` (server entry) + `.github/copilot-instructions.md` (directive) |

Both clients also auto-load the canonical directive from the MCP resource
`trailhead://coaching-directive`. The `.md` files are a fallback for clients
that don't auto-load resources.

Re-running `init` is idempotent — it replaces the `## Trailhead coaching`
section in both `.md` files with the latest content from
`src/coaching-directive.md`.

### Flags

```
trailhead-mcp init
  [--no-claude-code]   skip Claude Code wiring even if detected
  [--no-copilot]       skip Copilot wiring even if detected
  [--no-auto-coach]    skip writing the directive to *.md (tools still register)
  [--user-scope]       also append the directive to ~/.claude/CLAUDE.md
```

## Hero tools

The server exposes four tools, intentionally collapsed from the previous
seven-tool surface so Copilot's tool selector reliably picks the right one:

| Tool | When to call it | Routes to |
|------|-----------------|-----------|
| `coach` | Before answering any code task | `POST /score` (+ `buildAugmentation` when `mode='augment'`) |
| `wiki_lookup` | Before writing code in a known file, or when asked about team conventions | `GET /context` + `GET /examples` (file_path) and/or `GET /search` (query) |
| `wiki_save` | When the user states a teamwide convention | `POST /wiki/propose` |
| `wiki_bootstrap` | When the user asks to set up Trailhead for a new repo | `POST /onboard/repo` (idempotent path upsert) |

Plus `ping` for health checks.

## Bootstrap

```sh
# From inside any repo's root:
npx trailhead-mcp bootstrap            # auto-walks cwd
npx trailhead-mcp bootstrap --dry-run  # preview without POSTing
npx trailhead-mcp bootstrap --paths "src/api/,src/db/"   # explicit paths
```

The CLI walks the cwd up to 3 levels deep, surfaces every folder containing
at least one source file, and POSTs them to `/onboard/repo`. Folders like
`node_modules`, `.git`, `dist`, `build`, hidden dirs are auto-excluded. If
`./CLAUDE.md` or `./.github/copilot-instructions.md` exists, its contents
seed the wiki's root node (override with `--no-seed`).

The same logic is exposed as the `wiki_bootstrap` MCP tool, so the LLM can
call it when the user asks "set up Trailhead for this repo" mid-conversation.

## Coaching directive

The canonical directive lives at `src/coaching-directive.md`. Edit there.
The MCP resource `trailhead://coaching-directive` serves the same file.

The `init` script reads the file at install time and writes it verbatim into
`./CLAUDE.md` and `.github/copilot-instructions.md` so the directive ships
even if the client doesn't auto-load resources.

## Iteration

```sh
# Run a single prompt against gemini-2.5-flash with the 3 hero tools attached
npm run try -- "fix the webhook handler"

# Run the full demo-script matrix (passes/fails the same prompts the demo uses)
npm run try:matrix
```

The matrix list lives at `src/harness/matrix.json`. Edit it when the demo
script changes. `try:matrix` is the pre-commit gate — if any expected tool
doesn't fire, re-tune the description in `src/tools.ts` (the constants
`COACH_DESC`, `WIKI_LOOKUP_DESC`, `WIKI_SAVE_DESC`) or the directive in
`src/coaching-directive.md`.

`HARNESS_MODEL` env var swaps the model (default `gemini-2.5-flash`).

## End-to-end smoke

`npm run smoke` spawns the MCP server, sends real JSON-RPC, and exercises
each hero tool against the live Railway API. Use this when changing tool
internals or the API contract.

`npm run verify` is a lighter variant that prints a tool-by-tool result
table without strict assertions.
