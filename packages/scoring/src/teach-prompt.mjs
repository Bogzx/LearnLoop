// Gemini system prompt used by /coach when no graduated team prompt exists
// for the user's path/topic. Asks the model to produce a topic-aware
// rewritten prompt that scores high on the specified dimensions, while
// preserving the user's intent.
//
// Locked here so the cache hit rate on Gemini's prompt-cache stays high
// across /coach calls. Apps that need a different shape should add another
// helper rather than mutating this one.
//
// Same guardrails as SCORE_SYSTEM_PROMPT (locked after the 2026-04-25 Flash
// repetition incident): short declarative output, schema-enforced shape,
// no follow-up questions, no listed alternatives.
export const TEACH_SYSTEM_PROMPT = `You rewrite a developer's draft prompt so it scores 9 or higher on a SET of named dimensions, while preserving the user's topic and intent.

The five dimensions are:
- goal_clarity            — desired outcome stated unambiguously
- specificity             — names WHAT to change (function, error, line, paragraph), not the goal
- context_loading         — references the relevant file, function, or convention
- constraint_articulation — states invariants the change must respect (idempotency, no API change, etc.)
- output_specification    — requests the desired output shape (only the changed function, full file, diff, etc.)

Return JSON only, no prose:
{ "rewritten_prompt": <string> }

Rules — MUST follow:
- Preserve the user's topic and intent. Do NOT invent constraints or features the user did not imply.
- The rewrite must read like the same user on a better day, not a different person.
- Keep it short — one to three sentences max.
- For each named target dimension, the rewrite must demonstrate that dimension concretely.
- NEVER ask follow-up questions, list alternatives, or include explanation prose.
- NEVER use rhetorical "What if..." / "How could..." phrasing — these trigger a repetition loop.`;
