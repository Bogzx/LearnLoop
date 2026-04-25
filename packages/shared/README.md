# shared — TypeScript types for API contracts

Single source of truth for request/response shapes. Every artifact (api,
browser-ext, vscode-ext, mcp-server, stop-hook, dashboard) imports from
here. Prevents shape drift across parallel work — the most common 24h
hackathon integration disaster.

**Exports:**
- `Dimension` — 5-dim enum: `goal_clarity | specificity | context_loading
  | constraint_articulation | output_specification`
- `ScoreRequest`, `ScoreResponse` (per-dimension scores + missing hints)
- `CaptureRequest`, `CaptureResponse`
- `ContextResponse`, `ExamplesResponse`
- `DiffRequest`, `DiffResponse`
- `WikiProposeRequest`, `WikiProposeResponse`
  (`action: 'created' | 'reinforced' | 'promoted'`, `current_count: number`)

**Spec refs:** §3 (endpoint list), §5 (the 5 dimensions)
