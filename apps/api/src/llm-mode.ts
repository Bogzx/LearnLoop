// Which LLM backs the API.
//
//   TRAILHEAD_LLM=gemini (default)  every LLM call goes to Gemini (gemini.ts)
//   TRAILHEAD_LLM=offline           no model at all (offline-llm.ts): prompts are
//                                   scored by the rule-based scorer in
//                                   packages/scoring, coaching text comes from
//                                   the static templates, and the rich wiki
//                                   bootstrap is unavailable
//
// Offline mode exists so the stack can be tried with no key. It never switches
// on by itself: with no key and no TRAILHEAD_LLM the API refuses to start, so a
// production deploy that lost its key fails loudly instead of quietly scoring
// with rules. Read per call, so tests can flip it.

export type LlmMode = 'gemini' | 'offline';

export function llmMode(env: NodeJS.ProcessEnv = process.env): LlmMode {
  return env.TRAILHEAD_LLM === 'offline' ? 'offline' : 'gemini';
}

/** Startup check. Returns what is wrong with the LLM configuration, or null. */
export function llmConfigError(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.TRAILHEAD_LLM;
  if (v !== undefined && v !== '' && v !== 'gemini' && v !== 'offline') {
    return `TRAILHEAD_LLM must be "gemini" or "offline" (got "${v}")`;
  }
  if (llmMode(env) === 'gemini' && !env.GEMINI_API_KEY) {
    return (
      'GEMINI_API_KEY not set. Get one at https://aistudio.google.com/apikey, or set ' +
      'TRAILHEAD_LLM=offline to run without a model (rule-based scoring, template coaching, ' +
      'no rich wiki bootstrap).'
    );
  }
  return null;
}
