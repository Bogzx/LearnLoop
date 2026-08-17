// The "coaching is unavailable this turn" response.
//
// Extracted from index.ts so it can be unit-tested: importing index.ts boots
// an HTTP listener and a Postgres pool, which a test has no business doing.
//
// Background. /coach used to handle a scoring failure by returning
// { proceed: true, overall: 0, dimensions: <all zero>, missing: {}, text: '' }.
// The MCP coach tool renders an empty `text` on a proceed=true score-mode
// response as "(coach overall: 0/10 — no coaching needed)" — character for
// character what it prints for a flawless prompt. So when Gemini was down,
// or returned something unparseable, the tool ran forever: never coaching,
// never erroring, and reporting success. Silence is a worse failure than a
// crash, because nobody ever goes looking for it.
//
// The fix is not to stop failing open. `proceed` stays true on purpose: an
// outage in a coaching sidecar must never block someone's actual work. The
// fix is to stop failing *silent* — say plainly, in the field that gets
// relayed to the caller, that this turn was not scored and why.

import type { CoachMode, CoachResponse, DimensionScores } from '@trailhead/shared';

export type DegradeReason = 'score_failed' | 'score_unparseable';

export function degradeDetail(reason: DegradeReason, err?: unknown): string {
  if (reason === 'score_unparseable') {
    return 'the model returned output that could not be parsed as a score';
  }
  const msg = (err as { message?: string } | undefined)?.message;
  return String(msg ?? err ?? 'unknown error');
}

export function degradedCoachResponse(
  mode: CoachMode,
  dimensions: DimensionScores,
  reason: DegradeReason,
  err?: unknown,
): CoachResponse {
  return {
    proceed: true,
    mode,
    overall: 0,
    dimensions,
    missing: {},
    degraded: true,
    error: reason,
    text:
      `⚠️ Trailhead could not score this prompt, so it was not coached this turn ` +
      `(${reason}: ${degradeDetail(reason, err)}). The 0/10 below is a placeholder, ` +
      `not a judgement of the prompt. Proceed with the original prompt as written.`,
  };
}
