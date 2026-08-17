// Tiny HTTP client used by the extension host. Matches the locked shapes from
// packages/shared and the Phase-2 endpoints from the roadmap §2.
// Response shapes come from @trailhead/shared, where the API declares them.
// They were previously re-declared here as field-identical local copies with
// no compile-time link to the server, so drift would have been invisible.
import type {
  ExamplesItem,
  ExamplesResponse,
  ScoreRequest,
  ScoreResponse,
  WikiProposeResponse,
  WikiRecentItem,
  WikiRecentResponse,
} from '@trailhead/shared';

// Re-exported so existing importers of these names from './api.ts' keep working.
export type { ExamplesItem, ExamplesResponse, WikiRecentItem, WikiRecentResponse };

export interface ApiConfig {
  apiUrl: string;
  teamToken: string;
}

function headers(cfg: ApiConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Team-Token': cfg.teamToken,
  };
}

function url(cfg: ApiConfig, path: string): string {
  return `${cfg.apiUrl.replace(/\/$/, '')}${path}`;
}

export async function score(cfg: ApiConfig, body: ScoreRequest, signal?: AbortSignal): Promise<ScoreResponse> {
  const res = await fetch(url(cfg, '/score'), {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`/score ${res.status}`);
  return (await res.json()) as ScoreResponse;
}

export async function examples(cfg: ApiConfig, path: string, signal?: AbortSignal): Promise<ExamplesResponse> {
  const q = new URLSearchParams({ path });
  const res = await fetch(url(cfg, `/examples?${q}`), { headers: headers(cfg), signal });
  if (!res.ok) throw new Error(`/examples ${res.status}`);
  return (await res.json()) as ExamplesResponse;
}

export async function wikiRecent(cfg: ApiConfig, sinceIso: string, signal?: AbortSignal): Promise<WikiRecentResponse> {
  const q = new URLSearchParams({ since: sinceIso });
  const res = await fetch(url(cfg, `/wiki/recent?${q}`), { headers: headers(cfg), signal });
  if (!res.ok) throw new Error(`/wiki/recent ${res.status}`);
  return (await res.json()) as WikiRecentResponse;
}

// Re-exported so the webview / extension can compute toast diffs.
export type { WikiProposeResponse };
