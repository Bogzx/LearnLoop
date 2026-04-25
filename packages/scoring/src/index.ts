// Re-export the runtime helpers (defined in `.mjs` so any consumer — the
// MCP server (TS) or the Stop hook (plain ESM) — can import them with no
// build step) plus the type-only declarations.
export { normalize } from './normalize.mjs';
export {
  EXTRACT_SYSTEM_PROMPT,
  parseExtractResponse,
  type ExtractedLearning,
  type ExtractResult,
} from './extract-prompt.mjs';
export { SCORE_SYSTEM_PROMPT } from './score-prompt.mjs';
export { TOPIC_SYSTEM_PROMPT } from './topic-prompt.mjs';
export {
  buildScoreUserPrompt,
  buildAugmentation,
  type BuildScoreUserPromptArgs,
  type BuildAugmentationOpts,
} from './score-helpers.mjs';
export { ancestorPaths, normalizePath } from './path-helpers.mjs';
export {
  SCORE_MODEL,
  TOPIC_MODEL,
  DIFF_MODEL,
  EXTRACT_MODEL,
} from './models.mjs';
