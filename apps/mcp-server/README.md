# mcp-server — standalone MCP server for Trailhead

Single MCP server that wires Trailhead into both **Claude Code** and **GitHub
Copilot Chat**, multi-tenant per-repo. STDIO transport, Node + TypeScript,
MCP SDK.

**Spec:** `docs/superpowers/specs/2026-04-25-mcp-plugin-ux-design.md`

## Install

The package is not published to npm (`private: true`), so `trailhead-mcp`
does not resolve. Run the CLI from a clone of this repo — every
`trailhead-mcp` command below assumes this alias:

```sh
git clone https://github.com/Bogzx/LearnLoop && (cd LearnLoop && npm install)
alias trailhead-mcp="node $PWD/LearnLoop/apps/mcp-server/bin/cli.mjs"

cd <your repo root>
trailhead-mcp init --api-url http://localhost:3000
```

The generated `.mcp.json` / `.vscode/mcp.json` point at `src/index.ts` in that
clone by absolute path, so keep the clone where it is. They also embed the team
token — see [Team tokens are not secrets](#team-tokens-are-not-secrets) before
committing them.

Per-repo install. Each repo gets its own team token (auto-derived from the
git remote, deterministic across teammates) so wikis don't collide between
projects. Init writes:

| Target | Files | Scope |
|--------|-------|-------|
| Claude Code | `./.mcp.json` (server entry) + `./CLAUDE.md` (directive) | Project |
| Claude Code | `~/.claude.json` (only if it already had a trailhead entry, or `--user-scope`) | User |
| Copilot | `./.vscode/mcp.json` (server entry) + `./.github/copilot-instructions.md` (directive) | Workspace |

Both clients also auto-load the canonical directive from the MCP resource
`trailhead://coaching-directive`. The `.md` files are a fallback for clients
that don't auto-load resources.

Re-running `init` is idempotent — it replaces the `## Trailhead coaching`
section in both `.md` files with the latest content from
`src/coaching-directive.md`, and updates the server config in place.

### Multi-tenant behavior

Each repo carries its own team token, written into the MCP config so the
spawned server uses it automatically. Two repos with the same path (e.g.,
both have `src/api/`) end up in different teams and don't collide.

**Token derivation order:**
1. `--team-token <t>` flag (explicit override).
2. `TRAILHEAD_TEAM_TOKEN` env var.
3. `./.trailhead-team` sentinel file (sticky once written).
4. `git remote get-url origin` (deterministic; teammates cloning the same
   repo land in the same team).
5. Random `repo_local_*` token written to `./.trailhead-team` and added to
   `.gitignore` (machine-local, never committed).

The init command prints which source it picked. To switch a repo's team,
edit/delete `.trailhead-team` and re-run init, or pass `--team-token`.

### Team tokens are not secrets

The team token is the API's only credential: whoever holds it can read the
team's wiki (which the rich bootstrap fills with summaries of your source),
write to it, and `DELETE /team/data`. A token derived from the git remote is
`repo_` + the first 16 hex chars of SHA-256 of the remote URL — anyone who knows
or guesses the URL can compute it, and it is written in plain text into
`.mcp.json` and `.vscode/mcp.json`.

That is fine for the default setup, where the API is bound to `127.0.0.1`. If
your API is reachable by anyone else, pass `--team-token` with a random value
(e.g. `openssl rand -hex 16`), share it with teammates out of band, and keep the
generated MCP config files out of version control.

### Flags

```
trailhead-mcp init
  [--team-token <t>]   use this exact token (skips auto-derivation)
  [--api-url <url>]    override TRAILHEAD_API_URL (default http://localhost:3000)
  [--no-claude-code]   skip Claude Code wiring even if detected
  [--no-copilot]       skip Copilot wiring even if detected
  [--no-auto-coach]    skip writing the directive to *.md (tools still register)
  [--user-scope]       also write ~/.claude.json + ~/.claude/CLAUDE.md
```

## Hero tools

Five tools, intentionally collapsed from the previous seven-tool surface so
Copilot's tool selector reliably picks the right one:

| Tool | When to call it | Routes to |
|------|-----------------|-----------|
| `coach` | Before answering any code task | `POST /coach` (server-side teach → reveal loop, up to 5 rounds) |
| `wiki_lookup` | Before writing code in a known file, or when asked about team conventions | `GET /context` + `GET /examples` (file_path) and/or `GET /search` (query) |
| `wiki_save` | When the user states a teamwide convention | `POST /wiki/propose` |
| `wiki_bootstrap` | When the user asks to set up Trailhead for a new repo | `POST /onboard/repo` (skeleton) or `POST /onboard/repo/full` (rich) |
| `wiki_proven_prompts` | When the user wants the team's proven prompts | `GET /prompts/proven` |

Plus `ping` for health checks.

## Bootstrap

```sh
trailhead-mcp bootstrap            # default: rich mode (LLM-populated)
trailhead-mcp bootstrap --yes      # skip the prompt
trailhead-mcp bootstrap --dry-run  # preview without POSTing
trailhead-mcp bootstrap --minimal  # skeleton only (no LLM, fast, free)
trailhead-mcp bootstrap --paths "src/api/,src/db/"   # explicit paths
```

**Default is rich mode** (Karpathy-style auto-generated wiki). The CLI
walks the cwd, bundles source files, POSTs to `/onboard/repo/full`, and
the API runs three Gemini passes (per-folder, per-file, root) to fill
every `body_md` with a narrative summary and extract conventions into
draft `learnings`. Async — the CLI shows a live progress bar (~30-90s).
Re-runs are safe: already-populated nodes are left alone. Pass `--force`
to refresh bootstrap-generated body_md (manual edits via `wiki_save` are
always preserved).

**`--minimal`** is the explicit opt-out for the path-skeleton-only
behavior. Walks the cwd, upserts one node per source folder, leaves
`body_md` empty per folder; the root node is seeded from `./CLAUDE.md`
or `./.github/copilot-instructions.md` if present. Fast, free, but the
wiki has no narrative or extracted conventions until somebody calls
`wiki_save` manually.

Folders like `node_modules`, `.git`, `dist`, `build`, hidden dirs are
auto-excluded in both modes.

The same logic is exposed as the `wiki_bootstrap` MCP tool, so the LLM
can call it (defaults to rich) when the user asks "set up Trailhead for
this repo" mid-conversation.

Bootstrap targets the team identified by the cwd's token — the same one
init wrote — so two repos never share a wiki tree.

## Reset

```sh
trailhead-mcp reset           # confirmation prompt
trailhead-mcp reset --yes     # skip the prompt
```

Wipes ALL wiki data (nodes, learnings, prompts, captures, skill
observations) for the team identified by the current cwd's token. The team
row itself is preserved, so re-running with the same token continues to
land in the same id.

The demo team (`trailhead_demo_acme_2026`) is protected against accidental
nukes — the API returns 403 unless it's deployed with
`TRAILHEAD_ALLOW_DEMO_RESET=true`.

## Coaching directive

The canonical directive lives at `src/coaching-directive.md`. Edit there.
The MCP resource `trailhead://coaching-directive` serves the same file.

The `init` script reads the file at install time and writes it verbatim into
`./CLAUDE.md` and `./.github/copilot-instructions.md` so the directive ships
even if the client doesn't auto-load resources.

## Iteration

```sh
# Run a single prompt against gemini-3-flash-preview with the hero tools attached
npm run try -- "fix the webhook handler"

# Run the full demo-script matrix (the same prompts the demo uses)
npm run try:matrix
```

The matrix list lives at `src/harness/matrix.json`. `try:matrix` is the
pre-commit gate — if any expected tool doesn't fire, re-tune the description
in `src/tools.ts` (the constants `COACH_DESC`, `WIKI_LOOKUP_DESC`,
`WIKI_SAVE_DESC`, `WIKI_BOOTSTRAP_DESC`) or the directive in
`src/coaching-directive.md`.

`HARNESS_MODEL` env var swaps the model (default `gemini-3-flash-preview`).

## End-to-end smoke

`npm run smoke` spawns the MCP server, sends real JSON-RPC, and exercises
each hero tool against the API at `TRAILHEAD_API_URL` (default
`http://localhost:3000`). Use when changing tool internals or the
API contract.

`npm run verify` is a lighter variant that prints a tool-by-tool result
table without strict assertions.

## Trying it on a new repo

```sh
cd ~/code/my-other-project
trailhead-mcp init                  # auto-token from git remote, per-repo wiring
trailhead-mcp bootstrap             # walk cwd, create wiki nodes
# ... use Claude Code / Copilot normally; the wiki for THIS repo grows ...
trailhead-mcp reset                 # if you want to wipe and start over
```

The wiki is fully isolated from any other repo's wiki. The demo team's
seeded data is also unaffected.
