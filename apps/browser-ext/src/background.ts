// MV3 service worker: performs every API request for the content script.
// See worker-core.ts for why (Chrome's Local Network Access checks block a
// claude.ai content script from fetching a localhost API; the extension's
// worker is exempt) and for the request/reply contract.

import { API_URL_KEY } from './config.ts';
import {
  configFromStorage,
  handleApiRequest,
  isApiAbort,
  isApiRequest,
  TEAM_TOKEN_STORAGE_KEY,
  type ApiReply,
  type WorkerDeps,
} from './worker-core.ts';

declare const chrome: any;

const deps: WorkerDeps = {
  fetch: (input, init) => fetch(input, init),
  readConfig: () =>
    new Promise((resolve) => {
      chrome.storage.local.get([API_URL_KEY, TEAM_TOKEN_STORAGE_KEY], (out: Record<string, unknown>) => {
        resolve(configFromStorage(out));
      });
    }),
  hasHostPermission: (pattern) =>
    new Promise((resolve) => {
      chrome.permissions.contains({ origins: [pattern] }, (has: boolean) => resolve(Boolean(has)));
    }),
};

// In-flight requests by id, so the content script can cancel a superseded
// one (a newer /score replaces the previous keystroke's).
const inflight = new Map<string, AbortController>();

chrome.runtime.onMessage.addListener(
  (msg: unknown, sender: { id?: string }, sendResponse: (r: ApiReply) => void) => {
    // Only this extension's own content scripts and pages.
    if (sender?.id !== chrome.runtime.id) return false;
    if (isApiAbort(msg)) {
      inflight.get(msg.id)?.abort();
      inflight.delete(msg.id);
      return false;
    }
    if (!isApiRequest(msg)) return false;
    const ac = new AbortController();
    inflight.set(msg.id, ac);
    void handleApiRequest(msg, deps, ac.signal)
      .then(sendResponse)
      .catch(() => {}) // the tab went away before the reply; nothing to do
      .finally(() => inflight.delete(msg.id));
    return true; // reply asynchronously; keeps the worker alive until then
  },
);
