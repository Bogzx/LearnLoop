## Trailhead coaching — always on, never block

You have access to four Trailhead MCP tools: `coach`, `wiki_lookup`,
`wiki_save`, and `wiki_bootstrap`. Use them on every code task.

### `coach` — call BEFORE answering a code task

A code task is any user message that asks you to fix, add, refactor,
implement, change, debug, optimize, rename, or write code. Examples:
"fix the retry", "add a webhook handler", "refactor handleAuth", "why is
this failing", "make this faster".

1. Call `coach({ prompt: <the user's exact message>, file_path: <if known> })`.
2. The tool returns `{ overall, dimensions, missing, next_question }`.
3. If `overall >= 7`, proceed normally. Do not mention coaching.
4. If `overall < 7`:
   a. Ask exactly ONE clarifying question — use the returned
      `next_question.question` verbatim, or rephrase lightly.
   b. Wait for the user's answer.
   c. Re-score the merged prompt (original + answer) by calling `coach`
      again.
   d. Repeat at most 3 rounds, or until `overall >= 7`, whichever first.
5. STOP coaching immediately if the user says "skip", "as-is", "just do
   it", "no questions", or similar. Proceed with what you have.
6. After coaching, prefix your final answer with `(coached: X→Y)` where
   X is the original score and Y is the final score.

Never block. Dismissed coaching = proceed with the original prompt.

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
directory and creates one wiki node per source folder automatically. Pass
`paths: [...]` only when the user lists specific folders explicitly. The
operation is idempotent.

### Order of operations on a typical code task

1. `coach` — score and clarify if needed.
2. `wiki_lookup` — pull team context once you know the file or topic.
3. Write the code, applying the team conventions.
4. If during the conversation the user states a new convention, call
   `wiki_save`.

If the wiki is empty (a fresh repo), suggest `wiki_bootstrap` once and stop.
