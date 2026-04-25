// Single hardcoded configuration for the demo build (spec §2 / §3).
// `chrome.storage.local.trailhead.disabled` is the only runtime knob (spec §6.6).
export const API_URL = 'https://trailheadapi-production.up.railway.app';
export const TEAM_TOKEN = 'trailhead_demo_acme_2026';
export const USER_ID = 'demo';

/** Per-fetch timeout via AbortController (spec §6.1). */
export const FETCH_TIMEOUT_MS = 4000;

/** Live-scoring debounce on textarea input (spec §6 / §5.2). */
export const SCORE_DEBOUNCE_MS = 250;

/** Pre-send pulse window before auto-sending unchanged (spec §5.3). */
export const SEND_NUDGE_MS = 5000;

/** Wiki poll cadence while the tab is visible (spec §5.5). */
export const WIKI_POLL_MS = 2000;

/** Backoff cadence after WIKI_FAILURE_THRESHOLD consecutive failures. */
export const WIKI_BACKOFF_MS = 30000;
export const WIKI_FAILURE_THRESHOLD = 5;

/** Auto-dismiss for in-conversation toasts. */
export const TOAST_LIFETIME_MS = 8000;

/** Retry interval when resolveSelectors returns null (spec §5.1). */
export const SELECTOR_RETRY_MS = 5000;

/** Tag we attach to every Trailhead-thrown error so the global guard can
 * filter for our own stack frames (spec §6.5). */
export const TRAILHEAD_ERROR_TAG = '[trailhead]';
