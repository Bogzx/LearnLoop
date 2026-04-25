# Trailhead MCP Plugin UX — Design

**Date:** 2026-04-25
**Status:** Draft, pending implementation plan
**Scope:** The `apps/mcp-server` surface, install flow, and iteration harness. Does not change the API, scoring model, dashboard, browser extension, or Claude Code Stop hook.

## 1. Goal

Make the Trailhead MCP plugin land on a real dev's machine in **one command**, fire reliably in both **Claude Code** and **GitHub Copilot Chat**, and produce a visible coaching moment on the first prompt.

The work optimizes for two loops simultaneously:
- **Real-dev simulation** — unobtrusive enough to use for hours.
- **Demo-judge moment** — reliable enough to script and stage.

## 2. Non-Goals

- No API, scoring, or dashboard changes.
- No new LLM provider; Gemini stays.
- No browser-ext or Stop-hook changes.
- No support for clients beyond Claude Code and Copilot Chat in this iteration. Continue, Cursor, etc. will inherit Copilot's `.vscode/mcp.json` shape but are not explicitly tested.

## 3. The 3 Hero Tools

The current 7 MCP tools (`coach_score`, `coach_examples`, `coach_augment`, `wiki_update_learnings`, `wiki_context_for`, `wiki_rules_for`, `wiki_search`) are collapsed to **3 hero tools** that route to the existing logic. This reduces tool-selector confusion in Copilot, which is markedly stingier than Claude Code about firing tools when descriptions overlap.

| Tool | Purpose | Routes internally to |
|------|---------|----------------------|
| `coach` | Score a draft prompt; return rubric + next question; optionally rewrite | `coach_score` + `coach_augment` |
| `wiki_lookup` | Fetch team conventions for a file path or free-text query | `wiki_context_for` + `wiki_rules_for` + `wiki_search` |
| `wiki_save` | Save a stated convention; server dedupes + reinforces | `wiki_update_learnings` |

`coach_examples` is dropped from the hero surface (low demo value, high overlap with `wiki_lookup`). Its underlying endpoint remains available; if needed later, it returns from `wiki_lookup` when the path matches a graduated prompt.

### 3.1 `coach`

```
inputSchema:
  prompt: string (required, min 1)
  file_path?: string
  mode?: "score" | "augment"   // default "score"
```

- `mode: "score"` — returns `{ overall, dimensions, missing, next_question }`. Same shape as today's `coach_score`.
- `mode: "augment"` — returns `{ augmented_prompt, missing_dims, original_overall }`. Same shape as today's `coach_augment`.

The directive (§4) tells the model to default to `mode: "score"` and only switch to `"augment"` when the user explicitly asks for a rewrite or when the host LLM has decided to one-shot the clarification on the user's behalf.

### 3.2 `wiki_lookup`

```
inputSchema:
  file_path?: string   // for path-scoped lookup
  query?: string       // for free-text search
  rules_only?: boolean // default false; true = no durable learnings
```

At least one of `file_path` / `query` is required (validated client-side; if both omitted, return `isError: true`). When both are provided, results are merged: path-scoped context first, then search results scoped to the same path.

### 3.3 `wiki_save`

```
inputSchema:
  node_path: string (required, min 1, trailing slash auto-added)
  insight: string (required, min 3)
```

Identical to today's `wiki_update_learnings`, just renamed. Returns `{ action, current_count, promoted_to_durable? }`.

### 3.4 Tool Description Tuning

Descriptions are tuned for Copilot's tool selector:
- Open with the trigger condition ("Use before answering...", "Use when the user states...").
- One concrete example phrase per tool.
- Avoid jargon ("HCL bundle", "node_path") in user-facing description text; keep that in field descriptions.

The replay harness (§6) is the iteration loop for these descriptions.

## 4. Coaching Directive as MCP Resource

### 4.1 Canonical source

A new MCP resource `trailhead://coaching-directive` is registered by the server. Content is loaded at server start from `apps/mcp-server/src/coaching-directive.md` (imported as a string). Editing the directive is a single-file change.

### 4.2 Content (~400 words, 3 sections)

1. **When to call `coach`** — verbs that trigger it (fix, add, refactor, implement, change, debug). What to do when `overall < 7` (ask `next_question` and wait) vs `>= 7` (proceed).
2. **When to call `wiki_lookup`** — before writing code that touches a known file path; when the user asks how the team handles X.
3. **When to call `wiki_save`** — when the user states a teamwide convention (signal phrases: "we always", "we never", "team convention is").

### 4.3 Loading strategy (dual-mode)

- **Primary:** the resource itself. `init` writes a one-line pointer in `CLAUDE.md` and `.github/copilot-instructions.md` saying "follow `trailhead://coaching-directive`".
- **Fallback:** the *full* directive is also inlined into both files during `init`. If a client doesn't auto-load the resource, the inlined copy still steers the model.

The MCP server is the source of truth. The two `.md` files are caches kept in sync by `init`.

## 5. Setup UX

### 5.1 One command, autodetect

```
$ npx trailhead-mcp init
✓ Claude Code detected (~/.claude.json)
  → registered MCP server "trailhead"
  → appended coaching directive to ./CLAUDE.md
✓ Copilot detected (.vscode/ found)
  → wrote .vscode/mcp.json
  → appended coaching directive to .github/copilot-instructions.md
✓ Coaching directive resource available at trailhead://coaching-directive
```

### 5.2 Detection rules

- **Claude Code:** wire if `~/.claude.json` is writable OR `~/.claude/` exists.
- **Copilot:** wire if `.vscode/` exists in cwd OR the `code` binary is on PATH.
- **Neither detected:** print a manual-install snippet and exit 0.

### 5.3 Files written for Copilot

- `.vscode/mcp.json` — workspace-scoped MCP server entry pointing at `trailhead-mcp run` with `TRAILHEAD_API_URL` and `TRAILHEAD_TEAM_TOKEN` env vars.
- `.github/copilot-instructions.md` — appends a `## Trailhead coaching` section with the resource pointer and the inlined directive.

### 5.4 Idempotency

Re-running `init` replaces the `## Trailhead coaching` section in place; never duplicates. Same guarantee already in place for Claude Code.

### 5.5 Cwd safety

`init` warns if cwd has no `package.json` and no `.git/` directory ("are you sure this is your project root?") because Copilot's `.vscode/mcp.json` is workspace-scoped and silent misconfiguration is worse than a one-line warning.

### 5.6 Override flags

- `--no-claude-code`, `--no-copilot` — skip a target even if detected.
- `--no-auto-coach` — skip the directive write (existing flag, preserved).
- `--user-scope` — also append to user-global config (Claude Code: `~/.claude/CLAUDE.md`; Copilot: VS Code user settings).

## 6. Iteration Harness

### 6.1 `npm run try`

A local replay harness for iterating on tool descriptions without spinning up an IDE.

```
$ npm run try -- "fix the webhook handler"
→ model picked: coach
   args: { prompt: "fix the webhook handler", mode: "score" }
[harness] OK — coach fired correctly.
```

Lives at `apps/mcp-server/src/harness/try.ts`.

**Behavior:**
1. Imports the 3 hero tool definitions from `tools.ts` (no duplication).
2. Loads `coaching-directive.md`.
3. Builds a Gemini-Flash request: directive as system prompt + tools attached + user prompt.
4. Prints which tool the model picked, args, and (with `--verbose`) the model's stated reason.
5. **Mocks tool execution by default.** `--live` flag hits the real API.

**Why Gemini-Flash, not the real Claude/Copilot:** `GEMINI_API_KEY` already wired; free-tier; tool-call behavior is close enough to catch description regressions; sub-second turnaround.

### 6.2 `npm run try:matrix`

Runs a fixed list of demo prompts and prints a pass/fail table:

```
prompt                              expected     actual    ✓/✗
"fix the webhook handler"           coach        coach      ✓
"how do we handle idempotency?"     wiki_lookup  coach      ✗
"we always use jitter here"         wiki_save    wiki_save  ✓
```

The matrix list **is** the demo script. One command pre-commit reveals whether the demo will land.

The matrix list lives in `apps/mcp-server/src/harness/matrix.json` — an array of `{ prompt, expected_tool }` objects. Editing the demo script is a single-file change.

## 7. Architecture Diagram

```
                          ┌──────────────────────┐
                          │  apps/mcp-server     │
                          │                      │
     resource             │  ┌────────────────┐  │
  trailhead://            │  │ coaching-      │  │
  coaching-directive ◄────┼──┤ directive.md   │  │
                          │  └────────────────┘  │
     tools                │  ┌────────────────┐  │
  coach        ───────────┼──┤ tools.ts       │  │   ┌────────────┐
  wiki_lookup  ───────────┼──┤ (3 hero tools) ├──┼──►│ apps/api   │
  wiki_save    ───────────┼──┤                │  │   │ (HTTP)     │
                          │  └────────────────┘  │   └────────────┘
                          │  ┌────────────────┐  │
                          │  │ harness/       │  │
                          │  │ try.ts +       │  │
                          │  │ matrix.json    │  │
                          │  └────────────────┘  │
                          └──────────┬───────────┘
                                     │
                ┌────────────────────┼────────────────────┐
                │                    │                    │
                ▼                    ▼                    ▼
      ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
      │ Claude Code     │  │ Copilot Chat    │  │ Gemini-Flash    │
      │ ~/.claude.json  │  │ .vscode/        │  │ (harness only)  │
      │ ./CLAUDE.md     │  │ mcp.json        │  │                 │
      │                 │  │ .github/        │  │                 │
      │                 │  │ copilot-        │  │                 │
      │                 │  │ instructions.md │  │                 │
      └─────────────────┘  └─────────────────┘  └─────────────────┘
```

## 8. File Touchpoints (preview)

- `apps/mcp-server/src/tools.ts` — collapse to 3 hero tools; preserve internal routing.
- `apps/mcp-server/src/coaching-directive.md` — **new**, the canonical directive.
- `apps/mcp-server/src/index.ts` — register the directive as an MCP resource.
- `apps/mcp-server/src/harness/try.ts` — **new**, replay harness.
- `apps/mcp-server/src/harness/matrix.json` — **new**, demo prompt list.
- `apps/mcp-server/bin/init.mjs` — autodetect Claude Code + Copilot; write Copilot files; idempotent section replacement.
- `apps/mcp-server/package.json` — add `try` and `try:matrix` scripts.
- `apps/mcp-server/README.md` — update for the new surface.

## 9. Success Criteria

- `npx trailhead-mcp init` from a fresh project root wires both Claude Code and Copilot in under 5 seconds.
- All 3 hero tools fire on at least 5 of 6 demo-script prompts in `try:matrix` against Gemini-Flash.
- Re-running `init` does not duplicate any section in `CLAUDE.md` or `copilot-instructions.md`.
- A live demo: opening Copilot Chat, typing `"fix the webhook handler"`, results in `coach` firing and a clarifying question being posed within 3 seconds.

## 10. Risks

- **Copilot resource auto-loading is flaky.** Mitigation: inline directive fallback in `copilot-instructions.md`.
- **Copilot's tool selector still skips tools even with sharp descriptions.** Mitigation: `try:matrix` catches regressions; demo prompts are explicitly tuned to fire each tool at least once.
- **Renaming tools breaks anything that hard-codes the old names.** Mitigation: outside `apps/mcp-server`, the only references to the 7 old names are (a) one help-text comment in `apps/dashboard/src/components/wiki-tree.tsx:110` (cosmetic — update during this work), and (b) test/smoke files inside `apps/mcp-server` which are part of the rename scope. The browser ext, API, and Stop hook talk to `apps/api` HTTP endpoints directly, not via MCP tool names, so they are unaffected.
