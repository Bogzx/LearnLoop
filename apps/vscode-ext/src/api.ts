// Tiny HTTP client used by the extension host. Matches the locked shapes from
// packages/shared and the Phase-2 endpoints from the roadmap §2.
import type {
  ScoreRequest,
  ScoreResponse,
  WikiProposeResponse,
} from '@trailhead/shared';

export interface ExamplesItem {
  template: string;
  topic: string | null;
  reuse_count: number;
  node_path: string;
}
export interface ExamplesResponse { items: ExamplesItem[]; }

export interface WikiRecentItem {
  id: string;
  node_path: string;
  body: string;
  status: 'draft' | 'durable';
  reinforcement_count: number;
  last_seen_at: string;
  created_at: string;
}
export interface WikiRecentResponse { items: WikiRecentItem[]; }

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
