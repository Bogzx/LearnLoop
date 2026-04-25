# Trailhead — Design Spec (24-hour Hackathon Build)

**Date:** 2026-04-25
**Constraint:** Build + deploy in 24 hours
**Goal:** Win PoliHack "AI Adoption for Engineers" by shipping a prompt coach that drives the L1→L2 transition for software teams. Simple to build, tech-impressive on stage.

---

## 1. Product framing

**Headline:** *Trailhead is a prompt-skill coach that uses your team's actual work as the curriculum. The team wiki is the engine that keeps the curriculum fresh, automatically.*

**Adoption target:** L1 → L2 (individual prompting → team-systematized prompting). The brief calls this the hardest transition.

**The behavioral diagnosis:** Engineers can't get better at prompting because they've literally never seen anyone else's prompts, and they've never been told what makes a prompt strong. Trailhead makes the rubric visible to every engineer, every send.

**Brief alignment:**
- Behavior change is the product; AI is infrastructure.
- KPI is per-engineer skill progression + team-level reuse rate (behavioral metrics).
- Passive intervention beats training content.
- L1→L2 is the unsolved gap; the brief explicitly endorses targeting it.

---

## 2. The 24-hour scope — what ships live

### Must work live (the demo headline)

1. **Browser extension on Claude.ai** with a **live score-card + opt-in augmentation**
   - Live-scores the user's draft prompt as they type (250ms debounce → `/score`)
   - Renders a 5-dimension score-card under the textarea showing per-dimension scores and the missing dimensions in plain English
   - On send: if score ≥ 7, no friction (native send fires); if score < 7, a 5-second nudge offers "Have Claude clarify" augmentation, then auto-sends as-is if the user does nothing
   - Every send writes a real `skill_observation` row — the skill arc on the dashboard is driven by real data, not seeds
   - This is the visceral cross-platform "wow" moment
2. **VS Code extension** with the same score-card in a sidebar webview, plus the team-anchored example prompts and the Cmd+Shift+K articulation scaffold
3. **Backend (Hono on Railway)** that scores prompts on 5 dimensions, retrieves team examples by tree-walk, captures sessions, and writes skill_observations on every score
4. **MCP server** — autonomous wiki update via the MCP tool `wiki.update_learnings`. Claude Code calls it explicitly when it notices a learning the user wants captured. Server-side dedup on `(node_id, body_normalized)` makes repeated calls for the same insight reinforce one draft instead of duplicating it. For the demo, Claude Code runs in VS Code's integrated terminal so both surfaces are visible in one window.
5. **Web dashboard** with skill arc + L1→L2 metrics view — base layer is seeded data (~50 skill_observations from §11), with real `/score` writes from the demonstrator's prompts during the live demo layered on top so the closing tick is visibly real

### Cuts in priority order (cut first if behind)

1. Articulation scaffold (Cmd+Shift+K) — the score-card in browser is the headline anyway
2. Outcome rating widget — hand-wave in demo
3. Team-anchored examples in VS Code sidebar — show as a static seed if behind
4. Team L1→L2 dashboard — keep as mostly-seeded with real /score writes layered in
5. Multi-tenant — single hardcoded demo team
6. Real auth — "demo user" button
7. Sign-up flow — bypass; pre-existing demo account

### Explicitly NOT in scope (slide-only, mention as roadmap)

- Cross-team pattern transfer (Business tier)
- Repo-sync mode
- Enterprise VPC deploy
- Slack/CLI/browser-on-other-providers (only Claude.ai live)
- Cold-start GitHub App scan

---

## 3. Architecture

### Components

```
┌────────────────────────────────────────────────────┐
│  THIN CLIENTS                                      │
│   Browser ext (Plasmo, Claude.ai)                  │
│   VS Code extension (TypeScript)                   │
│   MCP server (standalone, for Claude Code/Desktop) │
│   Web dashboard (Next.js)                          │
└────────────────────┬───────────────────────────────┘
                     │ HTTPS, single hardcoded team token
                     ▼
┌────────────────────────────────────────────────────┐
│  Hono API (Railway)                                │
│   POST /score          — 5-dim score on prompt;    │
│                          writes skill_observation  │
│   POST /capture        — store conversation        │
│   GET  /context?path=  — HCL bundle (path-walked)  │
│   GET  /examples?path= — team-anchored prompts     │
│   POST /diff           — generate Prompt Diff      │
│   POST /wiki/propose   — MCP-driven autonomous     │
│                          wiki update (with dedup)  │
└────────────────────┬───────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────┐
│  Postgres (Neon) — sole source of truth            │
│   No git, no R2, no vector DB, no Redis.           │
│   Markdown lives in TEXT columns.                  │
│   Single Postgres = simplest possible deployment.  │
└────────────────────────────────────────────────────┘
```

### Storage decisions (deliberately minimal)

| Decision | Choice | Why |
|----------|--------|-----|
| Wiki source of truth | Postgres TEXT columns | One service. No git. No R2. |
| Hierarchy | `nodes.path` column ('src/api/auth/') + sort by depth | No `edges` table needed for hackathon |
| Versioning | `revisions` table (append-only) | If we have time; otherwise skip |
| Vector search | None — drop pgvector entirely | Path-walk + LLM ranking covers all retrieval needs at hackathon scale |
| Reinforcement dedup | Exact-match after normalization (lowercase, strip punctuation) | Embedding similarity is overkill for demo |
| Async worker | None — wiki updates ride the MCP tool's request path | No NOTIFY/LISTEN, no queue; one HTTP POST per learning |
| Concurrency | Optimistic on `nodes.updated_at` | Real production concern, simple to add |
| Auth | Hardcoded team token in extension manifest | Demo only; sketches real Clerk integration in slides |

---

## 4. Schema (Postgres, hackathon-minimal)

```sql
-- Tenancy
CREATE TABLE teams (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL
);

-- Wiki tree (one row per folder/path)
CREATE TABLE nodes (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id),
  path TEXT NOT NULL,                    -- e.g., 'src/api/auth/'
  body_md TEXT NOT NULL DEFAULT '',      -- the node.md content (rules, summaries)
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team_id, path)
);
CREATE INDEX idx_nodes_team_path ON nodes(team_id, path);

-- Accumulated learnings (the "AI-managed" content)
CREATE TABLE learnings (
  id UUID PRIMARY KEY,
  node_id UUID NOT NULL REFERENCES nodes(id),
  body TEXT NOT NULL,                    -- the prose insight
  body_normalized TEXT NOT NULL,         -- lowercase, stripped — for dedup
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | durable
  reinforcement_count INT NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_learnings_node_status ON learnings(node_id, status);
CREATE INDEX idx_learnings_node_normalized ON learnings(node_id, body_normalized);

-- Graduated prompt templates (the curriculum)
CREATE TABLE prompts (
  id UUID PRIMARY KEY,
  node_id UUID NOT NULL REFERENCES nodes(id),
  template TEXT NOT NULL,                -- the prompt itself
  topic TEXT,                            -- e.g., 'retry', 'auth', 'webhook'
  reuse_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'graduated', -- for hackathon, just 'graduated'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_prompts_node_topic ON prompts(node_id, topic);

-- Captured sessions
CREATE TABLE captures (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id),
  surface TEXT NOT NULL,                 -- 'browser' | 'vscode' | 'mcp'
  user_prompt TEXT NOT NULL,
  ai_response TEXT,
  file_path TEXT,                        -- path context if known
  outcome TEXT,                          -- 'helpful' | 'mixed' | 'not'
  scored_dimensions JSONB,               -- {goal_clarity: 8, specificity: 4, ...}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Skill arc data — driven by real /score writes (every browser/VS Code prompt)
CREATE TABLE skill_observations (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id),
  user_id TEXT NOT NULL,                 -- placeholder; no real users for demo
  dimension TEXT NOT NULL,               -- 'goal_clarity' | 'specificity' | 'context_loading' | 'constraint_articulation' | 'output_specification'
  score INT NOT NULL,
  ts TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_skill_obs_team_dim_ts ON skill_observations(team_id, dimension, ts);
```

That's six tables. Implementable in ~1 hour by one engineer. The `events` table from an earlier draft is dropped — wiki updates ride the MCP tool's request path, so no NOTIFY/LISTEN worker is needed.

---

## 5. The five prompt-quality dimensions (the rubric Gemini Flash scores against)

| Dimension | Lazy → Skilled |
|-----------|----------------|
| **goal_clarity** | "make this better" → "reduce p99 latency to 200ms" |
| **specificity** | "add error handling" → "wrap fetch in try/catch, log via logger.ts, return 500" |
| **context_loading** | (none) → references file, convention, related code |
| **constraint_articulation** | (none) → "must remain idempotent; no public API change" |
| **output_specification** | (none) → "return only the modified function, no explanation" |

**Why five and not seven.** Earlier drafts listed seven dimensions including `decomposition` (one prompt for many things vs. one per task) and `iteration_mode` (one-shot vs. small steps). Both require **session-level history** to score — a single-prompt scorer cannot evaluate them. Five teachable dimensions are sharper on a slide, produce a smaller scoring prompt that fits Gemini's structured-output schema cleanly, and never give the user a score for something we can't actually measure.

**Scoring prompt for Gemini Flash (template):**

```
You are a prompt-quality scorer. Given a developer's draft prompt, return a JSON
object scoring it 0-10 on each of these five dimensions:
- goal_clarity, specificity, context_loading, constraint_articulation,
  output_specification

For dimensions scoring below 5, also return a brief "missing" hint
(e.g., "no file path mentioned" for context_loading=2).

Return only JSON. No prose.

Prompt: <user prompt>
File context: <file path if known>
```

Cost: ~400 input + ~120 output tokens. Gemini 2.5 Flash on the free tier covers the demo at zero cost; on paid tier ≈ $0.0001 per scoring. With 250ms debounce on typing, ~5–10 scoring calls per real prompt session. We use Gemini's `responseSchema` to enforce the JSON shape — the score-card code parses without defensive try/catches because the schema guarantees the dimensions object exists.

---

## 6. Socratic Mode — the score-card with opt-in augmentation

The browser extension's job is twofold: **show the user what their prompt is missing** (the pedagogy), and **offer a frictionless path to a better answer when the user wants one** (the accelerator). The score is the coaching; the augmentation is the bonus.

### What the user sees on Claude.ai

User types in the textarea. Browser extension calls `POST /score` with a 250ms typing debounce. A small unobtrusive card appears *below* the textarea (not modal), updating live:

```
Score: 4/10  ⓘ
  ✓ goal_clarity        8
  ✓ specificity         6
  ✗ context_loading     2  — no file or function referenced
  ✗ constraints         1  — no constraints stated
  ✗ output_spec         3  — no return shape requested

[ Send as-is ]   [ Have Claude clarify (auto-improve) ]
```

The card is passive while the user types — score updates live, no popups, no interruption.

### Send-time behavior (the never-block rule)

| User's score | What happens on send |
|---|---|
| **≥ 7** | Extension does nothing. Native send fires. No card highlight, no augmentation, no friction. |
| **< 7** | Extension `preventDefault`s the submit for **5 seconds**. Card pulses with copy: *"Send as-is or have Claude clarify?"* If the user does nothing, the send goes through unchanged after 5 seconds. **We never block the user.** |

Both buttons (and the auto-send fallback) write a `skill_observation` row tagged with the per-dimension scores. Skill arc is driven by real data.

### When the user clicks "Have Claude clarify"

The extension replaces the textarea content with the augmented prompt:

```
fix the retry

---
[Trailhead coaching: This prompt is missing context_loading and
constraint_articulation. Before answering, please ask the user 2-3
clarifying questions:
- Which file/folder is the retry in?
- What library or helper is currently used (e.g. utils/retry.ts)?
- What constraints apply (max attempts, idempotency, jitter)?
Only proceed once these are clarified.]
```

User clicks send. Claude receives the augmented prompt, asks the questions, user answers, Claude gives a much better answer using the team's wiki context.

### Why this shape is right (vs. earlier "subliminal" version)

- **Pedagogy is the score**, not the augmentation. The user explicitly sees their gaps and the names of the dimensions.
- **Live scoring as the user types** creates a feedback loop *inside the prompt itself*. Users iterate to climb the score before sending — that is L1→L2 rendered as a UI.
- **High-skill users see zero friction** (score ≥ 7 → no card highlight). The coach earns the right to coach by being passive.
- **The augmentation becomes the accelerator**, not the teacher. Its existence stops contradicting the brief's behavior-change criterion.
- **Closes the dashboard continuity hole**: every send writes a `skill_observation`; the skill arc tick at the end of the demo is real, not seeded.

### Per-provider note

Hackathon ships **Claude.ai only**. Other browsers (ChatGPT, Gemini) become a slide line: "we deliver coaching wherever your team prompts; here's the proof on Claude.ai today, and the architecture extends to every other surface."

---

## 7. VS Code extension + MCP server

### Two components, two jobs

The IDE-side coaching is split because VS Code's built-in chat APIs are limited and we don't want to fight them:

**(A) VS Code extension** — the visible coaching UI:
- **Score-card in a sidebar webview** — same UI as the browser extension. User can compose prompts here, get live scores, then copy or send to Claude Code via a one-keystroke command.
- **Pre-prompt panel** showing 2-3 team-anchored example prompts when the user opens a file. Source: tree-walk on `prompts.node_id` matching ancestor paths.
- **Articulation scaffold** (Cmd+Shift+K) — the 3-field thinking helper that produces a structured prompt; results land in the score-card webview.
- **Post-prompt outcome rating** widget (one keystroke).
- **Wiki update notifications** — the sidebar polls `/wiki/recent` and shows a toast + updates its wiki view when a learning is created, reinforced, or promoted. This is what makes the autonomous demo moment audience-visible.

**(B) MCP server (standalone Node binary)** — the autonomous-write path that any MCP client can connect to:
- **Claude Code** (running in VS Code's integrated terminal — primary demo target)
- **Claude Desktop** (separate window — alternative)
- **Continue / Cline** (if user has them — bonus reach)

Configuration: user adds the MCP server to their `.mcp.json` or Claude Code config. Once registered, the AI in any of those clients sees and can call our tools.

### MCP tools (minimal surface for demo)

```
wiki.context_for(file_path)
  → returns layered node.md + learnings stack for the file's path

wiki.update_learnings(node_path, insight)
  → POST /wiki/propose
  → backend: normalize insight (lowercase, strip punctuation)
  → exact-match dedup against existing on (node_id, body_normalized);
    if new, create draft;
    if matches, increment reinforcement_count;
    if count >= 3, promote status to 'durable'
  → returns: { action: 'created' | 'reinforced' | 'promoted', current_count }

wiki.search(query, scope)
  → simple SQL ILIKE for hackathon (no vector search)

wiki.rules_for(file_path)
  → returns active rules from ancestor nodes
```

Installation: `npx trailhead-mcp init` writes the MCP server registration to `~/.claude.json` and (by default) appends the always-on coach directive to `./CLAUDE.md`.

### The autonomous demo moment

VS Code is open. Integrated terminal at the bottom runs Claude Code with our MCP server registered. User says to Claude Code:

> *"actually we always use exponential backoff with jitter here, that's our convention."*

Claude Code calls `wiki.update_learnings`, and `/wiki/propose` returns:

```
{ action: "reinforced", current_count: 3, promoted_to_durable: true }
```

**The visible artifact for the audience is our VS Code sidebar**, which polls `/wiki/recent` and surfaces a toast: *"Wiki updated: exponential backoff with jitter — reinforced 3/3, promoted to durable."* The wiki view in the sidebar refreshes and the new durable learning appears in the list. Claude Code additionally shows the tool call in its terminal response — bonus drama. The audience sees both the IDE (with our extension's sidebar) and the terminal (with Claude Code) in one VS Code window.

---

## 8. Hierarchical Context Loading (HCL) — no recursive CTE needed

Since the hackathon stays simple, HCL is just: get all `nodes` whose path is a prefix of the target file path, ordered by path length.

```sql
SELECT path, body_md
FROM nodes
WHERE team_id = $1
  AND $2 LIKE path || '%'    -- ancestor of target path
ORDER BY length(path);
```

Concatenate `body_md` in order, prepend durable learnings from each ancestor. Done.

For the 24-hour build this is one query. No Redis, no caching, no recursion. Sub-100ms is trivial at demo scale.

---

## 9. Why we don't need a separate reinforcement worker

Earlier drafts of this spec proposed an optional Postgres NOTIFY/LISTEN worker that would: listen for capture events, call an LLM to extract candidate learnings, post to `/wiki/propose`. That worker is **not built** for the hackathon:

- **Claude Code path**: the MCP tool `wiki.update_learnings` fires inline when the model decides to capture a learning. No queue, no worker, no NOTIFY/LISTEN.
- **Browser extension path**: extension does NOT trigger learning extraction (it just writes captures and skill_observations). The wiki updates happen visibly in Claude Code via the MCP tool. That's fine for the demo.

Net effect: one less moving part, one less deployment, and the demo's autonomy story is straightforward — Claude Code makes the call, the user sees it.

---

## 10. The Prompt Diff (post-prompt feature)

After the user gets an answer:
1. Mark the prompt with outcome (`POST /capture` includes `outcome` field if rated)
2. On user click "show team comparison":
   - Backend: fetch the closest matching graduated `prompt` (by topic + path proximity, ranked by Gemini Flash if multiple candidates)
   - Run the user's prompt + the graduated prompt through scoring
   - Render side-by-side diff highlighting which dimensions the user missed

For the hackathon, the "closest match" can be deterministic: find prompts in the same `node.path` ancestry with matching `topic` (extracted from the user prompt via Gemini Flash in one call, with `responseSchema` enforcing the topic enum).

The diff renders both the per-dimension scores and the prose differences side by side: e.g., *"yours: 5/10 on context_loading; team-skilled: 9/10 on context_loading — they referenced `utils/retry.ts` and the team's idempotency invariant."* Same rubric as the score-card; same five dimensions.

---

## 11. Demo seeding (the plausibility moat)

This is **the most important pre-demo task**. Without realistic seed data, the curriculum is empty and nothing surfaces. Allocate 3 dedicated hours.

Seed plan:
- One demo team: "Acme Fintech"
- One demo repo structure (in our DB only, no actual git): `src/api/`, `src/api/auth/`, `src/api/webhooks/`, `src/db/`, `src/utils/`
- ~5 nodes with `body_md` (rules and conventions for each path)
- ~15 learnings, mix of durable (reinforcement_count >= 3) and draft
- ~8 graduated prompts on common topics (retry, auth, webhook, db migration, error handling)
- ~30 captures (recent prompts from "team members") with outcomes
- ~50 skill_observations to make the skill arc chart look real before the demo even runs

Hand-craft these to be plausible and to hit the demo flow. Real `/score` writes from the demonstrator's prompts during the live demo will layer on top of the seeded observations — the skill arc tick at the close is real.

---

## 12. Build sequencing for a 4-person team

| Hours | Person A (frontend) | Person B (browser ext) | Person C (VS Code ext + MCP) | Person D (backend) |
|-------|---------------------|------------------------|--------------------------------|---------------------|
| 0–2 | Next.js scaffold, Tailwind, dashboard skeleton | Plasmo scaffold, manifest for Claude.ai | VS Code extension scaffold + sidebar webview; standalone MCP server scaffold | Hono + Postgres schema (six tables, no events) + deploy to Railway |
| 2–6 | Dashboard pages (skill arc, team metrics, wiki view) — read from skill_observations | DOM hooks: detect input, **smoke-test on the pinned demo browser version**, intercept send, render score-card UI | Pre-prompt sidebar pulling `/examples?path=`; score-card webview identical to browser | `/score` (5 dimensions) writes skill_observation inline; `/capture`, `/context`, `/examples` + Gemini integration |
| 6–10 | Polish dashboard, add the wiki tree view | Implement live debounced `/score` call (250ms); threshold logic (≥7/<7); "Have Claude clarify" augmentation | MCP server tools (`wiki.update_learnings`, `wiki.context_for`, `wiki.search`); test against Claude Code | `/wiki/propose` + normalize+dedup + counter promotion |
| 10–14 | Wire dashboard to live skill_observations; L1→L2 progression chart | Polish UX, edge cases (multi-line prompts, paste events); **fail-open if /score 500s** | Post-prompt outcome widget + Prompt Diff display; sidebar wiki-update toast (polling `/wiki/recent`); `npx trailhead-mcp init` install script; *(if time)* articulation scaffold Cmd+Shift+K | Demo seeding scripts; populate Acme Fintech data; per-(user, dimension, prompt-hash) 30s dedup on skill_observation writes |
| 14–18 | All-hands: demo seeding, polish | Test demo flow end-to-end on Claude.ai (PIN BROWSER, RECORD INITIAL FALLBACK) | Test demo flow in VS Code + Claude Code with MCP registered; rehearse the trigger phrase | Validate all data renders correctly |
| 18–22 | All-hands: bug fixes, fallback recordings refreshed | All-hands: rehearse demo 3+ times | All-hands: prepare slides | All-hands: stress-test |
| 22–24 | Final polish, last bug fixes, final rehearsal | | | |

### If team is smaller (1–2 people)

Cut to:
- Browser ext only (the headline) + minimal backend with `/score`
- Skip VS Code extension entirely
- Skip MCP server entirely (mention as "v2")
- Dashboard is a single static page with seeded data
- Demo is browser-only — still very compelling because the score-card alone tells the L1→L2 story

This is doable solo in 24h.

---

## 13. Demo storyboard (3 minutes)

**0:00 — Hook (30s)** — *"Engineers have been prompting AI for two years and almost none have gotten better at it. Because they've literally never seen the rubric for a good prompt. We turn prompting from invisible solo work into visible, scored team craft, with your team's actual work as the curriculum."*

**0:30 — Sign in (10s)** — Open trailhead.dev, click "Demo team: Acme Fintech," dashboard appears with seeded skill arcs and metrics.

**0:40 — Live score-card + Socratic Mode (60s)** —
Open Claude.ai. Type *"fix the retry"*. Score-card appears live below the textarea: **3/10** with red rows: context_loading (2), constraints (1), output_spec (3); green row: goal_clarity (8). Demonstrator narrates: *"the AI doesn't know which retry, what constraints, or what shape of answer to give back. The user has never seen this rubric before — now they have."*

Iterate the prompt to *"in src/api/webhooks/handler.ts, fix the retry"*. Score climbs to **6/10**. *"Just adding the file reference moved them up two dimensions. They're learning the rubric in real time."*

Click "Have Claude clarify." Augmented prompt sends. Claude responds asking 2 clarifying questions. Demonstrator answers them. Claude gives a perfect answer using the team's actual retry pattern. *"L1→L2 in 60 seconds. The user saw their gaps, learned the rubric, improved the prompt, got a better answer. **That's behavior change.**"*

**1:40 — VS Code with team-anchored examples (40s)** — Open VS Code on the pre-seeded Acme Fintech repo. Click into `src/api/webhooks/handler.ts`. Trailhead sidebar shows: *"Your team has 3 graduated prompts for webhook patterns. Most-reinforced: idempotent retry with backoff."* Demonstrator opens the integrated terminal, runs Claude Code, asks for a fix using the team's pattern, gets a team-aware answer.

**2:20 — The autonomous wiki update (30s)** — Still in VS Code, with Claude Code in the integrated terminal. Demonstrator says: *"actually we always use exponential backoff with jitter here, that's our convention."* Claude Code calls `wiki.update_learnings`, and the MCP server reports: *"This insight matches a draft from yesterday — reinforcing. Counter: 3/3 → promoted to durable."* Cut to the sidebar — the new durable learning appears. *"This is how the team brain grows itself. No one had to remember to write it down."*

**2:50 — Close (10s)** — Cut back to dashboard. Skill arc visibly ticks up — driven by the real `/score` writes from the demonstrator's prompts in the last 2 minutes. *"We didn't build another AI tool. We built the coach that turns your team's work into a curriculum, makes prompting visible without surveillance, and proves L1→L2 progression with real metrics."*

---

## 14. Mentor pitch — 7 sentences

> Engineers have been prompting AI for two years and almost none have gotten better at it — because they've literally never seen the rubric for a strong prompt. That's the L1→L2 gap the brief calls the hardest unsolved transition. Trailhead is a coach that develops prompting craft using your team's actual work as the curriculum — not abstract advice from a blog. When you draft a prompt, we live-score it on five measurable dimensions and show you what's missing; when you're done, we show you a Prompt Diff against your team's skilled version so you can see exactly which dimensions you missed. The team's curriculum grows itself from real reuse, maintained by Claude Code mid-conversation through an MCP tool, so it never goes stale like every CLAUDE.md before it. Our KPIs are per-engineer skill progression and team-level reuse rate — behavioral metrics, not engineering ones. The brief literally says we don't even need to use AI to win as long as we drive adoption; our scoring rubric is concrete enough that a human reviewer could apply it — we use Gemini Flash because it's faster, not because it's the product.

---

## 15. Mentor defenses

**"Isn't this AI engineering with adoption framing?"**
> *"The product is a behavioral coach. KPI is per-engineer skill progression across five measurable dimensions plus team-level reuse rate. Both are behavioral metrics. Swap any LLM out — the loop runs identically. The brief says we don't need to use AI to win as long as we drive adoption; our rubric is concrete enough that a human reviewer could apply it. Gemini Flash is the implementation; the rubric is the product. We could swap to GPT-4o-mini, Haiku, Llama, or rule out LLMs entirely and the architecture is unchanged."*

**"How is the score-card different from a system prompt that says 'always ask clarifying questions'?"**
> *"A system prompt makes the AI act differently. We make the engineer think differently. The score-card is a measurement tool the user sees — they leave knowing their prompt scored 4 out of 10 on context_loading. Next time they prompt anywhere — even without our extension — they remember. That is L1→L2."*

**"Won't users just dismiss the score-card?"**
> *"Score-card never blocks send. Score ≥ 7 → it doesn't even highlight. Power users see zero friction. We earn the right to coach by being passive about it, and the user controls the threshold. The default mode is invisible to anyone who is already prompting well."*

**"Copilot does this configured well."**
> *"Copilot's instructions file is static reference and dies in 8 weeks because someone has to maintain it. We're a coach that develops the engineer, not just the AI. The configuration-decay problem that kills every `copilot-instructions.md` and `.cursorrules` — we own that loop structurally through the reinforcement counter and the MCP tool that updates the wiki mid-conversation."*

**"Why won't engineers ignore the coach?"**
> *"Coaching surfaces are passive and respect flow. The score-card never highlights when you're already prompting well. The VS Code pre-prompt nudge is a glance, not a form. Skill arc is your private trajectory. We never interrupt and never judge — that's why it survives."*

**"What's your moat against the model vendors (Google / Anthropic / OpenAI) shipping this?"**
> *"Three things they probably won't do. One: portable model-agnostic curriculum — your team's wiki works against any LLM (we're on Gemini today; the loop runs identically on Haiku or GPT-4o-mini). Two: team consensus via reinforcement counters; their memory is per-user. Three: cross-team transfer is a network-effect product no model vendor will build because it doesn't sell more inference."*

**"Privacy?"**
> *"Code never leaves the user's repo unless they explicitly attach it. The prompt content does — but we acknowledge prompts often contain code (snippets, stack traces, function bodies). That's why Enterprise tier scores locally with no cloud round-trip and stores the wiki in the customer's VPC. Hackathon is cloud-stored. No conversation logs anywhere — we capture distilled learnings, not transcripts. There's no surveillance vector because there's no log to surveil."*

**"How does an enterprise install this — does every dev edit a JSON file?"**
> *"For the hackathon, yes — `npx trailhead-mcp init` writes the `~/.claude.json` MCP entry and (by default) the always-on coach directive in `./CLAUDE.md`. For production we ship a one-click installer for VS Code and a CLI for headless environments. The install path is engineering-friendly, not user-hostile."*

---

## 16. Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Backend API | Hono on Railway | Fast, edge-deployable, simple |
| Database | Postgres on Neon | Free tier, fast cold start, single service |
| Web frontend | Next.js 15 + Tailwind + shadcn/ui | Fastest dashboard build |
| Browser extension | Plasmo (TypeScript) | Best-in-class extension framework |
| VS Code extension | TypeScript + VSCode API + WebView for sidebar | Standard; works alongside any AI chat in VS Code |
| MCP server | Node + TypeScript, MCP SDK | Standalone binary; user registers in `.mcp.json` for Claude Code / Claude Desktop |
| Demo AI in VS Code | Claude Code (CLI in integrated terminal) | Best MCP support; visible alongside our extension in one window |
| Coach scoring | Gemini 2.5 Flash with `responseSchema` JSON mode and `thinkingBudget=0` | ~1s, schema-enforced output, free tier covers demo |
| Topic extraction (`/diff`) | Gemini 2.5 Flash with enum-constrained `responseSchema` | Single round-trip, deterministic shape |
| Prompt Diff narrative | Gemini 2.5 Flash | Originally Gemma 4 31B for richer narrative; flipped to Flash because compounding 4 LLM calls put `/diff` over budget on free-tier quotas. Single-line constant in `packages/scoring/models.ts` to swap back when paid quota lands. |
| LLM provider | Google AI Studio (Gemini API) | Single env var `GEMINI_API_KEY`. Both providers wired so swapping models is a one-line change in `packages/scoring/models.ts`. |
| Auth | Hardcoded team token (hackathon) → Clerk (post) | Simplest possible |

**Total infrastructure for the hackathon:**
- 1 Postgres instance (Neon free tier)
- 1 Railway service (Hono API)
- 1 Vercel deployment (Next.js dashboard)
- 1 browser extension (Plasmo dev build, side-loaded into Chrome)
- 1 VS Code extension (sideloaded VSIX)
- 1 standalone MCP server binary (registered via `npx trailhead-mcp init`)

Five artifacts. Each is a single service or single file with no internal complexity. The MCP server and VS Code extension share a TypeScript codebase but ship as separate artifacts.

---

## 17. Why this is tech-impressive

For mentors / judges who want technical depth, the impressive elements are:

1. **MCP integration with autonomous tool calls** — the AI itself updates the wiki mid-conversation by calling `wiki.update_learnings`. Most hackathon teams won't ship working MCP at all.
2. **Browser extension that scores prompts live on Claude.ai with a 5-dimension rubric** — every keystroke gets graded in real time, and the user sees what they're missing in plain English. Few hackathon teams will have built one.
3. **Real prompt scoring with Gemini 2.5 Flash at 250ms debounce** — running an LLM on every typed sentence with `responseSchema` JSON-mode enforcement is non-trivial; we make it cheap (free tier covers the demo) and never block the user.
4. **Cross-platform reach demonstrated live** — browser + IDE both working in the same demo proves the architecture, not just the slide.
5. **The Karpathy-flavored file-tree wiki with no vector DB** — the LLM navigates the wiki cognitively, not via vector math. Pitchable as "LLM OS for engineering teams."
6. **Reinforcement-counter mechanic with normalized exact-match dedup** — patterns earn their place in the durable wiki via consensus, not admin decree. Defensible as research-aligned (matches Zep/Graphiti's evolving-facts model).

What we deliberately don't show off (because they're commodity):
- No vector DBs (we don't need them)
- No microservices
- No fancy auth (Clerk is fine)
- No exotic infra

The impressiveness is **what we built and why**, not how many services we deployed.

---

## 18. Open implementation questions

These need a decision before/during the build, not after:

1. **The Gemini Flash scoring prompt template (5 dimensions)** — needs careful crafting and few-shot examples. Lock in hour 4 so backend can use it. The `responseSchema` carries the shape; the system prompt carries the rubric.
2. **The Socratic Mode augmentation template** — what exact text to inject when user opts into "Have Claude clarify". Tested with Claude to make sure it complies. Lock by hour 6.
3. **The MCP `wiki.update_learnings` tool description** — Claude Code reads it to decide when to fire. Too eager = wiki spam; too cautious = miss the demo moment. Lock by hour 6.
4. **The topic-extraction prompt for Prompt Diff** — used to find the closest matching graduated prompt. Misclassification = empty diff. Lock by hour 8.
5. **Demo seed data content** — the 30 captures, 15 learnings, 8 prompts need to look genuinely real. One person should own this end-to-end (not the engineers building features).
6. **Fallback recordings** — for every live beat, have a screen recording ready in case it breaks during the pitch. Record initial pass at hour 18, refresh at hour 22.

---

## 19. Risk register

| Risk | Mitigation |
|------|-----------|
| Claude.ai DOM changes break the extension day-of | **Smoke-test on the pinned demo browser at hour 6**, not hour 22. Pin the exact Chrome/Edge build for the demo. Record the fallback video at hour 18 and refresh at hour 22. |
| Socratic Mode injection gets stripped or ignored | Test with Claude in advance; tune the augmentation template by hour 6. |
| `/score` latency makes the textarea feel laggy | 250ms debounce; cache system prompt; same-prompt-hash dedup on client; show stale score with a spinner if a new score is in flight. |
| `/score` rate-limits or 500s | Browser ext fails open: no card, send proceeds unchanged. **Never block the user.** |
| Empty wiki on demo | Pre-seed; allocate 3 dedicated hours. |
| MCP autonomous call doesn't fire reliably | Tune the `wiki.update_learnings` tool description so Claude Code knows when to call it. Rehearse the demo trigger phrase. If it still misses on stage, the demonstrator can tell Claude Code to call it explicitly — the dramatic moment lands either way. |
| Skill_observation writes spam the dashboard during demo | Cap to one observation per (user, dimension, prompt-hash) within a 30s window. |
| Time blowout in last 4 hours | Clear cut order in §2; ship the headline first, then add layers. |

---

## 20. Definition of done

The hackathon is "won" if these all hold during the live pitch:

- [ ] Browser extension renders a live 5-dimension score-card on Claude.ai as the user types
- [ ] At score < 7, "Have Claude clarify" augmentation works end-to-end (clarifying questions appear in Claude's response)
- [ ] At score ≥ 7, no friction — the user sees no card highlight on send
- [ ] Each prompt sent writes a real `skill_observation` row visible on the dashboard
- [ ] VS Code extension shows team-anchored example prompts in the sidebar for a real file, plus the score-card webview
- [ ] An MCP-driven autonomous wiki update fires during the demo with a visible counter increment + durable promotion
- [ ] Dashboard shows skill arc + L1→L2 progression — partially seeded, with real `/score` writes from the demo prompts visibly layered on top
- [ ] The 7-sentence pitch lands with "five measurable dimensions"; mentor defenses ready (including the new score-card, privacy, and install-UX answers)
- [ ] No live demo failure mode — every beat has a fallback recording
