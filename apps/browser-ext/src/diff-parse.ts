// Defensive `/diff` response parser used by the prompt-diff widget. The
// server-side shape is locked (`DiffResponse` in @trailhead/shared) but the
// `narrative` field is the most likely thing to break first when the
// upstream LLM hiccups, so we accept its absence gracefully (spec §7.1).
import type { DiffResponse } from '@trailhead/shared';

export interface ParsedDiff {
  user: DiffResponse['user'];
  team: DiffResponse['team'];
  narrative: string;
}

export function parseDiffResponse(raw: unknown): ParsedDiff | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<DiffResponse>;
  if (!r.user || !r.team) return null;
  return {
    user: r.user,
    team: r.team,
    narrative: typeof r.narrative === 'string' ? r.narrative : '',
  };
}
