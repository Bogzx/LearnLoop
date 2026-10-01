// Every LLM call the routes make goes through here. Each function picks its
// provider per call (llm-mode.ts): Gemini by default, the no-model
// implementations in offline-llm.ts under TRAILHEAD_LLM=offline.
import * as gemini from './gemini.ts';
import * as offline from './offline-llm.ts';
import { llmMode } from './llm-mode.ts';

const impl = () => (llmMode() === 'offline' ? offline : gemini);

export const scorePrompt: typeof gemini.scorePrompt = (args) => impl().scorePrompt(args);
export const rewriteForDims: typeof gemini.rewriteForDims = (args) => impl().rewriteForDims(args);
export const acknowledgeProgress: typeof gemini.acknowledgeProgress = (args) => impl().acknowledgeProgress(args);
export const summarizeCoaching: typeof gemini.summarizeCoaching = (args) => impl().summarizeCoaching(args);
export const extractTopic: typeof gemini.extractTopic = (prompt) => impl().extractTopic(prompt);
export const extractPathAndTopic: typeof gemini.extractPathAndTopic = (prompt) => impl().extractPathAndTopic(prompt);
export const synthesizeDiff: typeof gemini.synthesizeDiff = (args) => impl().synthesizeDiff(args);
export const improveCoach: typeof gemini.improveCoach = (input) => impl().improveCoach(input);

// Pure; the same in both modes.
export { overallScore } from './gemini.ts';

/** What produced a score, for clients that want to say so. */
export const scorerName = (): 'gemini' | 'heuristic' => (llmMode() === 'offline' ? 'heuristic' : 'gemini');
