// Client-side fetchers for the dashboard. They call this app's read-only
// proxy (app/api/trailhead/[...path]), which adds the team secret on the
// server — the browser never sees it. See lib/server-config.ts.

import type {
  ContextResponse,
  ExamplesResponse,
  SkillArcResponse,
  TeamMetricsResponse,
  WikiRecentResponse,
  WikiTreeResponse,
} from '@trailhead/shared';

const PROXY = '/api/trailhead';

// SWR-friendly fetcher. Throws on non-2xx so SWR's `error` channel fires; the
// proxy's 502 carries an actionable `detail` naming the variable to fix.
async function fetcher<T>(path: string): Promise<T> {
  const res = await fetch(`${PROXY}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try {
      detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
    } catch {
      /* not JSON */
    }
    throw new Error(`trailhead-api ${path} ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

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
