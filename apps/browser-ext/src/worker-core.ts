// The API request path shared by the content script and the extension's
// service worker (background.ts). The content script never fetches the API
// itself: it sends an ApiRequestMessage over chrome.runtime messaging, and
// the worker performs the fetch.
//
// Why: a fetch from a content script runs with the page's origin
// (https://claude.ai), so Chrome's Local Network Access checks treat a call
// to http://localhost:3000 (the default self-hosted API) as a public site
// reaching into the loopback address space and block it ("Permission was
// denied for this request to access the loopback address space"). The
// extension's own service worker holds the manifest's host permissions and is
// not subject to that check. It also keeps the team secret out of the page's
// request path: the worker reads it from chrome.storage and attaches
// X-Team-Token itself.
//
// Everything here is pure (deps injected) so it is unit-tested in Node:
// src/worker-core.test.mts.

import { API_URL_KEY, DEFAULT_API_URL, TEAM_TOKEN as DEMO_TEAM_TOKEN } from './config.ts';

export const API_MESSAGE = 'trailhead.api';
export const API_ABORT_MESSAGE = 'trailhead.api.abort';
// Same key as team-state.ts (not imported, so the worker bundle stays free of
// the content script's DOM-side modules).
export const TEAM_TOKEN_STORAGE_KEY = 'trailhead.selectedTeamToken';

export interface ApiRequestMessage {
  type: typeof API_MESSAGE;
  id: string;
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
  timeoutMs: number;
}

export interface ApiAbortMessage {
  type: typeof API_ABORT_MESSAGE;
  id: string;
}

export type ApiFailure =
  | 'network' // fetch threw: API down, wrong host, DNS, blocked
  | 'timeout'
  | 'aborted' // superseded by a newer request for the same endpoint
  | 'bad_json'
  | 'no_host_permission' // non-localhost API URL whose origin was never granted
  | 'bad_request' // malformed message or a path outside the allowlist
  | 'no_worker'; // content side only: the worker never answered

export interface ApiReply {
  ok: boolean;
  status: number; // 0 when no HTTP response
  data: unknown;
  /** The API base URL the worker used, for accurate error messages. */
  apiUrl: string;
  deprecation: boolean;
  retryAfter: string | null;
  failure?: ApiFailure;
  message?: string;
}

// The only API routes the content script uses. Anything else is refused, so
// the worker can't be turned into a generic authenticated proxy (e.g. for
// DELETE /team/data) by whatever ends up able to message it.
const ALLOWED: Record<string, ReadonlyArray<'GET' | 'POST'>> = {
  '/score': ['POST'],
  '/capture': ['POST'],
  '/diff': ['POST'],
  '/coach': ['POST'],
  '/improve': ['POST'],
  '/wiki/recent': ['GET'],
  '/wiki/tree': ['GET'],
};

export const MAX_TIMEOUT_MS = 60_000;

export function isApiRequest(m: unknown): m is ApiRequestMessage {
  const r = m as Partial<ApiRequestMessage> | null;
  return !!r && r.type === API_MESSAGE && typeof r.id === 'string' && typeof r.path === 'string' &&
    (r.method === 'GET' || r.method === 'POST') && typeof r.timeoutMs === 'number';
}

export function isApiAbort(m: unknown): m is ApiAbortMessage {
  const r = m as Partial<ApiAbortMessage> | null;
  return !!r && r.type === API_ABORT_MESSAGE && typeof r.id === 'string';
}

export function isAllowedRoute(path: string, method: 'GET' | 'POST'): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  const route = path.split('?')[0]!;
  return ALLOWED[route]?.includes(method) ?? false;
}

/** Trim whitespace and trailing slashes; '' for anything that isn't an
 *  http(s) URL (callers then use the default). */
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

export interface WorkerConfig {
  apiUrl: string;
  teamToken: string;
}

/** Resolve the worker's config from a chrome.storage.local snapshot. */
export function configFromStorage(out: Record<string, unknown> | undefined): WorkerConfig {
  const token = out?.[TEAM_TOKEN_STORAGE_KEY];
  return {
    apiUrl: normalizeApiUrl(out?.[API_URL_KEY]) || DEFAULT_API_URL,
    teamToken: typeof token === 'string' && token ? token : DEMO_TEAM_TOKEN,
  };
}

/** The optional-host-permission pattern the popup requests for an API URL. */
export function originPattern(apiUrl: string): string {
  return `${new URL(apiUrl).origin}/*`;
}

export interface WorkerDeps {
  fetch: typeof fetch;
  /** Read fresh on every request: a service worker can be restarted at any
   *  time, and reading storage is cheap, so there is no cache to go stale. */
  readConfig(): Promise<WorkerConfig>;
  /** chrome.permissions.contains for the API origin. */
  hasHostPermission(pattern: string): Promise<boolean>;
}

function reply(apiUrl: string, extra: Partial<ApiReply>): ApiReply {
  return { ok: false, status: 0, data: null, apiUrl, deprecation: false, retryAfter: null, ...extra };
}

/**
 * Perform one API request for the content script. Never throws; every
 * failure is a reply with ok:false and a `failure` code, so the content side
 * can fail open (coaching simply doesn't happen) and log the right hint.
 * `signal` aborts the fetch when the content script supersedes the request.
 */
export async function handleApiRequest(
  msg: ApiRequestMessage,
  deps: WorkerDeps,
  signal?: AbortSignal,
): Promise<ApiReply> {
  let cfg: WorkerConfig;
  try {
    cfg = await deps.readConfig();
  } catch {
    cfg = configFromStorage(undefined);
  }
  if (!isAllowedRoute(msg.path, msg.method)) {
    return reply(cfg.apiUrl, { failure: 'bad_request', message: `route not allowed: ${msg.method} ${msg.path}` });
  }
  try {
    if (!(await deps.hasHostPermission(originPattern(cfg.apiUrl)))) {
      return reply(cfg.apiUrl, {
        failure: 'no_host_permission',
        message: `no permission to reach ${new URL(cfg.apiUrl).origin} — open the extension popup and click Save to grant it`,
      });
    }
  } catch {
    // permissions API unavailable: try the fetch anyway.
  }

  // Superseded before we got here: don't start a request nobody will read.
  if (signal?.aborted) return reply(cfg.apiUrl, { failure: 'aborted' });

  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, Math.min(Math.max(msg.timeoutMs, 1), MAX_TIMEOUT_MS));
  const onAbort = () => ac.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await deps.fetch(`${cfg.apiUrl}${msg.path}`, {
      method: msg.method,
      headers: { 'Content-Type': 'application/json', 'X-Team-Token': cfg.teamToken },
      body: msg.body !== undefined ? JSON.stringify(msg.body) : undefined,
      signal: ac.signal,
    });
    const base = {
      status: res.status,
      deprecation: res.headers.get('Deprecation') === 'true',
      retryAfter: res.headers.get('Retry-After'),
    };
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      if (res.ok) return reply(cfg.apiUrl, { ...base, failure: 'bad_json' });
    }
    return reply(cfg.apiUrl, { ...base, ok: res.ok, data });
  } catch (err) {
    if (ac.signal.aborted) {
      return reply(cfg.apiUrl, { failure: timedOut ? 'timeout' : 'aborted' });
    }
    return reply(cfg.apiUrl, { failure: 'network', message: (err as Error)?.message ?? String(err) });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
