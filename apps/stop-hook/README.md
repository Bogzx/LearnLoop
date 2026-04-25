# stop-hook — Claude Code Stop hook (deterministic backstop)

The autonomy reliability layer. Fires after every Claude Code assistant
turn, extracts candidate learnings via Haiku, POSTs to `/wiki/propose`.
Server-side dedup ensures no double-counting with the MCP path.

**Tech:** Bash entrypoint (`trailhead-hook.sh`) + Node script. Wrapped in
try/catch — failures go to stderr only (Claude Code doesn't surface them
as user-visible errors, so a crash is silent).

**Behavior (spec §7 C):**
1. Read user prompt + assistant response from stdin (Claude Code hook payload)
2. Call Haiku with the learning-extraction prompt (`packages/scoring`)
3. If a learning is returned, POST `/wiki/propose` (same endpoint as MCP tool)
4. Dedup happens server-side on `(node_id, body_normalized)`

**Why both this AND the MCP tool exist:** demo drama comes from the MCP
call; demo *reliability* comes from the hook. Even if Claude Code skips
the MCP call, the hook fires deterministically (spec §7).

**Install:** registered in `.claude/settings.json` under `hooks.Stop` by
`npx trailhead-mcp init`.

**Imports:** `packages/scoring` (extraction prompt), `packages/shared`
(WikiProposeRequest type).

**Spec refs:** §7 C, §9 (why no async worker), §17 (deterministic backstop)
