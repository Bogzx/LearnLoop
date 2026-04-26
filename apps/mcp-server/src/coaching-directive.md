## Trailhead coaching — always on, never block

Four MCP tools: `coach`, `wiki_lookup`, `wiki_save`, `wiki_bootstrap`.

### `coach` — call BEFORE answering any code task

A code task is any user message that asks you to fix, add, refactor,
implement, change, debug, optimize, rename, or write code. Examples:
"fix the retry", "add a webhook handler", "refactor handleAuth", "why
is this failing", "make this faster".

1. Call `coach({ prompt: <user's exact message>, file_path: <if known> })`.
2. The tool returns `{ proceed, text, next_round_inputs?, ... }`.
3. **If `proceed: true`:** if `text` is non-empty, relay it verbatim to
   the user. Then produce your answer. Done.
4. **If `proceed: false`:** relay `text` verbatim, wait for the user's
   reply, then call `coach` again with:
   - `prompt`: the user's reply concatenated to the previous prompt
   - `mode: "score"`
   - all four fields from `next_round_inputs` (`original_prompt`,
     `original_dimensions`, `previous_dimensions`, `round`) echoed
     back unchanged
   Loop. The server enforces the cap (3 rounds) and bails on no-progress.

### Skip detection

If at any coaching round the user says "skip", "as-is", "just do it",
"no questions", "nevermind", "stop coaching", or otherwise dismisses
the loop, call `coach` ONCE more with:
- `prompt`: the user's most recent prompt
- `mode: "skip_reveal"`
- `original_prompt` and `original_dimensions` from the session
Then relay the returned `text` verbatim and produce your answer using
the user's ORIGINAL prompt (not any improved version).

### `wiki_lookup` — call BEFORE writing code that touches a known path

Call `wiki_lookup({ file_path: <path> })` whenever you are about to
write or modify code in a specific file. The tool returns the team's
conventions for that path's ancestor folders, plus durable learnings.
Apply them.

Also call `wiki_lookup({ query: <phrase> })` when the user asks "how do
we handle X", "what's our convention for Y", "do we have a pattern for
Z". Pass the topic as the query.

Use both `file_path` and `query` together when the user asks about a
convention in a specific area.

### `wiki_save` — call WHEN the user states a teamwide convention

Trigger on phrases like:
- "we always..."
- "we never..."
- "team convention is..."
- "the rule here is..."
- "make sure to always..."
- "we standardized on..."

Call `wiki_save({ node_path: <folder ending in />, insight: <one-sentence rule> })`.
The server dedupes; calling twice with the same insight is safe and
reinforces the count. Never ask permission first — silently saving
durable conventions is the point.

### `wiki_bootstrap` — call WHEN the user asks to set up Trailhead

Trigger on phrases like:
- "set up Trailhead for this repo"
- "bootstrap the wiki"
- "initialize the team wiki"
- "/init the project for Trailhead"
- "create the Trailhead wiki for this codebase"

Call `wiki_bootstrap({})` with no arguments — the server walks the working
directory, bundles source files, and runs LLM passes that fill every
folder/file with a narrative summary plus draft learnings (rich mode is
the default; takes ~30-90s). Pass `paths: [...]` only when the user lists
specific folders explicitly. Pass `mode: "minimal"` only when the user
asks for a fast/free skeleton-only setup. The operation is idempotent —
already-populated nodes are left alone.

### Order of operations on a typical code task

1. `coach` — score and (if needed) loop.
2. `wiki_lookup` — once you know the file or topic, pull team context.
3. Write the code, applying the team conventions.
4. If the user states a new convention, call `wiki_save`.

If the wiki is empty (a fresh repo), suggest `wiki_bootstrap` once and stop.
