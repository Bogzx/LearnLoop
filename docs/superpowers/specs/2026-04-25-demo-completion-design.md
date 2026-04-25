# Demo Completion — Design Spec

**Date:** 2026-04-25
**Companion to:** `2026-04-25-trailhead-design.md` (the master spec)
**Goal:** Ship the three remaining pieces the §13 demo storyboard depends on — full dashboard, always-on MCP coach, scaffolding for onboarding + outcome rating — without disturbing the deployed backend, MCP server, or VS Code extension.

---

## 1. Scope

Three additions, sized for ~12 hours of single-engineer work. Browser extension is out of scope (Person B's lane).

| | Scope | Time |
|---|---|---|
| **A — Full dashboard** | 4 Next.js pages on Vercel (home, skill-arc, team, wiki). Reads from existing API plus 3 new aggregate-read endpoints. | ~7.5h |
| **B — Always-on MCP coach** | 3 new `coach.*` MCP tools + system instruction in `CLAUDE.md` written by `bin/init.ts`. Instructs the host LLM to ask clarifying questions on weak prompts, with a 3-question cap and easy escape. | ~4h |
| **C — Scaffolding** | `POST /onboard/repo` 501 stub + typed shapes; VS Code outcome-rating skeleton file. No full implementation. | ~0.6h |

### What's already in place (no changes)

- Hono API on Railway (7 endpoints, all live)
- Postgres on Neon (6 tables, ~25 skill_observations seeded)
- MCP server with `wiki.*` tools deployed
- VS Code extension with sidebar webview
- Browser extension under active development by teammate
- Demo seed data (5 nodes, 7 learnings, 4 prompts, ~25 obs)

### What we're explicitly NOT doing

- Stop hook for learning extraction (skipped earlier per direction)
- Browser-ext changes (teammate's lane)
- Real auth, multi-tenancy (still hardcoded `TEAM_TOKEN`)
- Vector search (still SQL ILIKE)
- Full onboarding implementation (scaffolding only)
- Outcome-rating UI wiring (scaffolding only)
- Cross-team transfer, repo-sync mode, VPC deploy (slide-only)

---

## 2. Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│  NEW                                                    │
│  • apps/dashboard (Next.js 15 + Vercel)        ← A      │
│  • apps/mcp-server: 3 new coach.* tools        ← B      │
│  • apps/mcp-server: bin/init.ts auto-coach     ← B      │
│  • apps/api: 3 new GET aggregate endpoints     ← A      │
│  • apps/api: POST /onboard/repo (501 stub)     ← C      │
│  • apps/vscode-ext: outcome-rating.ts skeleton ← C      │
└─────────────────────────────────────────────────────────┘
                           │
                           │ existing Hono API (Railway)
                           ▼
┌─────────────────────────────────────────────────────────┐
│  apps/api + Postgres on Neon — both already live        │
└─────────────────────────────────────────────────────────┘
```

A and B share no code with each other. C is two tiny isolated additions. All three additions are purely additive — no rewrite of existing handlers, tools, or schema.

### Tech picks

| Choice | Pick | Why |
|---|---|---|
| Dashboard chart library | Recharts | smallest bundle, plays with shadcn/ui |
| Dashboard hosting | Vercel | matches master spec §16, free preview deploys |
| Dashboard data fetching | client-side fetch + SWR | live tick on `/skill-arc` requires revalidation; SWR is the simplest fit |
| MCP system-instruction location | `CLAUDE.md` (project-scoped + optional user-scoped) | this is where Claude Code loads instructions; `.claude/settings.json` is the wrong file |
| C scaffolding posture | 501 with `roadmap` field, typed shapes, TODO markers | future-self greps `TODO(onboard)` / `TODO(outcome)` to find every hook |

---

## 3. A — Dashboard

### 3.1 Pages

| Route | Purpose | Demo beat |
|---|---|---|
| `/` | Team selector card ("Acme Fintech"). Click → `/skill-arc`. | 0:30 |
| `/skill-arc` | Hero page. 5-dim line chart over time + "Live" indicator. SWR revalidates every 2s. | **2:50 — close** |
| `/team` | L1→L2 metric cards: avg overall over time, reuse rate, durable count, total observations. | supporting |
| `/wiki` | Node tree (indented by depth) → click expands `body_md` + durable learnings. | static §17 #5 reference |

### 3.2 New API endpoints (read-side aggregates the dashboard needs)

The existing API has writes and per-path reads. The dashboard needs aggregate reads:

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /skill-arc?user_id=demo&since=ISO` | `{ observations: [{dimension, score, ts}, ...] }` | demo-page critical — drives live tick |
| `GET /team/metrics` | `{ avg_overall, reuse_rate, durable_count, total_obs, active_users }` | snapshot, no time-series |
| `GET /wiki/tree` | `{ nodes: [{path, body_md, durable_learnings: [...]}, ...] }` sorted by path depth | full team wiki |

All three are simple `SELECT`s. Adds to `apps/api/src/index.ts` and `packages/shared/types.ts`. ~1h.

### 3.3 File layout

```
apps/dashboard/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                  ← / (team selector)
│   ├── skill-arc/page.tsx        ← /skill-arc (hero)
│   ├── team/page.tsx             ← /team
│   └── wiki/page.tsx             ← /wiki
├── components/
│   ├── ui/                       ← shadcn/ui (Card, Button, Badge, Skeleton)
│   ├── skill-arc-chart.tsx       ← Recharts LineChart, 5 series
│   ├── metric-card.tsx
│   ├── wiki-tree.tsx
│   └── live-indicator.tsx        ← pulsing dot + "Live"
├── lib/
│   ├── api.ts                    ← fetch + SWR helpers, X-Team-Token header
│   └── types.ts                  ← re-exports from @trailhead/shared
├── next.config.mjs
├── tailwind.config.ts
└── package.json
```

### 3.4 Data flow

- **Build-time env**: `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_TEAM_TOKEN`. Both end up in the client bundle (demo posture only — production would proxy via a server route to keep the token server-side)
- **Client-side fetcher**: thin SWR wrapper with `X-Team-Token` baked in
- **SWR config**: `/skill-arc` revalidates every **2s** during demo; other pages plain `fetch`. Tunable in one constant.
- **Loading state**: shadcn `Skeleton` placeholders so pages never blank-flash

### 3.5 Time budget

| Slice | Hours |
|---|---|
| Next.js scaffold + Tailwind + shadcn + Recharts | 0.5 |
| `/` home + layout + team-token plumbing | 0.5 |
| API: 3 new read endpoints | 1.0 |
| `/skill-arc` page with Recharts + SWR live tick | 1.5 |
| `/team` page with metric cards | 1.0 |
| `/wiki` page with tree + expandable nodes | 1.5 |
| Polish: live indicator, responsive, dark mode default | 1.0 |
| Vercel deploy + smoke-test against Railway API | 0.5 |
| **Total** | **~7.5h** |

### 3.6 Risks specific to A

1. **SWR live tick doesn't visibly move during demo** — `/score` writes 5 obs per call; demonstrator types 2-3 prompts → guaranteed jump on the chart. Verify before recording fallback.
2. **Vercel build fails on Windows path** — deploy from CI or run `npx vercel` once locally to lock project ID; CI build is Linux.
3. **Seed data too sparse for "real-looking" chart** — current ~25 obs may look thin. Expand seed to ~50 (master spec §11 target) when chart is wired.

---

## 4. B — Always-on MCP coach

### 4.1 The 3 new tools

| Tool | Args | Returns | Wraps |
|---|---|---|---|
| `coach.score` | `prompt: string, file_path?: string` | `{ overall, dimensions, missing, next_question }` | `POST /score` + lookup-table to phrase question for lowest-scoring dim |
| `coach.examples` | `file_path: string` | `{ items: [{template, topic, reuse_count, node_path}] }` | `GET /examples` (passthrough) |
| `coach.augment` | `prompt: string, file_path?: string` | `{ augmented_prompt: string, missing_dims: string[] }` | calls `coach.score` then `buildAugmentation()` from `packages/scoring/src/score-helpers.mjs` |

`next_question` lookup table (in MCP tool layer, no API change):

```
context_loading         → "Which file or function is this about?"
constraint_articulation → "What constraints apply? (max attempts, idempotency, side effects, etc.)"
output_specification    → "What output shape do you expect? (only the changed function, full file, etc.)"
goal_clarity            → "What outcome are you aiming for? Be concrete."
specificity             → "What exactly should change? Name the function, error, or behavior."
```

### 4.2 The system instruction (always-on directive)

Goes in `CLAUDE.md` at project scope, optionally also `~/.claude/CLAUDE.md` for user-scope. Locked wording:

```markdown
## Trailhead coaching — always on, never block

For every code-related request the user makes:

1. Call `coach.score` on the user's request first.
2. If overall ≥ 7, proceed normally. Do not mention coaching.
3. If overall < 7:
   a. Ask ONE focused clarifying question targeting the lowest-scoring
      dimension. Use the `next_question` hint from coach.score.
   b. Wait for the user's reply, then re-score (original + answer).
   c. Repeat up to 3 rounds OR until score ≥ 7.
4. STOP coaching immediately if the user says "skip", "as-is", "just do it",
   "no questions", or similar. Proceed with current prompt.
5. After coaching, prefix your answer with "(coached: X→Y)" then answer.

Never block: dismissed coaching = proceed with the original prompt.
```

The `(coached: X→Y)` prefix is the audience-visible tell during demo.

### 4.3 `bin/init.ts` upgrade

Already exists and writes `.mcp.json`. Add:

| Flag | Behavior |
|---|---|
| (default) | writes `.mcp.json` MCP registration **+** appends the directive block to `./CLAUDE.md` (creates if missing) |
| `--no-auto-coach` | only writes `.mcp.json` — coach tools available via slash command, not always-on |
| `--user-scope` | additionally writes the directive to `~/.claude/CLAUDE.md` for global behavior |

Idempotent: detects existing `## Trailhead coaching` block and skips.

### 4.4 Why MCP tools = skill-like

Claude Code surfaces MCP tools as `/mcp__<server>__<tool>` slash commands. Users get autocomplete just like `/help`. The same tools the LLM calls autonomously under the always-on directive are also user-invocable when the user wants to inspect a prompt manually. Two adoption modes for the same surface.

### 4.5 Time budget

| Slice | Hours |
|---|---|
| Add 3 `coach.*` tools to `tools.ts` + `api-client.ts` | 0.75 |
| Lock system-instruction wording | 0.5 |
| Upgrade `bin/init.ts` (`--no-auto-coach`, `--user-scope`, idempotency) | 0.75 |
| Smoke-test opt-in tools (slash command path) | 0.5 |
| Smoke-test always-on (CLAUDE.md path) | 1.0 |
| Tune directive (likely 1-2 iterations) | 0.5 |
| **Total** | **~4h** |

### 4.6 Risks specific to B

1. **LLM ignores the directive on some Claude Code version** — biggest single demo risk. Mitigation: pin Claude Code version on demo machine; test directive 5x in a row before recording fallback; `--no-auto-coach` fallback ready if always-on misbehaves day-of (slash-command path still works without the directive).
2. **"fix the retry" demo prompt scores ≥7 unexpectedly** — must reliably trigger coaching. Test 5x against Gemini before locking. If variance is high, lock prompt to a deterministic phrasing.
3. **Coaching loop annoys post-demo users** — 3-question cap, escape phrases, ≥7 zero-friction. Default-on for demo machine; default-off install option for v2.

---

## 5. C — Scaffolding

### C.1 — `POST /onboard/repo` (501 stub)

**File**: `apps/api/src/index.ts`
**Types**: `packages/shared/types.ts`

```ts
// shared types
export interface OnboardRepoRequest {
  paths: string[];                              // ['src/api/', 'src/db/', ...]
  initial_rules?: Record<string, string>;       // path → markdown body
}
export interface OnboardRepoResponse {
  nodes_created: number;
  nodes: Array<{ path: string; id: string }>;
}

// stub handler
app.post('/onboard/repo', async (c) => {
  return c.json({
    error: 'not_implemented',
    roadmap:
      'Bootstrap a team wiki by upserting nodes for each path and ' +
      'optionally seeding body_md from initial_rules. See ' +
      'docs/superpowers/specs/2026-04-25-demo-completion-design.md §C.1.',
  }, 501);
});
```

The 501 keeps the surface honest — clients hitting it get a clear "not implemented" rather than a fake success.

### C.2 — VS Code outcome-rating skeleton

**New file**: `apps/vscode-ext/src/outcome-rating.ts`

```ts
// TODO(outcome): wire into post-prompt webview message bus.
// Spec ref: 2026-04-25-demo-completion-design.md §C.2
//
// When user rates an outcome (helpful/mixed/not), POST /capture with the
// outcome field. The API + captures table already accept it; only the
// UI surface is scaffolding.
import type { CaptureRequest } from '@trailhead/shared';

export function buildCapturePayload(args: {
  user_prompt: string;
  ai_response?: string;
  file_path?: string;
  outcome: 'helpful' | 'mixed' | 'not';
}): CaptureRequest {
  return {
    surface: 'vscode',
    user_id: 'demo',
    user_prompt: args.user_prompt,
    ai_response: args.ai_response,
    file_path: args.file_path,
    outcome: args.outcome,
  };
}
```

Pure function, typechecks against shared types, not imported anywhere yet — ready for the post-demo wire-up.

### C.3 — Browser-ext integration note (no code change)

Teammate is in that workspace. Design integration point for them:

> Browser-ext outcome rating: after AI response renders, surface 3 buttons (helpful / mixed / not). On click, `POST /capture` with `outcome` set. Backend already accepts the field; the captures table already stores it. See §C.3 of this design doc when ready.

### C.4 — Time budget

| Slice | Hours |
|---|---|
| `OnboardRepo*` types in shared | 0.1 |
| `POST /onboard/repo` 501 handler in `apps/api/src/index.ts` | 0.2 |
| `apps/vscode-ext/src/outcome-rating.ts` skeleton | 0.2 |
| Design-doc note for browser-ext team | 0.1 |
| **Total** | **~0.6h** |

---

## 6. Demo integration

The §13 storyboard is unchanged in minutes. This work fills existing slots:

| Beat | Existing | Adds from this work |
|---|---|---|
| 0:30 — Sign in, dashboard appears | seeded charts | **A — actual dashboard exists**, all 4 pages clickable |
| 0:40-1:40 — Claude.ai score-card | teammate's browser-ext | (no change here) |
| 1:40-2:20 — VS Code with examples | sidebar shows team prompts | **B — demonstrator types in Claude Code terminal; Claude pauses, asks "Which file is the retry in?"; demonstrator answers; Claude prefixes response with `(coached: 4→7)`** — fits inside this window |
| 2:20-2:50 — Autonomous wiki update | MCP tool path | (no change — already works) |
| 2:50 — Close, skill arc ticks | dashboard close | **A — live tick is real**, SWR revalidates every 2s |

The new always-on coach beat extends the 1:40-2:20 VS Code window by ~15-20s (coaching round-trip vs single answer). To stay within the 3-minute total: compress the sidebar examples walkthrough at 1:40 (the static seed reads itself in 5-10s) so the saved time funds the coaching micro-moment. Net storyboard change: 0 minutes, with the coaching beat as a richer demonstration of the autonomous-AI story.

---

## 7. Cross-cutting risks

1. **Time blowout** — A (7.5h) + B (4h) + C scaffold (0.6h) = ~12h. Cut order if behind: drop C scaffold (negligible), trim `/wiki` page from A (saves ~1.5h), then trim `--user-scope` flag from B (saves ~0.5h). **Don't drop the always-on directive** — it's the demo beat.
2. **Three deploys must stay aligned** — Vercel (dashboard) → Railway (API) → npm/local (MCP server). One stale URL kills a beat. Lock `NEXT_PUBLIC_API_URL` + `TEAM_TOKEN` early; verify via curl before recording fallback.
3. **3 new API read endpoints could destabilize existing ones** — additive only. Smoke-test the 7 existing endpoints unchanged after the additions land.
4. **Live tick on `/skill-arc` doesn't visibly move during demo** — `/score` writes 5 obs per call; 2-3 prior prompts guarantee a jump. Verify on rehearsal.
5. **LLM ignores always-on directive on demo machine** — biggest single demo risk. Pin Claude Code version. Test 5x. `--no-auto-coach` fallback documented.

---

## 8. Definition of done

- [ ] Dashboard deployed on Vercel; all 4 pages render against Railway API
- [ ] `/skill-arc` revalidates every 2s; live observations from demo prompts visible
- [ ] 3 new GET endpoints (`/skill-arc`, `/team/metrics`, `/wiki/tree`) return real data
- [ ] `coach.score`, `coach.examples`, `coach.augment` MCP tools callable via `/mcp__trailhead__*`
- [ ] Always-on directive in `CLAUDE.md` triggers clarifying questions on weak prompts
- [ ] "fix the retry" reliably scores <7 across 5 test runs → coaching beat triggers
- [ ] User saying "skip" / "as-is" exits coaching, Claude proceeds with original
- [ ] `POST /onboard/repo` returns 501 with roadmap message
- [ ] `apps/vscode-ext/src/outcome-rating.ts` exists and typechecks
- [ ] §13 demo runs end-to-end 3 times in a row on the demo machine
- [ ] Fallback recording captures both the live-tick close AND the always-on coach beat

---

## 9. Open implementation questions

These need a decision when implementing, not before:

1. **Recharts theme** — match shadcn/ui dark mode by default? Pick at scaffold time.
2. **`/skill-arc` chart shape** — single chart with 5 series vs 5 stacked sparklines? Pick after a quick sketch in dev. Single chart with 5 series is the default; stacked sparklines if 5 series clutter the demo screen.
3. **`coach.score` next_question hardcoding vs LLM-generated** — locked to hardcoded lookup table for v1 (deterministic, fast, no extra LLM call). LLM-generated questions are a v2 polish.
4. **`bin/init.ts` overwrite vs append behavior on existing CLAUDE.md** — append + idempotent (skip if `## Trailhead coaching` block already present). Never overwrite user content.
5. **Browser-ext outcome integration** — design doc has the note. Teammate decides when to wire it. No coordination required pre-demo.
