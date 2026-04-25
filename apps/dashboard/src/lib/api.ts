// Thin SWR-friendly client for the Trailhead API. Reads URL + token from
// NEXT_PUBLIC_* env so the values end up bundled into the client. This is
// acceptable for the demo (single hardcoded team token, no real users —
// see master spec §3). Production would proxy through a server route.

import type {
  ContextResponse,
  ExamplesResponse,
  ScoreResponse,
  SkillArcResponse,
  TeamMetricsResponse,
  WikiRecentResponse,
  WikiTreeResponse,
} from '@trailhead/shared';

const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://trailheadapi-production.up.railway.app';
const API_URL = RAW_API_URL.replace(/\/$/, '');
const TEAM_TOKEN = process.env.NEXT_PUBLIC_TEAM_TOKEN ?? 'trailhead_demo_acme_2026';

// Single source of truth for headers — every fetch goes through here so
// the token is never accidentally dropped.
function headers(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Team-Token': TEAM_TOKEN,
  };
}

// SWR-friendly fetcher. Throws on non-2xx so SWR's `error` channel fires.
// Path is the URL portion after the API base, e.g. '/skill-arc?since=...'.
export async function fetcher<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: headers() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`trailhead-api ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// Typed convenience wrappers. Each page imports the one it needs and
// passes it as the SWR fetcher; this keeps useSWR<T> generics inferred
// without each page restating the path string.
export const api = {
  skillArc: (since?: string, userId?: string): Promise<SkillArcResponse> => {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    if (userId) params.set('user_id', userId);
    const qs = params.toString();
    return fetcher(`/skill-arc${qs ? `?${qs}` : ''}`);
  },
  teamMetrics: (): Promise<TeamMetricsResponse> => fetcher('/team/metrics'),
  wikiTree: (): Promise<WikiTreeResponse> => fetcher('/wiki/tree'),
  wikiRecent: (since?: string): Promise<WikiRecentResponse> => {
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    return fetcher(`/wiki/recent${qs}`);
  },
  context: (path: string): Promise<ContextResponse> =>
    fetcher(`/context?path=${encodeURIComponent(path)}`),
  examples: (path: string): Promise<ExamplesResponse> =>
    fetcher(`/examples?path=${encodeURIComponent(path)}`),
};

// Score is POST so it doesn't fit the GET fetcher pattern. Inlined for
// the rare case the dashboard wants to demonstrate scoring directly
// (not used by the live tick — that just reads /skill-arc).
export async function scorePrompt(args: {
  prompt: string;
  user_id: string;
  file_path?: string;
}): Promise<ScoreResponse> {
  const res = await fetch(`${API_URL}/score`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`trailhead-api /score ${res.status}`);
  }
  return res.json();
}

// Surfacing the resolved API URL helps debugging in the browser console.
export const RESOLVED_API_URL = API_URL;
