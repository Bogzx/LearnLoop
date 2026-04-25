// Source of truth for request/response shapes. Every artifact (api, browser-ext,
// vscode-ext, mcp-server, stop-hook, dashboard) imports from here. Tracks spec
// §3 (endpoint list) and §5 (the 5 dimensions). Update both together.

export type Dimension =
  | 'goal_clarity'
  | 'specificity'
  | 'context_loading'
  | 'constraint_articulation'
  | 'output_specification';

export const DIMENSIONS: readonly Dimension[] = [
  'goal_clarity',
  'specificity',
  'context_loading',
  'constraint_articulation',
  'output_specification',
] as const;

export type Surface = 'browser' | 'vscode' | 'mcp';
export type Outcome = 'helpful' | 'mixed' | 'not';

export type DimensionScores = Record<Dimension, number>;          // 0-10 per dim
export type MissingHints    = Partial<Record<Dimension, string>>; // hint when dim < 5

// POST /score — live 5-dim Haiku score; writes skill_observation inline (§5)
export interface ScoreRequest  { prompt: string; file_path?: string; user_id: string; }
export interface ScoreResponse { overall: number; dimensions: DimensionScores; missing: MissingHints; }

// POST /capture — store conversation + outcome (§3)
export interface CaptureRequest {
  surface: Surface;
  user_prompt: string;
  ai_response?: string;
  file_path?: string;
  outcome?: Outcome;
  scored_dimensions?: DimensionScores;
  user_id: string;
}
export interface CaptureResponse { id: string; }

// POST /wiki/propose — autonomous wiki update with normalize + dedup + counter (§7)
export interface WikiProposeRequest  { node_path: string; insight: string; }
export interface WikiProposeResponse {
  action: 'created' | 'reinforced' | 'promoted';
  current_count: number;
  promoted_to_durable?: boolean;
}

// GET /context?path= — HCL bundle, ordered shallow → deep (§8)
export interface ContextLearning { body: string; reinforcement_count: number; }
export interface ContextNode {
  path: string;
  body_md: string;
  durable_learnings: ContextLearning[];
}
export interface ContextResponse { nodes: ContextNode[]; }

// GET /examples?path= — top graduated prompts for an ancestor of `path`
export interface ExamplesItem {
  template: string;
  topic: string | null;
  reuse_count: number;
  node_path: string;
}
export interface ExamplesResponse { items: ExamplesItem[]; }

// GET /wiki/recent?since=ISO — sidebar polling endpoint (Person C roadmap §3)
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

// POST /diff — Sonnet/Pro-driven Prompt Diff (§10)
export interface DiffRequest  { user_prompt: string; file_path?: string; user_id: string; }
export interface DiffResponse {
  user: { prompt: string; overall: number; dimensions: DimensionScores };
  team: { prompt: string; overall: number; dimensions: DimensionScores; node_path: string; topic: string | null };
  narrative: string;
}
