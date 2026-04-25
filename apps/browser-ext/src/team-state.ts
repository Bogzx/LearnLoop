// Cached, synchronously-readable view of the popup-controlled "Select team"
// dropdown. Subscribes to chrome.storage.onChanged so picking a team in
// the popup takes effect on the live tab without a reload — every API
// call after the change uses the new X-Team-Token.
//
// Storage key: 'trailhead.selectedTeamToken' — string. Falls back to the
// hardcoded demo team token (config.ts) when nothing is stored.

import { TEAM_TOKEN as DEFAULT_TEAM_TOKEN } from './config.ts';

export const TEAM_TOKEN_KEY = 'trailhead.selectedTeamToken';

let currentToken = DEFAULT_TEAM_TOKEN;

export function getTeamToken(): string {
  return currentToken;
}

export function initTeamState(): void {
  try {
    const get = (chrome as any)?.storage?.local?.get;
    if (typeof get !== 'function') return;
    get.call((chrome as any).storage.local, TEAM_TOKEN_KEY, (out: Record<string, unknown>) => {
      const stored = out[TEAM_TOKEN_KEY];
      if (typeof stored === 'string' && stored) {
        currentToken = stored;
        console.info('[trailhead] team token loaded from storage');
      }
    });
    const onChanged = (chrome as any)?.storage?.onChanged?.addListener;
    if (typeof onChanged !== 'function') return;
    onChanged.call(
      (chrome as any).storage.onChanged,
      (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area !== 'local' || !(TEAM_TOKEN_KEY in changes)) return;
        const v = changes[TEAM_TOKEN_KEY]?.newValue;
        currentToken = typeof v === 'string' && v ? v : DEFAULT_TEAM_TOKEN;
        console.info('[trailhead] team token changed → using new token for next request');
      },
    );
  } catch {
    // chrome.* unavailable — leave default.
  }
}
