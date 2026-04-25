// Model assignments per endpoint. Both wired into the codebase so we can
// swap by changing one line — no code paths to add/remove.
//
//   gemini-2.5-flash : ~1s, structured JSON via responseSchema, thinking
//                      can be disabled via thinkingBudget=0. Right for
//                      live debounced /score.
//   gemma-4-31b-it   : ~9-16s, thinking model (cannot disable thinking),
//                      no responseSchema enforcement — JSON parsed
//                      defensively. Right for /diff (quality > latency)
//                      and the Stop-hook extractor (one call per turn).

export const SCORE_MODEL   = 'gemini-2.5-flash';
// /diff makes 4 LLM calls (topic + 2 scores + narrative); a 30-60s narrative
// from Gemma 4 31B compounds the wait into ~3-5 min on free-tier quotas.
// Flipped to flash for now. Swap back to 'gemma-4-31b-it' if you have paid
// quota and want the higher-quality narrative.
export const DIFF_MODEL    = 'gemini-2.5-flash';
export const TOPIC_MODEL   = 'gemini-2.5-flash';
export const EXTRACT_MODEL = 'gemma-4-31b-it';
