// Cached, synchronously-readable view of the popup-controlled "Select team"
// dropdown. Subscribes to chrome.storage.onChanged so picking a team in
// the popup takes effect on the live tab without a reload — every API
// call after the change uses the new X-Team-Token.
//
// Storage key: 'trailhead.selectedTeamToken' — string. Falls back to the
// hardcoded demo team token (config.ts) when nothing is stored.

import { TEAM_TOKEN as DEFAULT_TEAM_TOKEN } from './config.ts';

export const TEAM_TOKEN_KEY = 'trailhead.selectedTeamToken';
// Cached display name for the selected team. The popup writes this when
// the user picks a team in the dropdown (and refreshes it on every team
// list fetch); the in-page pill reads it to disambiguate "Root" across
// projects ("Acme Fintech · Root" vs. "Bmw · Root").
export const TEAM_NAME_KEY = 'trailhead.selectedTeamName';

let currentToken = DEFAULT_TEAM_TOKEN;
let currentName: string | null = null;
const subscribers = new Set<() => void>();

export function getTeamToken(): string {
  return currentToken;
}

export function getTeamName(): string | null {
  return currentName;
}

// Notifies callers (e.g., the in-page pill) when either the team token
// or team name changes — so the pill re-renders the moment the user
// switches teams in the popup.
export function subscribeTeam(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function notify(): void {
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      /* swallow — one bad subscriber can't break the others */
    }
  }
}

export function initTeamState(): void {
  try {
    const get = (chrome as any)?.storage?.local?.get;
    if (typeof get !== 'function') return;
    get.call(
      (chrome as any).storage.local,
      [TEAM_TOKEN_KEY, TEAM_NAME_KEY],
      (out: Record<string, unknown>) => {
        const storedToken = out[TEAM_TOKEN_KEY];
        if (typeof storedToken === 'string' && storedToken) {
          currentToken = storedToken;
          console.info('[trailhead] team token loaded from storage');
        }
        const storedName = out[TEAM_NAME_KEY];
        if (typeof storedName === 'string' && storedName) {
          currentName = storedName;
        }
      },
    );
    const onChanged = (chrome as any)?.storage?.onChanged?.addListener;
    if (typeof onChanged !== 'function') return;
    onChanged.call(
      (chrome as any).storage.onChanged,
      (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area !== 'local') return;
        let changed = false;
        if (TEAM_TOKEN_KEY in changes) {
          const v = changes[TEAM_TOKEN_KEY]?.newValue;
          currentToken = typeof v === 'string' && v ? v : DEFAULT_TEAM_TOKEN;
          console.info('[trailhead] team token changed → using new token for next request');
          changed = true;
        }
        if (TEAM_NAME_KEY in changes) {
          const v = changes[TEAM_NAME_KEY]?.newValue;
          currentName = typeof v === 'string' && v ? v : null;
          changed = true;
        }
        if (changed) notify();
      },
    );
  } catch {
    // chrome.* unavailable — leave default.
  }
}
