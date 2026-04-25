# Trailhead — Design Spec (24-hour Hackathon Build)

**Date:** 2026-04-25
**Constraint:** Build + deploy in 24 hours
**Goal:** Win PoliHack "AI Adoption for Engineers" by shipping a prompt coach that drives the L1→L2 transition for software teams. Simple to build, tech-impressive on stage.

---

## 1. Product framing

**Headline:** *Trailhead is a prompt-skill coach that uses your team's actual work as the curriculum. The team wiki is the engine that keeps the curriculum fresh, automatically.*

**Adoption target:** L1 → L2 (individual prompting → team-systematized prompting). The brief calls this the hardest transition.

**The behavioral diagnosis:** Engineers can't get better at prompting because they've literally never seen anyone else's prompts. We make prompting visible to the team without making it surveillance.

**Brief alignment:**
- Behavior change is the product; AI is infrastructure.
- KPI is per-engineer skill progression + team-level reuse rate (behavioral metrics).
- Passive intervention beats training content.
- L1→L2 is the unsolved gap; the brief explicitly endorses targeting it.

---

## 2. The 24-hour scope — what ships live

### Must work live (the demo headline)

1. **Browser extension on Claude.ai** with **Socratic Mode** prompt augmentation
   - Detects user's draft prompt, scores it via backend
   - Augments with coaching that makes the AI itself ask clarifying questions
   - This is the visceral cross-platform "wow" moment
2. **VS Code extension** with pre-prompt nudge sidebar showing team-anchored examples
3. **Backend** that: scores prompts on 7 dimensions, retrieves team examples by tree-walk, captures sessions
4. **MCP server** for Claude Code / Claude Desktop, with at least one autonomous wiki update during the demo (`wiki.update_learnings`). For the demo, Claude Code runs in VS Code's integrated terminal so both surfaces are visible in one window.
5. **Web dashboard** with skill arc + L1→L2 metrics view (mostly seeded data, but live navigation)

### Cuts in priority order (cut first if behind)

1. Articulation scaffold (Cmd+Shift+K) — Socratic Mode in browser is the headline anyway
2. Outcome rating widget — hand-wave in demo
3. Personal skill arc backend — fully mocked from seed data
4. Team L1→L2 dashboard — fully mocked from seed data
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
│   POST /score          — 7-dim score on prompt     │
│   POST /capture        — store conversation        │
│   GET  /context?path=  — HCL bundle (path-walked)  │
│   GET  /examples?path= — team-anchored prompts     │
│   POST /diff           — generate Prompt Diff      │
│   POST /wiki/propose   — MCP autonomous update     │
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
| Redis | None | NOTIFY/LISTEN for the worker; cache in-process if needed |
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
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | durable
  reinforcement_count INT NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_learnings_node_status ON learnings(node_id, status);

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

-- Captured sessions (transient — auto-purged after worker processes)
CREATE TABLE captures (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id),
  surface TEXT NOT NULL,                 -- 'browser' | 'vscode' | 'mcp'
  user_prompt TEXT NOT NULL,
  ai_response TEXT,
  file_path TEXT,                        -- path context if known
  outcome TEXT,                          -- 'helpful' | 'mixed' | 'not'
  scored_dimensions JSONB,               -- {goal: 8, specificity: 4, ...}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Skill arc data (for the dashboard — mostly seeded)
CREATE TABLE skill_observations (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id),
  user_id TEXT NOT NULL,                 -- placeholder; no real users for demo
  dimension TEXT NOT NULL,               -- 'goal_clarity' | 'specificity' | ...
  score INT NOT NULL,
  ts TIMESTAMPTZ DEFAULT NOW()
);

-- Audit / events for the worker
CREATE TABLE events (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id),
  kind TEXT NOT NULL,                    -- 'capture' | 'wiki_propose' | 'reinforce' | 'graduate'
  target_id UUID,
  payload JSONB,
  ts TIMESTAMPTZ DEFAULT NOW()
);
```

That's seven tables. Implementable in ~1 hour by one engineer.

---

## 5. The seven prompt-quality dimensions (the rubric Haiku scores against)

| Dimension | Lazy → Skilled |
|-----------|----------------|
| **goal_clarity** | "make this better" → "reduce p99 latency to 200ms" |
| **specificity** | "add error handling" → "wrap fetch in try/catch, log via logger.ts, return 500" |
| **context_loading** | (none) → references file, convention, related code |
| **constraint_articulation** | (none) → "must remain idempotent; no public API change" |
| **output_specification** | (none) → "return only the modified function, no explanation" |
| **decomposition** | one prompt for 5 things → one prompt per coherent task |
| **iteration_mode** | one-shot ambitious request → small steps when uncertain |

**Scoring prompt for Haiku (template):**

```
You are a prompt-quality scorer. Given a developer's draft prompt, return a JSON
object scoring it 0-10 on each of these seven dimensions:
- goal_clarity, specificity, context_loading, constraint_articulation,
  output_specification, decomposition, iteration_mode

For dimensions scoring below 5, also return a brief "missing" hint
(e.g., "no file path mentioned" for context_loading=2).

Return only JSON. No prose.

Prompt: <user prompt>
File context: <file path if known>
```

Cost: ~500 input tokens cached + ~150 output. Haiku 4.5 ≈ $0.0004 per scoring. Negligible.

---

## 6. Socratic Mode (the demo headline mechanic)

### How the browser extension augments a prompt

1. User types in Claude.ai textarea: *"fix the retry"*
2. Extension intercepts send (preventDefault on form submit)
3. POST `/score` with `{ prompt, surface: 'browser' }`
4. Backend returns:
   ```json
   {
     "scores": { "goal_clarity": 6, "specificity": 4, "context_loading": 2, ... },
     "missing_dimensions": ["context_loading", "constraint_articulation"],
     "team_examples_count": 3
   }
   ```
5. Extension asks user (visible UI):
   *"Your prompt is missing context and constraints. Want Trailhead to ask Claude to clarify before answering?"*
6. On accept, extension replaces textarea content with augmented version:
   ```
   fix the retry

   ---
   [Trailhead coaching: This prompt is missing context. Before answering,
   please ask the user 2-3 clarifying questions:
   - Which file/folder is the retry in?
   - What library or helper is currently used (e.g. utils/retry.ts)?
   - What constraints apply (max attempts, idempotency, jitter)?
   Only proceed once these are clarified.]
   ```
7. User clicks send. Claude receives augmented prompt, asks the questions, user answers, Claude gives a much better answer.

**The pedagogical point:** the user just went through an articulation scaffold without realizing it. The AI itself was the coach.

### Per-provider note

Hackathon ships **Claude.ai only**. Other browsers (ChatGPT, Gemini) become a slide line: "we deliver coaching wherever your team prompts; here's the proof on Claude.ai today, and the architecture extends to every other surface."

---

## 7. VS Code extension + MCP server

### Two surfaces, two jobs

The IDE-side coaching is split across **two coordinated components** because VS Code's built-in chat APIs are limited and we don't want to fight them:

**(A) VS Code extension** — the visible coaching UI alongside whatever AI chat the user is in (Copilot Chat, Continue, Cline, or just our own panel):
- **Pre-prompt panel** (sidebar) showing 2-3 team-anchored example prompts when the user opens a file. Source: tree-walk on `prompts.node_id` matching ancestor paths.
- **Articulation scaffold** (Cmd+Shift+K) — the 3-field thinking helper.
- **Post-prompt outcome rating** widget (one keystroke).
- **Manual "send to Trailhead" command** for capturing prompts from any chat surface in the editor.

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
  → backend: exact-match dedup against existing; if new, create draft;
    if matches, increment reinforcement_count;
    if count >= 3, promote status to 'durable'
  → returns: { action: 'created' | 'reinforced' | 'promoted', current_count }

wiki.search(query, scope)
  → simple SQL ILIKE for hackathon (no vector search)

wiki.rules_for(file_path)
  → returns active rules from ancestor nodes
```

### The autonomous demo moment

VS Code is open. Integrated terminal at the bottom runs Claude Code with our MCP server registered. User says to Claude Code:

> *"actually we always use exponential backoff with jitter here, that's our convention."*

Claude Code calls `wiki.update_learnings`. The MCP server returns:

```
{ action: "reinforced", current_count: 3, promoted_to_durable: true }
```

The Claude Code response shows: *"Updated team wiki. This pattern was reinforced for the third time and is now a durable team learning."* The audience sees both the IDE (with our extension's sidebar) and the terminal (with Claude Code) in one VS Code window.

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

## 9. The reinforcement worker (post-MVP — skip if needed)

Optional for hackathon. If included:
- Postgres NOTIFY on insert into `events`
- Worker LISTENs, processes capture events
- For each capture: call Haiku to extract candidate learnings, post to `/wiki/propose`
- This is the path that lets the **browser extension also drive wiki updates** (since it can't call MCP)

If skipped for hackathon: only the MCP path (Claude Code in VS Code's terminal) produces wiki updates. The browser extension just captures (`POST /capture`) but doesn't trigger learning extraction. That's fine for the demo — the wiki updates happen visibly via Claude Code.

**Recommendation:** skip for the 24h build. Add post-hackathon.

---

## 10. The Prompt Diff (post-prompt feature)

After the user gets an answer:
1. Mark the prompt with outcome (`POST /capture` includes `outcome` field if rated)
2. On user click "show team comparison":
   - Backend: fetch the closest matching graduated `prompt` (by topic + path proximity, ranked by Haiku if multiple candidates)
   - Run the user's prompt + the graduated prompt through scoring
   - Render side-by-side diff highlighting which dimensions the user missed

For the hackathon, the "closest match" can be deterministic: find prompts in the same `node.path` ancestry with matching `topic` (extracted from user prompt via Haiku in one call).

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
- ~50 skill_observations to make the skill arc chart look real

Hand-craft these to be plausible and to hit the demo flow.

---

## 12. Build sequencing for a 4-person team

| Hours | Person A (frontend) | Person B (browser ext) | Person C (VS Code ext + MCP) | Person D (backend) |
|-------|---------------------|------------------------|------------------------------|---------------------|
| 0–2 | Next.js scaffold, Tailwind, dashboard skeleton | Plasmo scaffold, manifest for Claude.ai | VS Code extension scaffold + sidebar webview; standalone MCP server scaffold | Hono + Postgres schema + deploy to Railway |
| 2–6 | Dashboard pages (skill arc, team metrics, wiki view) — all reading from API | DOM hooks: detect input, intercept send, render augmentation UI | Pre-prompt sidebar pulling `/examples?path=`; articulation scaffold (Cmd+Shift+K) | `/score`, `/capture`, `/context`, `/examples` endpoints + Haiku integration |
| 6–10 | Polish dashboard, add the wiki tree view | Implement `/score` call + augmentation rewrite | MCP server tools (`wiki.update_learnings`, `wiki.context_for`, `wiki.search`); test against Claude Code | `/wiki/propose` + dedup + counter promotion |
| 10–14 | Wire dashboard to live data, add the L1→L2 progression chart | Polish UX, edge cases (multi-line prompts, paste events) | Post-prompt outcome widget + Prompt Diff display; bundle MCP install instructions | Demo seeding scripts; populate Acme Fintech data |
| 14–18 | All-hands: demo seeding, polish | Test demo flow end-to-end on Claude.ai | Test demo flow end-to-end in VS Code + Claude Code in integrated terminal | Validate all data renders correctly |
| 18–22 | All-hands: bug fixes, fallback recordings | All-hands: rehearse demo 3+ times | All-hands: prepare slides | All-hands: stress-test |
| 22–24 | Final polish, last bug fixes, final rehearsal |

### If team is smaller (1–2 people)

Cut to:
- Browser ext only (the headline) + minimal backend
- Skip VS Code extension entirely
- Skip MCP server entirely (mention as "v2")
- Dashboard is a single static page with seeded data
- Demo is browser-only — still very compelling

This is doable solo in 24h.

---

## 13. Demo storyboard (3 minutes)

**0:00 — Hook (30s)** — *"Engineers have been prompting AI for two years and almost none have gotten better at it. Because they've literally never seen anyone else's prompts. We turn prompting from invisible solo work into visible team craft, with your team's actual work as the curriculum."*

**0:30 — Sign in (10s)** — Open trailhead.dev, click "Demo team: Acme Fintech," dashboard appears with seeded skill arcs and metrics.

**0:40 — Socratic Mode in browser (60s)** — Open Claude.ai. Type *"fix the retry"*. Trailhead extension panel appears: *"Your prompt is missing 2 dimensions. Want me to ask Claude to clarify first?"* Click yes. Augmented prompt sends. Claude responds asking 3 clarifying questions. Demonstrator answers them. Claude gives a perfect answer using the team's actual retry pattern. **The user just went through an articulation scaffold without an articulation scaffold.**

**1:40 — VS Code with team-anchored examples (40s)** — Open VS Code on a pre-seeded Acme Fintech repo. Click into `src/api/webhooks/handler.ts`. Trailhead sidebar shows: *"Your team has 3 graduated prompts for webhook patterns. Most-reinforced: idempotent retry with backoff."* Demonstrator opens the integrated terminal, runs Claude Code, pastes the team's pattern, gets team-aware answer.

**2:20 — The autonomous wiki update (30s)** — Still in VS Code, with Claude Code in the integrated terminal. Demonstrator says: *"actually we always use exponential backoff with jitter here."* Claude Code (via our MCP server) immediately calls `wiki.update_learnings`. Response shows: *"This insight matches a draft from yesterday — reinforcing. Counter: 3/3 → promoted to durable."* Cut to the sidebar — the new durable learning appears. *"This is how the team brain grows itself. No one had to remember to write it down."*

**2:50 — Close (10s)** — Cut back to dashboard. Skill arc visibly ticks up. *"We didn't build another AI tool. We built the coach that turns your team's work into a curriculum, makes prompting visible without surveillance, and proves L1→L2 progression with real metrics."*

---

## 14. Mentor pitch — 7 sentences

> Engineers have been prompting AI for two years and almost none have gotten better at it — because they've literally never seen anyone else's prompts. That's the L1→L2 gap the brief calls the hardest unsolved transition. Trailhead is a coach that develops prompting craft using your team's actual work as the curriculum — not abstract advice from a blog. When you're about to prompt, we surface anonymized teammate prompts on similar tasks; after you prompt, we show you a Prompt Diff against your team's skilled version, scored across seven measurable dimensions. The team's curriculum grows itself from real reuse, maintained by the AI mid-conversation, so it never goes stale like every CLAUDE.md before it. Our KPIs are per-engineer skill progression and team-level reuse rate — behavioral metrics, not engineering ones. The brief literally says we don't even need to use AI to win as long as we drive adoption; we use it because it makes the coaching passive, not because it's the product.

---

## 15. Mentor defenses

**"Isn't this AI engineering with adoption framing?"**
> *"The product is a behavioral coach. KPI is per-engineer skill progression across seven measurable dimensions plus team-level reuse rate. Both are behavioral metrics. Swap any LLM out — the loop runs identically. The brief says we don't need to use AI to win as long as we drive adoption; we use it because it makes the coaching passive."*

**"Copilot does this configured well."**
> *"Copilot's instructions file is static reference and dies in 8 weeks because someone has to maintain it. We're a coach that develops the engineer, not just the AI. The configuration-decay problem that kills every `copilot-instructions.md` and `.cursorrules` — we own that loop structurally."*

**"Why won't engineers ignore the coach?"**
> *"Coaching surfaces are passive and respect flow. Socratic Mode appears only when prompts score low. The VS Code pre-prompt nudge is a glance, not a form. Skill arc is your private trajectory. We never interrupt and never judge — that's why it survives."*

**"What's your moat against Anthropic shipping this?"**
> *"Three things they probably won't do. One: portable model-agnostic curriculum — your team's wiki works against any LLM. Two: team consensus via reinforcement counters; their memory is per-user. Three: cross-team transfer is a network-effect product no model vendor will build because it doesn't sell more inference."*

**"Privacy?"**
> *"Code never leaves the user's machine — only the prompt content does, which the user already typed into Claude.ai or VS Code. Hackathon is cloud-stored; production has Enterprise tier with single-tenant VPC deploy. No conversation logs anywhere — we capture distilled learnings, not transcripts. There's no surveillance vector because there's no log to surveil."*

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
| Coach scoring | Claude Haiku 4.5 with prompt caching | Cheap, fast, cached system prompt |
| Prompt Diff synthesis | Claude Sonnet 4.6 with prompt caching | Quality matters here, cache helps |
| Auth | Hardcoded team token (hackathon) → Clerk (post) | Simplest possible |

**Total infrastructure for the hackathon:**
- 1 Postgres instance (Neon free tier)
- 1 Railway service (Hono API)
- 1 Vercel deployment (Next.js dashboard)
- 1 browser extension (Plasmo dev build, side-loaded into Chrome)
- 1 VS Code extension (sideloaded VSIX)
- 1 standalone MCP server binary (registered in Claude Code's config)

Six things. Each one is a single service with no internal complexity. The MCP server and VS Code extension share the same TypeScript codebase but ship as separate artifacts.

---

## 17. Why this is tech-impressive

For mentors / judges who want technical depth, the impressive elements are:

1. **MCP integration with autonomous tool calls** — the AI itself updates the wiki mid-conversation. Most teams won't ship working MCP.
2. **Browser extension that augments prompts on Claude.ai** — Socratic Mode is genuinely novel; few hackathon teams will have built one.
3. **Real prompt scoring with Haiku** — running an LLM on every prompt for a 7-dimension rubric is non-trivial; we make it cheap with prompt caching.
4. **Cross-platform reach demonstrated live** — browser + IDE both working in the same demo proves the architecture.
5. **The Karpathy-flavored file-tree wiki** with no vector DB — the LLM navigates the wiki cognitively, not via vector math. Pitchable as "LLM OS for engineering teams."
6. **Reinforcement-counter mechanic** — patterns earn their place in the durable wiki via consensus, not admin decree. Defensible as actual research-aligned (matches Zep/Graphiti's evolving-facts model).

What we deliberately don't show off (because they're commodity):
- No vector DBs (we don't need them)
- No microservices
- No fancy auth (Clerk is fine)
- No exotic infra

The impressiveness is **what we built and why**, not how many services we deployed.

---

## 18. Open implementation questions

These need a decision before/during the build, not after:

1. **The Haiku scoring prompt template** — needs careful crafting and few-shot examples. Should be locked in hour 4 so backend can use it.
2. **The Socratic Mode augmentation template** — what exact text to inject? Tested with Claude to make sure it complies. Lock by hour 6.
3. **Demo seed data content** — the 30 captures, 15 learnings, 8 prompts need to look genuinely real. One person should own this end-to-end (not the engineers building features).
4. **Fallback recordings** — for every live beat, have a screen recording ready in case it breaks during the pitch. Record at hour 22.

---

## 19. Risk register

| Risk | Mitigation |
|------|-----------|
| Claude.ai DOM changes break the extension day-of | Pin demo browser to a tested version; record fallback video |
| Socratic Mode injection gets stripped or ignored | Test with Claude in advance; tune the augmentation template |
| Latency on `/score` ruins the UX | Cache the system prompt; async-fire augmentation while user reads the suggestion |
| Empty wiki on demo | Pre-seed; allocate 3 dedicated hours |
| MCP autonomous call doesn't fire reliably | Have demonstrator phrase the trigger sentence to maximize call probability; have a manual fallback (`/update wiki` slash command) |
| Time blowout in last 4 hours | Clear cut order in §2; ship the headline first, then add layers |

---

## 20. Definition of done

The hackathon is "won" if these all hold during the live pitch:

- [ ] Browser extension intercepts a Claude.ai prompt and visibly augments it with Socratic clarifying questions
- [ ] Claude.ai responds with the clarifying questions (Socratic Mode worked)
- [ ] VS Code extension shows team-anchored example prompts in the sidebar for a real file
- [ ] An MCP-driven autonomous wiki update fires during the demo with a visible counter increment
- [ ] Dashboard shows skill arc + L1→L2 progression metrics (even if seeded)
- [ ] The 7-sentence pitch lands; mentor defenses ready
- [ ] No live demo failure mode — every beat has a fallback recording
