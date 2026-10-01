# scoring — prompt templates and pure helpers

Locked prompts and the pure functions around them, versioned in one place so
`apps/api`, `apps/mcp-server` and the browser extension use the same wording.
System prompts stay byte-stable across calls so the prompt cache hits.

Runtime code is plain ESM (`.mjs`, no build step) with a `.d.mts` declaration
next to each file; `declarations-match.test.mjs` fails if the two drift.

| File | What it holds |
|---|---|
| `score-prompt.mjs` | The 5-dimension scorer's system prompt (the rubric) |
| `score-helpers.mjs` | `buildScoreUserPrompt`, `buildAugmentation` ("have Claude clarify") |
| `teach-prompt.mjs` | System prompt for the coaching rewrite (`/coach`) |
| `teach-templates.mjs` | Per-dimension teach text: title, definition, why, question |
| `reveal-render.mjs` | Renderers for the teach / success / skip blocks `/coach` returns |
| `topic-prompt.mjs` | Topic classifier prompt (`/diff` finds a team prompt on the same topic) |
| `fence.mjs` | `fenceUntrusted`: wraps team-authored text before it reaches an LLM |
| `normalize.mjs` | Text normalisation behind wiki dedup |
| `path-helpers.mjs` | `normalizePath`, `ancestorPaths` |
| `models.mjs` | Model id per call site (single source of truth) |

**Spec refs:** §5 (scoring prompt template), §18 (which prompts are locked).
