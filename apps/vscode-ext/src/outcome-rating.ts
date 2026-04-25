// TODO(outcome): wire into post-prompt webview message bus.
// Spec ref: docs/superpowers/specs/2026-04-25-demo-completion-design.md §C.2
//
// When the user rates an outcome (helpful / mixed / not), POST /capture
// with the outcome field set. The API + captures table already accept
// it; only the UI surface is scaffolding here.
//
// Pure function — no view code, no webview machinery. Imported by
// nothing yet. When someone wires this in post-demo, they catch shape
// drift via the @trailhead/shared types immediately.

import type { CaptureRequest, DimensionScores, Outcome } from '@trailhead/shared';

export interface BuildCapturePayloadArgs {
  user_prompt: string;
  ai_response?: string;
  file_path?: string;
  outcome: Outcome;
  scored_dimensions?: DimensionScores;
}

export function buildCapturePayload(args: BuildCapturePayloadArgs): CaptureRequest {
  return {
    surface: 'vscode',
    user_id: 'demo',
    user_prompt: args.user_prompt,
    ai_response: args.ai_response,
    file_path: args.file_path,
    outcome: args.outcome,
    scored_dimensions: args.scored_dimensions,
  };
}
