// Thin SWR-friendly client for the Trailhead API. Every fetcher takes a
// `token` so the dashboard can render any team's data — the team picker
// fetches /teams (no auth) and routes each team card to ?team=<token>;
// downstream pages read that param and pass it into these calls.
//
// Tokens aren't secrets in this design — they're derived from public git
// remotes. See master spec §3 for the trust model.

import type {
  ContextResponse,
  ExamplesResponse,
  ScoreResponse,
  SkillArcResponse,
  TeamMetricsResponse,
  TeamsListResponse,
  WikiRecentResponse,
  WikiTreeResponse,
} from '@trailhead/shared';

// Trailhead ships no hosted API — the backend is self-hosted, so
// NEXT_PUBLIC_API_URL is required config. The default matches the port
// apps/api listens on (PORT ?? 3000) and the port the root
// docker-compose.yml publishes, so a local `docker compose up` just works.
//
// Deliberately NOT a module-scope throw: `next build` evaluates this file
// while prerendering, and a hard failure there would break the build for
// anyone without env set. We fall back, record that we fell back, and fail
// loudly at request time instead (see assertConfigured / fetcher below).
export const DEFAULT_API_URL = 'http://localhost:3000';

const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
const API_URL = RAW_API_URL.replace(/\/$/, '');

/** False when NEXT_PUBLIC_API_URL was never set and we're on the localhost
 *  default. Pages use it to explain a failure instead of showing a bare
 *  "fetch failed". */
export const IS_API_URL_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_API_URL);

/** Actionable, self-contained message naming the exact variable to set. */
export function apiConfigHint(): string {
  return IS_API_URL_CONFIGURED
    ? `Could not reach the Trailhead API at ${API_URL}. Check that the server is running and that NEXT_PUBLIC_API_URL is correct.`
    : `Could not reach the Trailhead API at ${API_URL}. NEXT_PUBLIC_API_URL is not set, so the dashboard fell back to the local default. Trailhead is self-hosted — start the API with \`docker compose up\` from the repo root (see SELFHOSTING.md), or set NEXT_PUBLIC_API_URL to your server's base URL.`;
}

// Wraps a fetch so a network-layer failure (server down, wrong host) becomes
// the actionable message above rather than an opaque TypeError. Non-2xx
// responses are the caller's business and pass straight through.
async function guardedFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    throw new Error(apiConfigHint(), { cause: err });
  }
}

// Default fallback when no `?team=` param is present in the URL. Keeps the
// existing demo-team links (`/wiki`, `/skill-arc`) working without changes.
export const DEFAULT_TEAM_TOKEN =
  process.env.NEXT_PUBLIC_TEAM_TOKEN ?? 'trailhead_demo_acme_2026';

function headers(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Team-Token': token,
  };
}

// SWR-friendly fetcher. Throws on non-2xx so SWR's `error` channel fires.
async function fetcher<T>(path: string, token: string): Promise<T> {
  const res = await guardedFetch(`${API_URL}${path}`, { headers: headers(token) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`trailhead-api ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// Public team enumeration — no auth header required server-side.
async function fetchListTeams(): Promise<TeamsListResponse> {
  const res = await guardedFetch(`${API_URL}/teams`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`trailhead-api /teams ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as TeamsListResponse;
}

// Typed convenience wrappers. Each page imports the one it needs and
// passes it as the SWR fetcher; this keeps useSWR<T> generics inferred
// without each page restating the path string.
export const api = {
  listTeams: (): Promise<TeamsListResponse> => fetchListTeams(),
  skillArc: (token: string, since?: string, userId?: string): Promise<SkillArcResponse> => {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    if (userId) params.set('user_id', userId);
    const qs = params.toString();
    return fetcher(`/skill-arc${qs ? `?${qs}` : ''}`, token);
  },
  teamMetrics: (token: string): Promise<TeamMetricsResponse> => fetcher('/team/metrics', token),
  wikiTree: (token: string): Promise<WikiTreeResponse> => fetcher('/wiki/tree', token),
  wikiRecent: (token: string, since?: string): Promise<WikiRecentResponse> => {
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    return fetcher(`/wiki/recent${qs}`, token);
  },
  context: (token: string, path: string): Promise<ContextResponse> =>
    fetcher(`/context?path=${encodeURIComponent(path)}`, token),
  examples: (token: string, path: string): Promise<ExamplesResponse> =>
    fetcher(`/examples?path=${encodeURIComponent(path)}`, token),
};

// Score is POST so it doesn't fit the GET fetcher pattern.
export async function scorePrompt(
  token: string,
  args: { prompt: string; user_id: string; file_path?: string },
): Promise<ScoreResponse> {
  const res = await guardedFetch(`${API_URL}/score`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`trailhead-api /score ${res.status}`);
  }
  return res.json();
}

// Surfacing the resolved API URL helps debugging in the browser console.
export const RESOLVED_API_URL = API_URL;
