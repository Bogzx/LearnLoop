// Per-endpoint model assignments. Single source of truth so swapping a model
// is a one-line change. Kept here in @trailhead/scoring so apps/api and
// apps/mcp-server can both reference the same constants.
//
//   gemini-3-flash-preview : current default. Successor to 2.5-flash.
//                            Structured JSON via responseSchema and
//                            thinkingConfig still supported. Free tier
//                            available in AI Studio. Migrated 2026-04-26
//                            (was gemini-2.5-flash).
//
// /diff was originally Gemma 4 31B (gemma-4-31b-it) for richer narrative;
// flipped to Flash because compounding 4 LLM calls put /diff over budget on
// free-tier quotas. gemini.ts still handles a Gemma-family model (no schema
// enforcement, chain-of-thought parts) if one is swapped back in here.
export const SCORE_MODEL   = 'gemini-3-flash-preview';
export const TOPIC_MODEL   = 'gemini-3-flash-preview';
export const DIFF_MODEL    = 'gemini-3-flash-preview';
