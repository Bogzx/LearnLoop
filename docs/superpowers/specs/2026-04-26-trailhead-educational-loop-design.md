# Trailhead Coach — Educational Loop Redesign

**Date:** 2026-04-26
**Status:** Draft, pending implementation plan
**Scope:** The `apps/mcp-server` `coach` tool, the coaching directive, and a new `POST /coach` endpoint in `apps/api`. Does not change the rubric, the browser extension, the dashboard, the existing `/score` endpoint, or the wiki tools (`wiki_lookup`, `wiki_save`, `wiki_bootstrap`).

---

## 1. Goal

Make the MCP coaching loop genuinely educational instead of cosmetic.

Today, when a developer prompts low-quality, the `coach` tool asks one hardcoded clarifying question and the host LLM (Claude Code or Copilot Chat) frequently produces output regardless of the user's answer. The user never learns the rubric and never sees the value of having improved the prompt. In the failing example case:

- Coach asked: *"What exactly should change? Name the function, error, or behavior."*
- User answered: *"it needs to be more accurate"* (still vague — a goal, not a change)
- Host LLM produced an arbitrary "fix" (decreased Gemini temperature from 0.7 to 0.2) without re-scoring or pushing back.

The redesign turns each low-score round into a teaching round: explain the missing dimension, show a strong example tied to the user's actual topic (wiki-first → Gemini-fallback), then ask. Loops up to 3 rounds with an early bail on no-progress. At session end, a **reveal block** shows the score arc, the prompt diff, and which dimensions improved — so the user sees their optimization land before the LLM's answer.

The pedagogy is structurally enforced: the new `coach` tool returns a single `proceed` flag, and the directive becomes a thin "relay text, follow `proceed`" loop with no judgement calls.

---

## 2. Scope and non-goals

### What changes

- **`apps/mcp-server/src/tools.ts`** — `registerCoach` is rewritten. The `NEXT_QUESTION_BY_DIMENSION` constant is deleted (the server returns the question now). The `coach` tool gains a richer input/output shape (§4) and a new `mode: 'skip_reveal'`.
- **`apps/mcp-server/src/coaching-directive.md`** — replaced with the ~20-line directive in §6 below.
- **`apps/api`** — gains a new `POST /coach` endpoint that drives the new pipeline (§5).
- **`packages/scoring/src/`** — gains `teach-templates.mjs` (per-dimension definitions, why-it-matters fragments, hardcoded clarifying questions) and `teach-prompt.mjs` (`TEACH_SYSTEM_PROMPT` for the Gemini fallback rewrite).
- **`apps/mcp-server/src/api-client.ts`** — gains a `coach()` method calling `/coach`.

### What does NOT change

- The 5-dimension rubric: `goal_clarity`, `specificity`, `context_loading`, `constraint_articulation`, `output_specification`.
- The existing `POST /score` endpoint and its response shape — the browser extension still consumes it for the live scorecard.
- `wiki_lookup`, `wiki_save`, `wiki_bootstrap` MCP tools.
- Dashboard, VS Code sidebar, demo seed data, Postgres schema (no new tables).
- The `mode: 'augment'` path on `coach` — kept for backwards compatibility but stops being part of the recommended flow; the new mechanism replaces it pedagogically.
- The `npx trailhead-mcp init` install script — it inlines the new (shorter) directive into `./CLAUDE.md` and `./.github/copilot-instructions.md` exactly as it does today.

### Anti-goals (deliberately not doing)

- **No server-side session tracking.** State (original prompt, original dimensions, round number) is passed explicitly by the LLM in each `coach` call. Stateless = no Redis, no TTL bugs, no cross-request correctness issues during the live demo.
- **No second LLM call to *run* the bad prompt** for hypothetical "what would have been" comparison. Considered and rejected; expensive and gimmicky.
- **No first-time-user tutorial mode.** Same teach-block shape every round, every prompt — simpler to implement and the user picks up the rubric through repetition (which is the L1→L2 mechanic anyway).
- **No "score ≥ 7 on round 1" reveal.** Silent fast path is preserved — power users see zero friction.

---

## 3. Coaching loop walkthrough (user-facing narrative)

Cover-letter example — generalises to any code task.

### Round 1 — first low-score prompt

User in Claude Code: *"the cover letter generation needs to be more accurate."*

Claude Code calls `coach({ prompt })`. Server scores: 3/10. Lowest dimension: `specificity`. Server queries the wiki for graduated prompts on similar topics — finds nothing usable, falls back to Gemini for a topic-aware strong example. Returns:

```
proceed: false
text:
  Specificity (yours: 2/10) — state WHAT changes, not the goal.
  "More accurate" is a goal; a specific change names a function,
  paragraph, or behavior to alter.

  Strong example: "in cover_letter.py, reduce hallucinated
  achievements in the closing paragraph by grounding the prompt
  in the user's resume bullets only."

  What specifically should change in cover_letter.py?
```

Claude Code relays the block verbatim. User sees the rubric explanation, an example tied to *their* file, and a concrete ask.

### Round 2 — user answers, score moves, new lowest dim

User: *"the closing paragraph keeps making up achievements."*

Claude Code calls `coach({ prompt: <original + answer>, original_prompt, original_dimensions, previous_dimensions, round: 2 })`. Server re-scores: now 6/10. Specificity moved (5/10), but `constraint_articulation` is now lowest (2/10). Returns a new teach block targeting constraints, prefixed with *"You added specificity. Constraints is now the gap."* and the standard explain + example + ask shape.

### Round 3 — score crosses 7

User adds constraints. Score: 8/10. Server returns:

```
proceed: true
text:
  (coached: 3 → 8)
  Your prompt grew:
    "the cover letter generation needs to be more accurate"
    →
    "in cover_letter.py's generate() function, the closing paragraph
     hallucinates achievements not in the resume. Ground completions
     in resume_bullets[] only; preserve current tone; return only
     the modified function."
  Improved on: specificity (+6), context_loading (+5),
               constraint_articulation (+7), output_specification (+4)
```

Claude Code relays this and produces the answer using the improved prompt.

### Skip path — user bails on round 1 or 2

User: *"just do it."* Claude Code recognises the skip cue (see §6) and calls `coach({ prompt: <original>, mode: 'skip_reveal', original_prompt, original_dimensions })`. Server returns the strong-rewrite reveal:

```
proceed: true
text:
  Proceeding with your original prompt. For next time, a stronger
  version would have been:
    "in cover_letter.py's generate() function, reduce hallucinated
     achievements in the closing paragraph; ground completions in
     resume_bullets[] only; return only the modified function."
  Would have improved: specificity (+6), context_loading (+5),
                       constraint_articulation (+7).
```

Claude Code relays and produces the answer using the **original** prompt. The user opted out — we respect that — but they still walk away having seen the rubric in action.

### No-progress early bail

If round N+1's score didn't improve over round N (same lowest dimension, `overall <= previous_overall`), server treats it as an implicit skip — returns the same skip-style reveal (with a slightly different prefix referencing the lack of progress) and exits the loop. No round 3 in that case.

### Score ≥ 7 on round 1 (high-skill user)

Server returns `{ proceed: true, text: '' }`. Silent. The user gets their answer with no friction. Preserves the existing "never block, never nag" rule.

---

## 4. The `coach` tool surface

The MCP tool input/output schemas. The directive's only job is to construct these correctly.

### Input

```ts
{
  prompt: string,                       // current prompt being scored
                                        //   round 1: the user's original message
                                        //   round N>1: original + all user replies, concatenated
  file_path?: string,                   // unchanged from current

  mode?: 'score' | 'skip_reveal' | 'augment',
                                        // default 'score'
                                        // 'augment' kept for backwards-compat only

  // Round-state inputs (passed by LLM on round 2+ and on skip_reveal)
  original_prompt?: string,             // first prompt of this coaching session
  original_dimensions?: DimensionScores, // round 1's per-dim scores (for delta callout in reveal)
  previous_dimensions?: DimensionScores, // last round's per-dim scores (for no-progress detection)
  round?: number,                       // 1, 2, 3 — server clamps to [1, 3]
}
```

### Output

```ts
{
  proceed: boolean,                     // KEY FLAG — directive checks only this
  mode: 'score' | 'skip_reveal' | 'augment',
  overall: number,                      // 0-10
  dimensions: DimensionScores,
  missing: Record<string, string>,
  text: string,                         // fully rendered block — relay verbatim, may be empty

  // When proceed=false (continue coaching), echo the state the LLM should send back next call:
  next_round_inputs?: {
    original_prompt: string,
    original_dimensions: DimensionScores,
    previous_dimensions: DimensionScores,
    round: number,                      // next round number
  },

  // Existing augment-mode fields preserved for backwards compat:
  augmented_prompt?: string,
  missing_dims?: string[],
}
```

### Server-side decision logic

Single function executed on every `coach` call. Pseudocode:

```
score the prompt via existing /score logic → overall, dimensions, missing

if mode == 'augment':
   delegate to existing buildAugmentation, return as today.

if mode == 'skip_reveal':
   build skip-style reveal from original_prompt + original_dimensions
   return { proceed: true, text: <skip-reveal block>, ... }

# mode == 'score' (default)

if round == 1 (or original_prompt unset):
   if overall >= 7:
     return { proceed: true, text: '', ... }      # silent fast path
   else:
     build teach block for lowest dim < 7 (wiki → Gemini)
     return { proceed: false, text: <teach block>,
              next_round_inputs: { round: 2, ... } }

# round >= 2
if overall >= 7:
   build success reveal (score arc + prompt diff + dimension callout)
   return { proceed: true, text: <reveal>, ... }

if no_progress(round, overall, previous_overall, lowest_dim, prev_lowest_dim):
   build skip-style reveal with "your last answer didn't move X" header
   return { proceed: true, text: <reveal>, ... }

if round >= 3:
   build success-style reveal with "max rounds reached" note
   return { proceed: true, text: <reveal>, ... }

# else: still <7, made progress, rounds remain
build teach block for new lowest dim, prefixed with
   "you added <improved_dim>, <new_lowest_dim> is now the gap"
return { proceed: false, text: <teach block>,
         next_round_inputs: { round: round+1, ... } }
```

The directive never has to make a decision. It only relays text and follows `proceed`.

---

## 5. Server-side `/coach` pipeline

New `POST /coach` endpoint in `apps/api`. Existing `/score` is untouched.

### Pipeline

1. **Score** — reuse existing `/score` logic in-process. Same Gemini call, same `SCORE_SYSTEM_PROMPT`, same `responseSchema`. Same `skill_observation` write. No duplicate LLM call.
2. **Decide** — branch on the §4 logic.
3. **Render** — one of: teach block, success reveal, skip-style reveal, or empty string.

### Teach-block rendering (wiki-first → Gemini fallback)

```
target_dim = lowest dimension with score < 7

# Wiki-first: graduated team prompts on similar paths
graduated_prompts = SELECT * FROM prompts
   WHERE node_id IN (ancestor nodes for file_path, if any)
   ORDER BY reuse_count DESC LIMIT 5;

# Pick a graduated prompt that scores >= 7 on target_dim.
# Re-score top candidates against the rubric in a single batched
# Gemini call if needed; cache aggressively by prompt_id.
strong_example = first graduated_prompt with target_dim score >= 7

# Fallback: Gemini rewrite
if not strong_example:
   strong_example = gemini(TEACH_SYSTEM_PROMPT, user_prompt, target_dim)

block = render template:
  "{Dimension} (yours: {score}/10) — {one-line rubric definition}
   {short why-it-matters fragment, hardcoded per dim}

   Strong example: \"{strong_example}\"

   {hardcoded clarifying question for target_dim}"
```

The dimension definitions, why-it-matters fragments, and clarifying questions live as constants in `packages/scoring/src/teach-templates.mjs`. Iterating wording is a single-file change. Every block has byte-identical structure → predictable LLM relay.

`TEACH_SYSTEM_PROMPT` (in `packages/scoring/src/teach-prompt.mjs`) is short and declarative, mirroring the guardrails added to `SCORE_SYSTEM_PROMPT` after the earlier Flash repetition incident:

> "Rewrite the user's prompt to score 9+ on `<target_dim>`. Preserve their topic and intent. Return ONLY the rewritten prompt — no prose, no explanation, no follow-up questions."

`responseSchema` enforces `{ rewritten_prompt: string }`. `maxOutputTokens` is set conservatively (~256).

### Success-reveal rendering

```
delta = final.dimensions − original_dimensions
improved_dims = [d for d in delta if delta[d] >= +2], sorted desc by delta

block = render:
  "(coached: {original.overall} → {final.overall})
   Your prompt grew:
     \"{truncate(original_prompt, 80)}\"
     →
     \"{truncate(final_prompt, 200)}\"
   Improved on: {comma-separated 'dim (+N)' for top 3 improved_dims}"
```

### Skip-style reveal rendering

Used by both `mode: 'skip_reveal'` and the no-progress early-bail branch.

```
strong_rewrite = single Gemini call (or wiki match if available):
                 "rewrite to score 9+ on each of <dims-where-original-scored-<5>>"
hypothetical_delta = (rewrite_score − original.dimensions) for top 3 dims

prefix = (
   "Proceeding with your original prompt. For next time, a stronger version would have been:"
   if mode == 'skip_reveal'
   else
   "Your last answer didn't move {target_dim}. A stronger version of your prompt would have been:"
)

block = render:
  "{prefix}
     \"{strong_rewrite}\"
   Would have improved: {comma-separated 'dim (+N)' for hypothetical_delta}"
```

### No-progress detection

```python
no_progress = (
   round >= 2
   and overall <= previous_overall
   and lowest_dim_now == lowest_dim_previously
)
```

Strict on purpose — a tiny improvement (e.g., 3→4) still earns another round.

### Caching

- Teach-block strong examples cached in-process per `(file_path_ancestor, target_dim)` key, 5-min TTL. Saves Gemini calls when the user iterates on the same file.
- Reveal rendering is pure (no I/O) — no cache.

### Latency budget

| Path | Score | Render | Total |
|------|-------|--------|-------|
| Round 1, wiki hit | ~1s | ~50ms (DB) | ~1.05s |
| Round 1, Gemini fallback | ~1s | ~600ms | ~1.6s |
| Success reveal | ~1s | ~0 (pure) | ~1s |
| Skip-style reveal | ~1s | ~600ms (rewrite) | ~1.6s — fires once at exit |

Well within hackathon-acceptable bounds.

---

## 6. The new directive

Replaces `apps/mcp-server/src/coaching-directive.md` in full. The `init` script keeps inlining whichever version of this file is checked in, into `./CLAUDE.md` and `./.github/copilot-instructions.md`.

```markdown
## Trailhead coaching — always on, never block

Four MCP tools: `coach`, `wiki_lookup`, `wiki_save`, `wiki_bootstrap`.

### `coach` — call BEFORE answering any code task

A code task is any user message that asks you to fix, add, refactor,
implement, change, debug, optimize, rename, or write code.

1. Call `coach({ prompt: <user's exact message>, file_path: <if known> })`.
2. The tool returns `{ proceed, text, next_round_inputs?, ... }`.
3. **If `proceed: true`:** if `text` is non-empty, relay it verbatim
   to the user. Then produce your answer. Done.
4. **If `proceed: false`:** relay `text` verbatim, wait for the user's
   reply, then call `coach` again with:
   - `prompt`: the user's reply concatenated to the previous prompt
   - `mode: "score"`
   - all four fields from `next_round_inputs` (`original_prompt`,
     `original_dimensions`, `previous_dimensions`, `round`)
   Loop. The server enforces the cap and bails on no-progress.

### Skip detection

If at any coaching round the user says "skip", "as-is", "just do it",
"no questions", "nevermind", "stop coaching", or otherwise dismisses
the loop, call `coach` ONCE more with:
- `prompt`: the user's most recent prompt
- `mode: "skip_reveal"`
- `original_prompt` and `original_dimensions` from the session
Then relay the returned `text` verbatim and produce your answer using
the user's ORIGINAL prompt (not any improved version).

### `wiki_lookup` / `wiki_save` / `wiki_bootstrap`

Unchanged. See existing trigger conditions in the tool descriptions.

### Order of operations

1. `coach` — score and (if needed) loop.
2. `wiki_lookup` — once you know the file or topic, pull team context.
3. Write the code, applying the team conventions.
4. If the user states a new convention, call `wiki_save`.
```

### Why this directive is short and durable

- Every "what should happen now" decision moved to `proceed` and `text`. The LLM has no judgement calls about pedagogy, no heuristics about when to stop, no responsibility for composing teach blocks.
- The "you MUST re-score after each answer" rule that the LLM ignored in the failing example is now structurally enforced — if `proceed: false`, the only way forward is another `coach` call.
- The skip path is one explicit branch with one explicit `coach` call.
- The `(coached: X→Y)` prefix is gone from the directive — it's part of `text` rendered server-side, so the LLM can't forget it.

---

## 7. Errors, fallbacks, and edge cases

Coaching gracefully degrades; it never crashes the user's task.

### Backend errors

| Failure | Fallback |
|---|---|
| Gemini `/score` timeout or 5xx | Return `{ proceed: true, text: '' }` — fail open, user gets their answer with no coaching this turn. Matches the existing browser-ext failure posture. |
| Wiki query fails or returns no usable graduated prompt | Skip to Gemini-fallback for the strong example. (This is the designed path.) |
| Gemini teach-rewrite timeout | Drop to hardcoded per-dimension template. Teach block ships with `{dimension, definition, why-it-matters, hardcoded_question}` — without the topic-aware example line. |
| Gemini repetition loop on teach-rewrite | Same guardrails as `SCORE_SYSTEM_PROMPT`: short declarative output, `maxOutputTokens` cap, `responseSchema`. Lock `TEACH_SYSTEM_PROMPT` once; don't iterate at runtime. |
| Skip-reveal rewrite fails | Render the reveal without the strong-rewrite line: dimension callout + "your original prompt is being used." |
| `/coach` itself 500s | MCP `coach` tool catches via existing `asError` path; LLM sees the error and proceeds with the original prompt. |

### LLM compliance edge cases

- **LLM forgets to pass `next_round_inputs` on round 2.** Server treats the call as a fresh round 1. No "still missing Y" prefix; otherwise functional.
- **LLM passes a bogus `round: 99`.** Server clamps to `min(round, 3)` and follows the round-3 forced-reveal branch. No infinite loops possible.
- **LLM relays the teach block but immediately produces an answer.** Can't structurally prevent, but the new directive's `proceed: false` rule is unambiguous in a way the old `if score < 7` prose wasn't.
- **LLM bypasses `coach` entirely.** Same posture as today — directive compliance is best-effort.

### Skill observation writes (§10 of the original spec)

Existing 30-second dedup on `(user, dimension, prompt-hash)` continues to apply. A coaching session with 3 rounds writes 3 observations on 3 different prompt hashes (the merged prompt grows each round) — dedup doesn't merge them, which is correct: the dashboard shows the user's score climbing 3 → 6 → 8 across the session, exactly the L1→L2 signal the demo wants.

### Termination guarantees (the contract)

User-visible promises the system holds, regardless of LLM behaviour:

1. **Maximum 3 coach loop iterations** before the server forcibly returns `proceed: true`.
2. **Every coaching session that goes past round 1 produces a reveal block** — success, max-rounds, no-progress, or skip-reveal.
3. **Score ≥ 7 on round 1** never produces any reveal or friction (silent fast path preserved).
4. **`mode: 'skip_reveal'`** always returns `proceed: true` and a reveal block; never loops.

### Deliberately not handled

- No retry on Gemini transient failures inside `/coach` — `/score` already retries; we don't double-wrap.
- No per-user rate limiting on `/coach` — hackathon scope.
- No conversation-level "did the LLM actually relay the text?" verification — MCP gives no callback for that.

---

## 8. Implementation surface (file-level changelist)

The work, broken into roughly the order it should land. Each item is a single-purpose change.

### `apps/api`
1. New endpoint `POST /coach` and request/response schemas in `@trailhead/shared`.
2. New module containing the §5 pipeline (decision logic + renderers).
3. Internal call into the existing `/score` handler (extract the scoring core into a shared function so both endpoints reuse it).
4. Reads from `prompts` and `nodes` for the wiki-first lookup; reuses the existing graduated-prompt query path from `/examples`.

### `packages/scoring/src`
1. New `teach-templates.mjs` — per-dimension `definition`, `whyItMatters`, `clarifyingQuestion` constants. Five entries, each ~3 short strings.
2. New `teach-prompt.mjs` — `TEACH_SYSTEM_PROMPT` plus `parseTeachResponse` helper.
3. New `reveal-render.mjs` — pure functions: `renderTeachBlock`, `renderSuccessReveal`, `renderSkipReveal`. Easy to unit-test.
4. `index.ts` — re-export the new modules.

### `apps/mcp-server`
1. `api-client.ts` — add `coach(body): Promise<CoachResponse>` calling `POST /coach`.
2. `tools.ts` — rewrite `registerCoach`. Delete `NEXT_QUESTION_BY_DIMENSION` and `pickNextQuestion`. New input schema, new output schema, new handler that mostly forwards to `client.coach()` and surfaces `text` + `structuredContent`.
3. `coaching-directive.md` — replaced with §6 content.

### `bin/init.mjs` (install script)
- No code change. The script already inlines whatever `coaching-directive.md` contains; the new shorter file flows through unchanged.

### Verification (per the user's standing preference)

Per project memory: skip TDD; verify by running real requests against the live API. End-to-end smoke covers:

1. Round 1 low-score prompt → assert `proceed: false`, non-empty `text` containing the dimension name.
2. Round 1 high-score prompt → assert `proceed: true`, empty `text`.
3. Round 2 with progress → assert teach block targeting the new lowest dimension and "you added X" prefix.
4. Round 2 no-progress → assert `proceed: true`, skip-style reveal text.
5. Round 3 forced exit → assert `proceed: true`, max-rounds reveal text.
6. `mode: 'skip_reveal'` from round 1 → assert `proceed: true`, skip reveal contains a strong-rewrite line.
7. Gemini fallback path forced (wiki empty for the path) → assert teach block still renders with example.
8. `/score` failure simulated → assert `coach` returns `proceed: true, text: ''`.

Run by invoking `coach` directly through the existing harness (`apps/mcp-server/src/harness/try.ts`) against the deployed API.

---

## 9. Open questions

These are intentionally deferred to implementation, not blockers for the spec:

1. **Exact dimension definitions / why-it-matters wording.** Five definitions × ~3 strings each, locked in `teach-templates.mjs`. Iterate during the harness loop, not in the spec.
2. **Exactly which graduated prompts are "similar enough"** for the wiki-first lookup. The §5 pseudocode says "ancestor nodes for file_path"; if no `file_path` is available (a freeform prompt), the wiki-first lookup degrades to "all graduated prompts in the team," ranked by `reuse_count`. The Gemini fallback covers the case where nothing matches.
3. **Skip-reveal phrasing tone.** Current draft is informational ("for next time, a stronger version would have been"); could be made more terse or more explicitly framed as a "lesson." Settle in the harness.
4. **`mode: 'augment'` deprecation timing.** Keep working; mark deprecated in description; remove after the demo if no callers remain.

---

## 10. Definition of done

- [ ] `POST /coach` endpoint deployed and reachable from the MCP server.
- [ ] MCP `coach` tool invokes `/coach`, returns the new shape, and Claude Code/Copilot can call it without errors.
- [ ] Smoke checks 1–8 from §8 all pass against the live API.
- [ ] The new `coaching-directive.md` is in place; `npx trailhead-mcp init` writes it through to `./CLAUDE.md` and `./.github/copilot-instructions.md`.
- [ ] Re-running the original failing example (cover-letter prompt with vague answer) produces the round-2 "still missing" teach block — not silent acceptance.
- [ ] A successful 3-round session ends with the §3 success-reveal block visible above the LLM's answer.
- [ ] A `"just do it"` mid-session ends with the skip-reveal block visible above the LLM's answer (using the original prompt).
