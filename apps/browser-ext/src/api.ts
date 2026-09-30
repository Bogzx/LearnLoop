// Every API request flows through here. Hard contract:
//
//   - the request goes to the extension's service worker over
//     chrome.runtime messaging (worker-core.ts / background.ts), which does
//     the fetch. The content script never fetches the API itself: from a
//     claude.ai page Chrome's Local Network Access checks block requests to a
//     localhost API, and the worker is exempt. The worker also attaches the
//     team secret, read from chrome.storage.
//   - 12s default timeout (spec §6.1), enforced in the worker, with a local
//     backstop in case the worker never answers
//   - any non-2xx, network error, abort, timeout, JSON parse error or missing
//     worker → returns null; never throws to callers
//   - per-endpoint cancellation: a new /score cancels any in-flight /score
//     (the worker aborts its fetch); other endpoints never cancel each other
//
// Callers always handle null; that is the fail-open contract from spec §6.
import type {
  CaptureRequest,
  CaptureResponse,
  CoachRequest,
  CoachResponse,
  DiffRequest,
  DiffResponse,
  ImproveRequest,
  ImproveResponse,
  ScoreRequest,
  ScoreResponse,
  WikiRecentResponse,
  WikiTreeResponse,
} from '@trailhead/shared';
import { FETCH_TIMEOUT_MS, TRAILHEAD_ERROR_TAG } from './config.ts';
import { apiUnreachableHint } from './api-url-state.ts';
import { getContextPath } from './context-state.ts';
import {
  API_ABORT_MESSAGE,
  API_MESSAGE,
  type ApiAbortMessage,
  type ApiReply,
  type ApiRequestMessage,
} from './worker-core.ts';

type EndpointKey = 'score' | 'capture' | 'diff' | 'wiki' | 'wikiTree' | 'improve' | 'coach';

// ---- Transport ---------------------------------------------------------------

/** Sends one message to the service worker and resolves with its reply
 *  (undefined for fire-and-forget messages, or when nobody answered). */
export type WorkerTransport = (msg: ApiRequestMessage | ApiAbortMessage) => Promise<ApiReply | undefined>;

function chromeTransport(msg: ApiRequestMessage | ApiAbortMessage): Promise<ApiReply | undefined> {
  return new Promise((resolve, reject) => {
    try {
      (chrome as any).runtime.sendMessage(msg, (r: ApiReply | undefined) => {
        // Reading lastError marks it handled. For an abort (no reply) it is
        // the expected "port closed"; for a request it means the worker is
        // gone (e.g. the extension was reloaded under this tab).
        const err = (chrome as any).runtime.lastError;
        if (err && msg.type === API_MESSAGE) reject(new Error(err.message ?? String(err)));
        else resolve(r);
      });
    } catch (err) {
      reject(err); // "Extension context invalidated" and friends
    }
  });
}

let transport: WorkerTransport = chromeTransport;

/** Test hook: route messages somewhere other than chrome.runtime. */
export function setWorkerTransport(t: WorkerTransport | null): void {
  transport = t ?? chromeTransport;
}

// ---- Logging -----------------------------------------------------------------

// The API marks responses to a legacy (remote-derived) team token with
// `Deprecation: true`. Say so once per page load, with the fix.
let legacyWarned = false;
function noteDeprecation(r: ApiReply): void {
  if (legacyWarned || !r.deprecation) return;
  legacyWarned = true;
  console.warn(
    `${TRAILHEAD_ERROR_TAG} this team uses a legacy token that anyone who knows the repo URL can compute. ` +
      'Ask your team to run `init --upgrade-legacy` and enter the new secret in the extension popup.',
  );
}

// 429 = the team's server is rate limiting this team or IP. The request
// fails open like any other error; say why in the console, at most once a
// minute so a busy tab doesn't flood it.
let lastRateLimitLog = 0;
export function noteRateLimit(r: { status: number; retryAfter: string | null }, now = Date.now()): boolean {
  if (r.status !== 429) return false;
  if (now - lastRateLimitLog >= 60_000) {
    lastRateLimitLog = now;
    console.warn(
      `${TRAILHEAD_ERROR_TAG} the Trailhead API is rate limiting this team or network` +
        `${r.retryAfter ? ` (retry in ${r.retryAfter}s)` : ''} — prompts are sent uncoached until then.`,
    );
  }
  return true;
}

// A self-hosted API that isn't running (or is configured to the wrong host)
// fails at the network layer. That gets the actionable "here is what to fix"
// message, naming the URL the worker actually used, so an unconfigured API is
// never a silent no-op. Superseded requests are silent.
function logFailure(path: string, r: ApiReply): void {
  switch (r.failure) {
    case 'aborted':
      return;
    case 'network':
      console.warn(`${apiUnreachableHint(r.apiUrl)} (request: ${path}${r.message ? `; ${r.message}` : ''})`);
      return;
    case 'no_host_permission':
      console.warn(`${TRAILHEAD_ERROR_TAG} ${r.message} (request: ${path})`);
      return;
    case 'no_worker':
      console.warn(
        `${TRAILHEAD_ERROR_TAG} the extension's background worker did not answer (request: ${path}) — ` +
          'if the extension was just reloaded or updated, reload this tab.',
      );
      return;
    default:
      if (r.failure) console.warn(`${TRAILHEAD_ERROR_TAG} ${path} failed: ${r.failure}${r.message ? ` (${r.message})` : ''}`);
      else if (r.status !== 429) console.warn(`${TRAILHEAD_ERROR_TAG} ${path} failed: HTTP ${r.status}`);
  }
}

// ---- Requests ----------------------------------------------------------------

const inflight = new Map<EndpointKey, { id: string; settle: (r: ApiReply) => void }>();
let seq = 0;

function localFailure(failure: ApiReply['failure'], message?: string): ApiReply {
  return { ok: false, status: 0, data: null, apiUrl: '', deprecation: false, retryAfter: null, failure, message };
}

async function call<T>(
  key: EndpointKey,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  { timeoutMs = FETCH_TIMEOUT_MS, cancelPrevious = true }: { timeoutMs?: number; cancelPrevious?: boolean } = {},
): Promise<T | null> {
  const id = `${Date.now().toString(36)}-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await new Promise<ApiReply>((resolve) => {
    let done = false;
    const settle = (reply: ApiReply) => {
      if (done) return;
      done = true;
      clearTimeout(backstop);
      if (inflight.get(key)?.id === id) inflight.delete(key);
      resolve(reply);
    };
    // The worker enforces timeoutMs; this only catches a worker that never
    // answers at all.
    const backstop = setTimeout(() => settle(localFailure('no_worker')), timeoutMs + 3_000);
    if (cancelPrevious) {
      const prev = inflight.get(key);
      if (prev) {
        prev.settle(localFailure('aborted'));
        void transport({ type: API_ABORT_MESSAGE, id: prev.id }).catch(() => {});
      }
      inflight.set(key, { id, settle });
    }
    transport({ type: API_MESSAGE, id, path, method: init.method, body: init.body, timeoutMs }).then(
      (reply) => settle(reply ?? localFailure('no_worker')),
      (err) => settle(localFailure('no_worker', (err as Error)?.message)),
    );
  });
  noteDeprecation(r);
  noteRateLimit(r);
  if (r.ok) return r.data as T;
  logFailure(path, r);
  return null;
}

export async function score(body: ScoreRequest): Promise<ScoreResponse | null> {
  // Inject the popup-selected wiki context path so the server can pull the
  // team's subtree and feed it to Gemini's system prompt. Caller-provided
  // context_path wins (none today, but keeps the contract honest).
  const contextPath = body.context_path ?? getContextPath() ?? undefined;
  const enriched: ScoreRequest = contextPath ? { ...body, context_path: contextPath } : body;
  return call<ScoreResponse>('score', '/score', { method: 'POST', body: enriched });
}

export async function capture(body: CaptureRequest): Promise<CaptureResponse | null> {
  return call<CaptureResponse>('capture', '/capture', { method: 'POST', body });
}

export async function diff(body: DiffRequest): Promise<DiffResponse | null> {
  return call<DiffResponse>('diff', '/diff', { method: 'POST', body });
}

export async function wikiRecent(sinceIso: string): Promise<WikiRecentResponse | null> {
  const q = new URLSearchParams({ since: sinceIso }).toString();
  return call<WikiRecentResponse>('wiki', `/wiki/recent?${q}`, { method: 'GET' });
}

// /coach drives the multi-round educational score arc (curated DIMENSION_TEACH
// blocks, no-progress detection, success/skip reveals). The browser-ext's
// improve widget calls this in place of /improve so its coaching matches the
// MCP server's polished pattern. Same long-timeout policy as /improve since a
// single round runs a Gemini score + render.
export async function coach(body: CoachRequest): Promise<CoachResponse | null> {
  const contextPath = body.context_path ?? getContextPath() ?? undefined;
  const enriched: CoachRequest = contextPath ? { ...body, context_path: contextPath } : body;
  return call<CoachResponse>('coach', '/coach', { method: 'POST', body: enriched }, { timeoutMs: 25_000, cancelPrevious: false });
}

// /improve calls take much longer than other endpoints (Gemini round-trip
// per turn), so they get a 25s timeout instead of the default; the widget's
// … placeholder covers the wait. Neither /coach nor /improve cancels an
// earlier call of its own kind.
export async function improve(body: ImproveRequest): Promise<ImproveResponse | null> {
  const contextPath = body.context_path ?? getContextPath() ?? undefined;
  const enriched: ImproveRequest = contextPath ? { ...body, context_path: contextPath } : body;
  return call<ImproveResponse>('improve', '/improve', { method: 'POST', body: enriched }, { timeoutMs: 25_000, cancelPrevious: false });
}

/** The team's whole wiki tree (context-bundle.ts renders the selected subtree). */
export async function wikiTree(): Promise<WikiTreeResponse | null> {
  return call<WikiTreeResponse>('wikiTree', '/wiki/tree', { method: 'GET' });
}
