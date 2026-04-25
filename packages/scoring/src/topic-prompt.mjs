// Topic classifier prompt used by /diff to find the closest matching
// graduated team prompt. Locked here so the cached system prompt is
// byte-stable across requests.
//
// Output is constrained by responseSchema enum at the call site (apps/api
// gemini.ts), but we still prompt for JSON shape so models without schema
// enforcement (Gemma) produce something parseable.
export const TOPIC_SYSTEM_PROMPT = `You classify software-engineering prompts by their primary topic.

Return one of: retry, auth, webhook, db_migration, error_handling, logging,
testing, deployment, refactor, performance, schema, validation, other.

Output strictly JSON: {"topic": "<one of the above>"}.`;
