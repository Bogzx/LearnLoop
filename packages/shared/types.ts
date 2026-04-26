// Source of truth for request/response shapes. Every artifact (api, browser-ext,
// vscode-ext, mcp-server, dashboard) imports from here. Tracks spec
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
//
// `context_path` (optional): a wiki node path (e.g. 'src/api/'). If set,
// the server fetches that subtree's body_md + durable learnings and
// prepends it to the Gemini system prompt so the score is calibrated
// against the team's conventions (and Gemini's coaching can reference
// the team's own docs). The user's bare `prompt` is still what gets
// scored — the context just colors the rubric.
export interface ScoreRequest  {
  prompt: string;
  file_path?: string;
  user_id: string;
  context_path?: string;
}
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

// GET /prompts/proven — every graduated prompt for the team, with the
// actual overall score from when /coach promoted it. "Proven" is the user-
// facing framing; under the hood it's status='graduated' filtered by
// graduated_overall_score >= min_score.
export interface ProvenPromptItem {
  id: string;
  template: string;
  topic: string | null;
  reuse_count: number;
  graduated_overall_score: number;     // 0-10; ≥7 by /coach gate
  author_user_id: string | null;
  node_path: string;
  created_at: string;                  // ISO
}
export interface ProvenPromptsResponse { items: ProvenPromptItem[]; }

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

// GET /skill-arc?user_id=&since=ISO — time-series of per-dimension scores
// for the dashboard's hero chart. Drives the §13 close beat.
export interface SkillArcObservation {
  dimension: Dimension;
  score: number;
  ts: string;       // ISO
}
export interface SkillArcResponse { observations: SkillArcObservation[]; }

// GET /team/metrics — snapshot for the dashboard's /team page. No time-series.
export interface TeamMetricsResponse {
  avg_overall: number;          // 0-10, current 7-day mean
  reuse_rate: number;           // 0-1, fraction of captures matching a graduated prompt
  durable_count: number;        // learnings with status='durable'
  draft_count: number;          // learnings with status='draft'
  total_obs: number;            // skill_observations rows
  active_users: number;         // distinct user_id in skill_observations (last 7d)
}

// GET /wiki/tree — full team wiki for the dashboard's /wiki page.
export interface WikiTreeLearning {
  id: string;
  body: string;
  status: 'draft' | 'durable';
  reinforcement_count: number;
}
export interface WikiTreePrompt {
  id: string;
  template: string;
  topic: string | null;
  reuse_count: number;
  author_user_id: string | null;
}
export interface WikiTreeNode {
  path: string;
  body_md: string;
  durable_learnings: WikiTreeLearning[];   // status='durable' only
  draft_learnings: WikiTreeLearning[];     // status='draft' only
  graduated_prompts: WikiTreePrompt[];     // status='graduated' only, sorted by reuse_count DESC
}
export interface WikiTreeResponse { nodes: WikiTreeNode[]; }

// POST /onboard/repo — bootstrap a team's wiki from a list of paths.
// Live since 2026-04-25-demo-completion-design.md §C.1. This is the
// "minimal" bootstrap — folder paths only, body_md seeded from CLAUDE.md.
// For rich (LLM-generated) bootstrap see OnboardRepoFullRequest below.
export interface OnboardRepoRequest {
  paths: string[];                              // e.g., ['src/api/', 'src/db/', ...]
  initial_rules?: Record<string, string>;       // path → markdown body for body_md
  // Human-readable repo name (e.g. "Polihackwinners") to set as teams.name.
  // The token stays a stable hash; this is what the dashboard / popup show.
  // Server only updates teams.name when it currently looks like the
  // 'team:<token-prefix>' placeholder, so explicit renames stick.
  team_name?: string;
}
export interface OnboardRepoResponse {
  nodes_created: number;
  nodes: Array<{ path: string; id: string }>;
}

// POST /onboard/repo/full — rich bootstrap. Client sends folder + file paths
// AND the file contents (subject to caps in spec §7); server runs three
// Gemini passes (folder narratives, file summaries, root tour) and writes
// body_md + draft learnings. Returns a job_id; the work is async — clients
// poll GET /onboard/jobs/:id until status is 'done' or 'failed'.
//
// Spec: docs/superpowers/specs/2026-04-26-wiki-bootstrap-rich-design.md
export interface OnboardRepoFullFile {
  path: string;        // file-shaped path, e.g. 'src/api/auth/issue.ts'
  content: string;     // already truncated client-side (head + tail) to fit caps
  truncated?: boolean; // true if content was head/tail-truncated; LLM should hedge
}
export interface OnboardRepoFullRequest {
  folders: string[];                              // folder-shaped paths, e.g. 'src/api/'
  files: OnboardRepoFullFile[];                   // file-shaped paths + capped content
  initial_rules?: Record<string, string>;         // CLAUDE.md / copilot-instructions seed (root only by convention)
  manifests?: Record<string, string>;             // 'package.json' / 'Cargo.toml' / etc → raw content for tech-stack pass
  force?: boolean;                                // overwrite body_source='bootstrap' rows; manual edits still preserved
  // Human-readable repo name (e.g. "Polihackwinners") to set as teams.name.
  // Same semantics as OnboardRepoRequest.team_name.
  team_name?: string;
}
export interface OnboardRepoFullResponse {
  job_id: string;
  paths_total: number;     // folders.length + files.length + 1 (root)
}

// GET /onboard/jobs/:id — async job status. Status: pending | running | done | failed.
// `paths` lists every node the worker is operating on with its current status.
// `done` with paths_failed > 0 = partial success.
export type WikiJobStatus = 'pending' | 'running' | 'done' | 'failed';
export type WikiJobPathKind = 'folder' | 'file' | 'root';
export interface WikiJobPathStatus {
  path: string;
  kind: WikiJobPathKind;
  status: WikiJobStatus;
  error?: string;
}
export interface WikiJobStatusResponse {
  job_id: string;
  status: WikiJobStatus;
  paths_total: number;
  paths_done: number;
  paths_failed: number;
  started_at: string | null;   // ISO
  finished_at: string | null;  // ISO
  error: string | null;
  paths: WikiJobPathStatus[];
}

// POST /improve — Gemini-driven multi-turn prompt coaching (spec
// 2026-04-26-improve-widget-design.md). Stateless: extension carries the
// full conversation each turn; server holds no session state.
export interface ImproveTurn {
  role: 'assistant' | 'user';
  text: string;
}

export interface ImproveRequest {
  original_prompt: string;
  missing: MissingHints;
  history: ImproveTurn[];
  command: 'next' | 'finalize';
  user_id: string;
  // Same semantics as ScoreRequest.context_path — when set, the server
  // prepends the team's wiki subtree to Gemini's system prompt so the
  // coach's questions and the polished prompt land in the team's idiom.
  context_path?: string;
}

export type ImproveResponse =
  | { kind: 'question'; text: string; turn: number }
  | { kind: 'final'; polished: string; rationale?: string };

// POST /coach — MCP-side coaching loop endpoint. Drives the educational
// teach→reveal cycle described in
// docs/superpowers/specs/2026-04-26-trailhead-educational-loop-design.md.
//
// Stateless: callers (the MCP server) carry round state explicitly.
// Internally reuses /score's Gemini call so writes one set of
// skill_observation rows per call (same dedup as /score).

export type CoachMode = 'score' | 'skip_reveal' | 'augment';

export interface CoachNextRoundInputs {
  original_prompt: string;
  original_dimensions: DimensionScores;
  previous_dimensions: DimensionScores;
  round: number;            // the round number to pass back next call
  // Opaque base64 JSON of the four fields above. The MCP tool can echo
  // ONLY this token on the next /coach call and the server reconstructs
  // the same state — useful because LLMs sometimes drop one of the four
  // explicit fields, which silently restarts the loop at round 1. Both
  // shapes accepted; token wins when both are present.
  round_token: string;
}

export interface CoachRequest {
  prompt: string;
  user_id: string;
  file_path?: string;
  mode?: CoachMode;          // default 'score'

  // Round-state inputs — required from round 2+ for progress tracking, and
  // from `mode: 'skip_reveal'` for rendering the strong-rewrite reveal.
  // Pass either the four fields below OR `round_token` (echoed verbatim
  // from the previous response's next_round_inputs.round_token).
  original_prompt?: string;
  original_dimensions?: DimensionScores;
  previous_dimensions?: DimensionScores;
  round?: number;            // 1-indexed; server clamps to [1, 5]
  round_token?: string;      // shorthand for the four fields above

  // Optional team-wiki context, same semantics as ScoreRequest.context_path.
  context_path?: string;
}

export interface CoachResponse {
  proceed: boolean;          // KEY FLAG — directive checks only this
  mode: CoachMode;
  overall: number;
  dimensions: DimensionScores;
  missing: MissingHints;
  text: string;              // fully rendered block to relay verbatim, may be ''

  // Populated when proceed=false. Echo the four fields back unchanged on the
  // next coach() call, with `prompt` set to original + user's reply.
  next_round_inputs?: CoachNextRoundInputs;

  // Existing augment-mode passthrough (kept for backwards compatibility with
  // the legacy `coach({ mode: 'augment' })` callers; not used in the new loop).
  augmented_prompt?: string;
  missing_dims?: string[];
}

// GET /teams — list every team in the database (name, token).
// Unauthenticated so the popup can populate a Select-team dropdown
// before any token is configured. Demo simplicity: no per-user
// permission filter (the user explicitly asked for "all teams").
//
// Token is the team's primary key (the value the client sends as
// X-Team-Token). There is no separate UUID id since the
// 2026-04-26 token-as-team-key refactor.
export interface TeamSummary {
  name: string;
  token: string;
}
export interface TeamsListResponse {
  teams: TeamSummary[];
}
