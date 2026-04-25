// Per-endpoint model assignments. Single source of truth so swapping a model
// is a one-line change. Kept here in @trailhead/scoring so apps/api,
// apps/stop-hook, and apps/mcp-server can all reference the same constants.
//
//   gemini-2.5-flash : ~1s, structured JSON via responseSchema, thinking
//                      can be disabled via thinkingBudget=0. Right for
//                      live debounced /score and topic extraction.
//   gemma-4-31b-it   : ~9-16s, thinking model (cannot disable thinking),
//                      no responseSchema enforcement — JSON parsed
//                      defensively. Right for the Stop-hook learning
//                      extractor (one call per assistant turn — quality
//                      > latency, chain-of-thought boosts recall).
//
// /diff was originally Gemma 4 31B for richer narrative; flipped to Flash
// because compounding 4 LLM calls put /diff over budget on free-tier
// quotas. Swap back here when paid quota lands.
export const SCORE_MODEL   = 'gemini-2.5-flash';
export const TOPIC_MODEL   = 'gemini-2.5-flash';
export const DIFF_MODEL    = 'gemini-2.5-flash';
export const EXTRACT_MODEL = 'gemma-4-31b-it';
