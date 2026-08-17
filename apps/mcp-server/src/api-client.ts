// Thin client for the Trailhead Hono API. Used by every MCP tool handler.
// Reads URL + token from env so the same module works in MCP context (env
// from .mcp.json) and in standalone tests (env from .env).
// These shapes are the API's response contract, so they live in
// @trailhead/shared next to the endpoint types rather than being re-declared
// here. They used to be local copies that happened to be field-identical to
// the server's — with nothing linking the two, so a server-side change would
// have compiled cleanly on both sides and broken only at runtime.
import type {
  CoachRequest,
  CoachResponse,
  ContextNode,
  ContextResponse,
  ExamplesItem,
  ExamplesResponse,
  OnboardRepoFullRequest,
  OnboardRepoFullResponse,
  OnboardRepoRequest,
  OnboardRepoResponse,
  ProvenPromptsResponse,
  ScoreRequest,
  ScoreResponse,
  SearchItem,
  SearchResponse,
  WikiJobStatusResponse,
  WikiProposeRequest,
  WikiProposeResponse,
  WikiRecentItem,
  WikiRecentResponse,
} from '@trailhead/shared';

// Re-exported so existing importers of these names from './api-client.ts'
// keep working.
export type {
  ContextNode,
  ContextResponse,
  ExamplesItem,
  ExamplesResponse,
  SearchItem,
  SearchResponse,
  WikiRecentItem,
  WikiRecentResponse,
};

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

  coach(body: CoachRequest): Promise<CoachResponse> {
    return this.req('POST', '/coach', body);
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

  provenPrompts(args: {
    minScore?: number;
    path?: string;
    topic?: string;
    limit?: number;
  } = {}): Promise<ProvenPromptsResponse> {
    const q = new URLSearchParams();
    if (typeof args.minScore === 'number') q.set('min_score', String(args.minScore));
    if (args.path) q.set('path', args.path);
    if (args.topic) q.set('topic', args.topic);
    if (typeof args.limit === 'number') q.set('limit', String(args.limit));
    const suffix = q.toString();
    return this.req('GET', `/prompts/proven${suffix ? `?${suffix}` : ''}`);
  }

  onboardRepo(body: OnboardRepoRequest): Promise<OnboardRepoResponse> {
    return this.req('POST', '/onboard/repo', body);
  }

  // Rich (LLM-generated) bootstrap. Returns a job_id; caller polls
  // jobStatus(id) until status is 'done' or 'failed'.
  // Spec: 2026-04-26-wiki-bootstrap-rich-design.md §9
  onboardRepoFull(body: OnboardRepoFullRequest): Promise<OnboardRepoFullResponse> {
    return this.req('POST', '/onboard/repo/full', body);
  }

  jobStatus(jobId: string): Promise<WikiJobStatusResponse> {
    return this.req('GET', `/onboard/jobs/${encodeURIComponent(jobId)}`);
  }

  resetTeam(): Promise<{
    team_token: string;
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
