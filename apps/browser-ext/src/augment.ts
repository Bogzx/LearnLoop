// Thin re-export. The canonical augmentation template lives in
// `packages/scoring/src/score-helpers.mjs::buildAugmentation`. Both surfaces
// (browser-ext and the future articulation scaffold in vscode-ext) read
// from the same constant so the wording stays in sync with the scorer's
// rubric (spec §6 / §9 question 2).
import { buildAugmentation } from '@trailhead/scoring/score-helpers';
import type { MissingHints } from '@trailhead/shared';

export function augment(prompt: string, missing: MissingHints): string {
  return buildAugmentation({ original: prompt, missing });
}
