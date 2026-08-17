// Configuration for the extension. Trailhead is self-host-first: there is no
// hosted API to fall back to, so the default points at an API running on this
// machine (see SELFHOSTING.md at the repo root — `docker compose up`).
//
// The URL is user-editable in the popup ("API server" row) and persisted to
// chrome.storage.local under API_URL_KEY. Read it through
// `getApiUrl()` (api-url-state.ts), never by importing a constant — the value
// changes at runtime when the user edits it.

/** Default API base URL: a self-hosted Trailhead API on this machine.
 *  Matches the port apps/api listens on (PORT ?? 3000) and the port published
 *  by the root docker-compose.yml. */
export const DEFAULT_API_URL = 'http://localhost:3000';

/** chrome.storage.local key holding the user's API base URL override. */
export const API_URL_KEY = 'trailhead.apiUrl';

export const TEAM_TOKEN = 'trailhead_demo_acme_2026';
export const USER_ID = 'demo';

/** Per-fetch timeout via AbortController (spec §6.1).
 *  Raised from 4s to 12s after enabling Gemini thinking on /score: a normal
 *  scored response now lands at 2-4s; 12s leaves room for tail latency
 *  without leaving the user staring at a frozen "scoring…" UI forever. */
export const FETCH_TIMEOUT_MS = 12000;

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
