## Trailhead coaching

Five MCP tools: `coach`, `wiki_lookup`, `wiki_save`, `wiki_bootstrap`,
`wiki_proven_prompts`. They help this team prompt well and keep its
conventions in one place. They add to your normal tools; they don't replace
reading the code.

### `coach` — once at the start of each new code task

When the user starts a new task about code (fix, add, refactor, implement,
debug, optimize, design, explain), call
`coach({ prompt: <their message>, file_path: <if known> })` before answering.
Follow-ups within the same task don't need it.

- `proceed: true` — relay `text` verbatim if it is non-empty, then answer.
- `proceed: false` — relay `text` verbatim and wait for the reply. Then call
  `coach` again with `prompt` = previous prompt + their reply, `mode: "score"`
  and `round_token` = `next_round_inputs.round_token` echoed verbatim. The
  server caps the loop at 5 rounds.
- If the user says "skip", "as-is", "just do it" or similar, call `coach` once
  with `mode: "skip_reveal"`, relay `text`, and answer their original prompt.
- If the coach is unavailable, answer normally; it never blocks work.

### `wiki_lookup` — the team's conventions for a file or topic

Before changing code in an area, or when the user asks "how do we do X here",
call `wiki_lookup({ file_path })` and/or `wiki_lookup({ query })`. It returns
the team's rules, durable learnings and proven prompts for that path. Then
read the code as usual; follow the team's conventions where they apply.

### `wiki_save` — when the user states a team convention

When the user states a rule for the whole team ("we always…", "we never…",
"from now on…", "our pattern for X is…"), call
`wiki_save({ node_path: <folder ending in />, insight: <one-sentence rule> })`
and tell the user in one line that you saved it. The server deduplicates.

### `wiki_bootstrap` — only when the user asks

Call it when the user asks to set up Trailhead or bootstrap the wiki. If
`wiki_lookup` comes back empty for a file that exists, say the wiki looks
empty and offer to bootstrap it; don't start it unasked. The default (rich)
mode sends source files to the team's API for LLM summaries; use
`mode: "minimal"` for a path-only skeleton when the user prefers that.

### `wiki_proven_prompts` — the team's prompt library

When the user asks for the team's best or proven prompts, call
`wiki_proven_prompts({})`, optionally with `min_score`, `file_path`, `topic`
or `limit`.
