// Every fetch flows through here. Hard contract:
//
//   - 4s default timeout via AbortController (spec §6.1)
//   - any non-2xx, network error, abort, or JSON parse error → returns null
//   - never throws to callers
//   - per-endpoint AbortController register so a new /score cancels any
//     in-flight /score; other endpoints never cancel each other
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
} from '@trailhead/shared';
import { API_URL, FETCH_TIMEOUT_MS, TRAILHEAD_ERROR_TAG } from './config.ts';
import { getTeamToken } from './team-state.ts';
import { getContextPath } from './context-state.ts';

type EndpointKey = 'score' | 'capture' | 'diff' | 'wiki' | 'improve' | 'coach';
const inflight = new Map<EndpointKey, AbortController>();

function abortPrev(key: EndpointKey): AbortController {
  const prev = inflight.get(key);
  if (prev) prev.abort();
  const next = new AbortController();
  inflight.set(key, next);
  return next;
}

function clearIfCurrent(key: EndpointKey, ac: AbortController): void {
  if (inflight.get(key) === ac) inflight.delete(key);
}

function withTimeout(ac: AbortController, ms: number): () => void {
  const id = setTimeout(() => ac.abort(), ms);
  return () => clearTimeout(id);
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Team-Token': getTeamToken(),
  };
}

async function call<T>(
  key: EndpointKey,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<T | null> {
  const ac = abortPrev(key);
  const stop = withTimeout(ac, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: init.method,
      headers: headers(),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ac.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    // Aborts and network errors share a single failure path. We log so the
    // demonstrator can `console.warn` to debug; we never re-throw.
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      console.warn(`${TRAILHEAD_ERROR_TAG} ${path} failed`, err);
    }
    return null;
  } finally {
    stop();
    clearIfCurrent(key, ac);
  }
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
  const ac = new AbortController();
  const stop = setTimeout(() => ac.abort(), 25_000);
  try {
    const res = await fetch(`${API_URL}/coach`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(enriched),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as CoachResponse;
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      console.warn(`${TRAILHEAD_ERROR_TAG} /coach failed`, err);
    }
    return null;
  } finally {
    clearTimeout(stop);
  }
}

// /improve calls take much longer than other endpoints (Gemini round-trip
// per turn). Bypass the 4s default timeout — we manage our own through the
// widget's UX (the user sees the … placeholder while it pends).
export async function improve(body: ImproveRequest): Promise<ImproveResponse | null> {
  const contextPath = body.context_path ?? getContextPath() ?? undefined;
  const enriched: ImproveRequest = contextPath ? { ...body, context_path: contextPath } : body;
  const ac = new AbortController();
  const stop = setTimeout(() => ac.abort(), 25_000);
  try {
    const res = await fetch(`${API_URL}/improve`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(enriched),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as ImproveResponse;
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      console.warn(`${TRAILHEAD_ERROR_TAG} /improve failed`, err);
    }
    return null;
  } finally {
    clearTimeout(stop);
  }
}
