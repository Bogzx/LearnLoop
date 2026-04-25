// Thin client for the Trailhead Hono API. Used by every MCP tool handler.
// Reads URL + token from env so the same module works in MCP context (env
// from .mcp.json) and in standalone tests (env from .env).
import type {
  OnboardRepoRequest,
  OnboardRepoResponse,
  ScoreRequest,
  ScoreResponse,
  WikiProposeRequest,
  WikiProposeResponse,
} from '@trailhead/shared';

export interface ContextNode {
  path: string;
  body_md: string;
  durable_learnings: { body: string; reinforcement_count: number }[];
}
export interface ContextResponse { nodes: ContextNode[]; }

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

export interface SearchItem {
  kind: 'learning' | 'rule' | 'prompt';
  body: string;
  node_path: string;
}
export interface SearchResponse { items: SearchItem[]; }

export interface ApiClientConfig {
  apiUrl: string;
  teamToken: string;
}

export class ApiClient {
  constructor(private readonly cfg: ApiClientConfig) {}

  private headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-Team-Token': this.cfg.teamToken,
    };
  }

  // Network failure is converted into a thrown Error with a stable message
  // shape so MCP tool handlers can present it to the model uniformly.
  private async req<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const url = `${this.cfg.apiUrl.replace(/\/$/, '')}${path}`;
    const init: RequestInit = { method, headers: this.headers() };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`trailhead-api ${method} ${path} ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  score(body: ScoreRequest): Promise<ScoreResponse> {
    return this.req('POST', '/score', body);
  }

  wikiPropose(body: WikiProposeRequest): Promise<WikiProposeResponse> {
    return this.req('POST', '/wiki/propose', body);
  }

  // Phase 2/3 endpoints. The live stub may not have these yet — handlers
  // catch and surface "endpoint not deployed" gracefully rather than crashing.
  context(path: string): Promise<ContextResponse> {
    const q = new URLSearchParams({ path });
    return this.req('GET', `/context?${q}`);
  }

  examples(path: string): Promise<ExamplesResponse> {
    const q = new URLSearchParams({ path });
    return this.req('GET', `/examples?${q}`);
  }

  wikiRecent(sinceIso: string): Promise<WikiRecentResponse> {
    const q = new URLSearchParams({ since: sinceIso });
    return this.req('GET', `/wiki/recent?${q}`);
  }

  search(query: string, scope?: string): Promise<SearchResponse> {
    const q = new URLSearchParams({ q: query });
    if (scope) q.set('scope', scope);
    return this.req('GET', `/search?${q}`);
  }

  onboardRepo(body: OnboardRepoRequest): Promise<OnboardRepoResponse> {
    return this.req('POST', '/onboard/repo', body);
  }

  resetTeam(): Promise<{
    team_id: string;
    deleted: { nodes: number; learnings: number; prompts: number; captures: number; observations: number };
  }> {
    return this.req('DELETE', '/team/data', { confirm: true });
  }
}

export function clientFromEnv(): ApiClient {
  const apiUrl = process.env.TRAILHEAD_API_URL;
  const teamToken = process.env.TRAILHEAD_TEAM_TOKEN;
  if (!apiUrl) throw new Error('TRAILHEAD_API_URL not set');
  if (!teamToken) throw new Error('TRAILHEAD_TEAM_TOKEN not set');
  return new ApiClient({ apiUrl, teamToken });
}
