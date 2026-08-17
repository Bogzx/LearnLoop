// Cached, synchronously-readable view of the popup-controlled API base URL.
//
// Mirrors team-state.ts: seeded from chrome.storage.local at init and kept
// live via chrome.storage.onChanged, so editing the URL in the popup takes
// effect on an already-open Claude.ai tab without a reload.
//
// Storage key: 'trailhead.apiUrl' — string. Falls back to DEFAULT_API_URL
// (a self-hosted API on this machine) when nothing is stored. Trailhead has
// no hosted API: see SELFHOSTING.md at the repo root.

import { API_URL_KEY, DEFAULT_API_URL, TRAILHEAD_ERROR_TAG } from './config.ts';

let currentUrl = DEFAULT_API_URL;
const subscribers = new Set<() => void>();

/** Trim whitespace and any trailing slash so callers can append '/score'
 *  without producing a double slash. Returns '' for unusable input, which
 *  callers treat as "not configured". */
export function normalizeApiUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  } catch {
    return '';
  }
  return trimmed;
}

/** The API base URL every request should use, with no trailing slash. */
export function getApiUrl(): string {
  return currentUrl;
}

/** True when the user has never edited the URL — i.e. we're on the built-in
 *  localhost default. Used to tailor the "can't reach the API" hint. */
export function isDefaultApiUrl(): boolean {
  return currentUrl === DEFAULT_API_URL;
}

/** One actionable sentence naming exactly what the user must do. Logged on
 *  every network-level failure so a dead/unconfigured API is never silent. */
export function apiUnreachableHint(): string {
  return isDefaultApiUrl()
    ? `${TRAILHEAD_ERROR_TAG} cannot reach the Trailhead API at ${currentUrl}. ` +
        `Trailhead is self-hosted — start it with \`docker compose up\` (see SELFHOSTING.md), ` +
        `or open the extension popup and set "API server" to your API's URL.`
    : `${TRAILHEAD_ERROR_TAG} cannot reach the Trailhead API at ${currentUrl}. ` +
        `Check that the server is running, or correct "API server" in the extension popup.`;
}

export function subscribeApiUrl(cb: () => void): () => void {
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

export function initApiUrlState(): void {
  try {
    const get = (chrome as any)?.storage?.local?.get;
    if (typeof get !== 'function') return;
    get.call((chrome as any).storage.local, API_URL_KEY, (out: Record<string, unknown>) => {
      const stored = normalizeApiUrl(out?.[API_URL_KEY]);
      if (stored) {
        currentUrl = stored;
        console.info(`${TRAILHEAD_ERROR_TAG} API URL loaded from storage: ${currentUrl}`);
      } else {
        console.info(`${TRAILHEAD_ERROR_TAG} API URL not configured — using default ${currentUrl}`);
      }
    });
    const onChanged = (chrome as any)?.storage?.onChanged?.addListener;
    if (typeof onChanged !== 'function') return;
    onChanged.call(
      (chrome as any).storage.onChanged,
      (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area !== 'local' || !(API_URL_KEY in changes)) return;
        currentUrl = normalizeApiUrl(changes[API_URL_KEY]?.newValue) || DEFAULT_API_URL;
        console.info(`${TRAILHEAD_ERROR_TAG} API URL changed → ${currentUrl}`);
        notify();
      },
    );
  } catch {
    // chrome.* unavailable — leave the default in place.
  }
}
