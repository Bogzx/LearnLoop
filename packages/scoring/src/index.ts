// Re-export the runtime helpers (defined in `.mjs` so any consumer, TypeScript
// or plain ESM, can import them with no build step) plus the type-only
// declarations.
export { normalize } from './normalize.mjs';
export { SCORE_SYSTEM_PROMPT } from './score-prompt.mjs';
export { HEURISTIC_SCORER, heuristicScore } from './heuristic-score.mjs';
export { TEACH_SYSTEM_PROMPT } from './teach-prompt.mjs';
export { TOPIC_SYSTEM_PROMPT } from './topic-prompt.mjs';
export {
  buildScoreUserPrompt,
  buildAugmentation,
  type BuildScoreUserPromptArgs,
  type BuildAugmentationOpts,
} from './score-helpers.mjs';
export {
  DIMENSION_TEACH,
  type DimensionTeachEntry,
} from './teach-templates.mjs';
export {
  renderTeachBlock,
  renderSuccessReveal,
  renderSkipReveal,
  type RenderTeachBlockArgs,
  type RenderSuccessRevealArgs,
  type RenderSkipRevealArgs,
} from './reveal-render.mjs';
export { ancestorPaths, normalizePath } from './path-helpers.mjs';
export { codeFence, fenceUntrusted, UNTRUSTED_NOTE, UNTRUSTED_TAG } from './fence.mjs';
export {
  SCORE_MODEL,
  TOPIC_MODEL,
  DIFF_MODEL,
} from './models.mjs';
