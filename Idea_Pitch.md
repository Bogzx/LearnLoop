# Trailhead — The Prompt Coach

Working name: **Trailhead** (placeholder — swap freely).
Adoption-ladder target: **L1 → L2** (opportunistic prompting → systematized, versioned team prompting), measured as engineer-level skill progression and team-level pattern reuse.
Form factor: **Cloud-primary coaching platform** (web dashboard at trailhead.dev) with **multi-surface capture** — VS Code / Cursor extension primary, MCP server for power users, browser extension for non-IDE AI tools.

> **One-line pitch:** *Trailhead is a prompt-skill coach that uses your team's actual work as the curriculum. The team wiki is the engine that keeps the curriculum fresh, automatically.*

---

## Mentor pitch — quick reference

### 7-sentence version (the main pitch — use this with mentors)

> Engineers have been prompting AI for two years, and almost none have gotten better at it — because they've literally never seen anyone else's prompts. That's the L1→L2 gap the brief calls the hardest unsolved transition. Trailhead is a coach that develops prompting craft using your team's actual work as the curriculum — not abstract advice from a blog. When you're about to prompt, we surface anonymized teammate prompts on similar tasks that shipped; after you prompt, we show you a Prompt Diff against your team's skilled version, scored across seven measurable dimensions. The team's curriculum grows itself from real reuse, maintained by the AI mid-conversation, so it never goes stale like every CLAUDE.md before it. Our KPIs are per-engineer skill progression and team-level reuse rate — behavioral metrics, not engineering ones. The brief literally says we don't even need to use AI to win as long as we drive adoption; we use it because it makes the coaching passive, not because it's the product.

### 30-second elevator (3 sentences)

> Engineers prompt AI all day but never get better at it, because no one's ever seen anyone else's prompts — that's the L1→L2 gap the brief names as the hardest. Trailhead is a coach that uses your team's actual prompts as the curriculum: surfaces anonymized teammate examples before you prompt, shows you a diff against the team's skilled version after, scored on seven measurable dimensions. The wiki grows itself via the AI mid-conversation, so the curriculum never rots — and our KPIs are skill progression and team reuse rate, which are behavioral metrics, not engineering ones.

### 10-second hallway version (1 sentence)

> A prompt coach for engineering teams: shows you what your teammates' best prompts look like, scores yours against them, and develops the skill the brief names as the hardest L1→L2 transition.

### Words to never say (they trigger the engineering reflex)

- *"We built an AI that..."*
- *"Our LLM..."* / *"Token efficiency..."* / *"Context router..."*
- *"Like Mintlify but..."* / *"Like Copilot but..."*

### Words to lead with

- *"AI adoption problem, not engineering one"*
- *"L1 is saturated; the unsolved gap is L1→L2"*
- *"Behavior change is the product"*
- *"Your team's work as the curriculum"*

---

## 1. The actual hurdles to better prompting

The brief asks us to drive L1→L2. To do that, we need to understand why engineers don't naturally prompt better and why teams don't naturally systematize. Five fundamental hurdles:

### Hurdle 1 — Articulation paralysis
Programmers think *in code*, not in specifications. They don't know what they want until they see it. Asking them to articulate intent in plain English upfront is asking them to switch cognitive modes against their grain. This is the deepest hurdle.

### Hurdle 2 — Unknown unknowns about the repo
A great prompt mentions specific files, helpers, and conventions. But the engineer has to *know those exist*. Most don't. Tribal knowledge stays trapped in senior heads.

### Hurdle 3 — Quality is invisible
The engineer has never seen a senior teammate's prompt — so they have no reference for what "good" looks like. And the AI happily produces *usable* output for any prompt — so there's no failure signal that drives improvement.

### Hurdle 4 — Solo work has no check
Code review exists for code. There is no equivalent for prompts. Every prompt is a one-person decision, judged only by whether the answer looked plausible.

### Hurdle 5 — No curriculum
Coding skill develops because there's a clear progression: read code, write code, get reviewed. Prompting has none of this. No examples, no measurement, no apprenticeship.

---

## 2. How we solve each hurdle

| Hurdle | Mechanism |
|--------|-----------|
| **1. Articulation paralysis** | Optional 3-field scaffold (Cmd+Shift+K): *Goal? What should AI know? Output shape?* Trains the user to ask themselves these three questions. |
| **2. Unknown unknowns** | Hierarchical Context Loading from the wiki — layered team conventions auto-inject based on file location. The user doesn't have to know what to mention. |
| **3a. Quality invisible — no reference** | Team-anchored examples — anonymous teammate prompts on similar tasks, filtered to ones that produced merged code. |
| **3b. Quality invisible — no feedback** | The Prompt Diff (post-prompt) — their prompt vs. team-skilled version, differences highlighted. Plus 1-keystroke outcome rating. |
| **4. Solo work, no check** | Optional pre-flight critic: *"This prompt is missing a constraint about idempotency, which your team's similar prompts include."* |
| **5. No curriculum** | Personal skill arc across seven dimensions; team-pattern library auto-graduated from real reuse; the wiki itself as the team's apprenticeship corpus. |

---

## 3. The seven dimensions of prompt quality

The skill rubric the coach scores against:

| Dimension | Lazy version | Skilled version |
|-----------|--------------|-----------------|
| **Goal clarity** | "make this better" | "reduce p99 latency below 200ms" |
| **Specificity** | "add error handling" | "wrap fetch in try/catch, log via logger.ts, return 500 with code" |
| **Context loading** | (none) | references the file, convention, related code |
| **Constraint articulation** | (none) | "must not change public API; must remain idempotent" |
| **Output specification** | (none) | "return only the modified function, no explanation" |
| **Decomposition** | one prompt asking for 5 things | one prompt per coherent task |
| **Iteration mode** | one-shot ambitious request | small steps when uncertain, big steps when confident |

These are teachable, measurable, and visible — the basis for the coach.

---

## 4. The product — a day in Maria's life

**Morning.** Maria opens Cursor on a retry-logic task in `src/api/auth/handlers/webhook.ts`. The status bar shows *"team context loaded for this folder."* HCL is doing its work invisibly.

**Pre-prompt — articulation.** Maria isn't sure what she wants. She hits **Cmd+Shift+K**. Three fields appear: *Goal / What should AI know / Output shape.* She fills them in 20 seconds. A structured prompt assembles itself.

**Pre-prompt — comparison.** Below her draft, a side panel shows: *"Two teammates wrote similar prompts in the last 30 days. Here's the one that produced merged code."* Anonymized. She compares. She adopts a refinement.

**The prompt fires.** Layered wiki context auto-injects. AI answers with team conventions baked in.

**Post-prompt — outcome.** One-keystroke widget: *helpful / mixed / not?* She taps helpful.

**Post-prompt — the diff.** On-demand: *"See how your prompt compares to your team's pattern."*

```
Your prompt:                 Team-skilled version (4 prompts → merged):
- file ✓                     - file ✓
- goal ✓                     - goal ✓
- constraint: max 5 attempts  - constraint: max 5, jitter, idempotent
- output ✓                   - output ✓

Differences:
+ jitter (your team adds this 89% of the time)
+ idempotency invariant (89%)
```

She sees the gap. She files it.

**End of week — skill arc.** Personal trajectory:

```
Goal clarity        ████████░░  improving
Specificity         █████████░  strong
Context loading     ███████░░░  improving
Constraint articulation ████░░░░░░  weakest dimension ←
Output shape        ██████░░░░  stable
Decomposition       ████████░░  strong
Iteration mode      ███████░░░  stable
```

*"Constraints are your weakest dimension. Three prompts this week were marked 'mixed' — all missed constraint articulation."*

**Manager view.** Team-level skill arcs going up, reuse rate 47%, *"prompts now include file paths 67% more often than 30 days ago."*

---

## 5. Architecture — coach onstage, wiki backstage

```
┌─────────────────  COACH (onstage, what users see)  ────────────────────┐
│                                                                        │
│   Articulation scaffold   ←──── opt-in via Cmd+Shift+K                 │
│   Pre-prompt examples     ←──── auto-shown when typing                 │
│   Prompt Diff             ←──── post-prompt, on-demand                 │
│   Outcome rating          ←──── one-keystroke after answer             │
│   Personal skill arc      ←──── weekly digest                          │
│   Team skill dashboard    ←──── manager view                           │
│                                                                        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ reads curriculum from
                                   ▼
┌─────────────  WIKI ENGINE (backstage, the curriculum source)  ─────────┐
│                                                                        │
│   .wiki/ tree (per-folder node.md + learnings.md)                      │
│   Hierarchical Context Loading (HCL)                                   │
│   Autonomous wiki maintenance via MCP tools                            │
│   Reinforcement counters (3× → durable promotion)                      │
│   Prompt graduation (3× reuse → .prompts/)                             │
│   L1→L2 metrics (reuse, coverage, graduations, skill arcs)             │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

The coach reads from the wiki to produce the curriculum:
- **Team-anchored examples** ← drawn from `.prompts/` (graduated patterns)
- **Prompt Diff "team-skilled" version** ← synthesized from durable learnings + graduated prompts in the relevant layer
- **Pre-prompt context auto-injection** ← HCL stack of node.md + learnings.md
- **Skill arc** ← pattern recognition over the user's prompt history

The wiki is the **engine**. The coach is the **surface**.

### Deployment topology

**Cloud platform (primary):**
- Web dashboard at trailhead.dev
- Skill scoring, prompt diffing, outcome attribution
- Wiki storage (default) or repo-sync mode (Business+)

**Capture surfaces:**
- VS Code / Cursor extension (primary developer surface)
- MCP server (power users — deepest integration with Claude Code)
- Browser extension (Plasmo) for Claude.ai / ChatGPT / Gemini users
- Direct paste / API

**Privacy tiers:**
- Default: prompts/learnings cloud-stored, code never sent unless GitHub App connected
- Business: repo-sync mode, dual-resident wiki
- Enterprise: repo-only mode, code never leaves repo, MCP primary

---

## 6. Monetization

| Tier | Price | Who | Unlocks |
|------|-------|-----|---------|
| **Free** | $0 | Solo, OSS | Articulation scaffold, generic curriculum, Prompt Diff (against generic standards), personal skill arc, outcome tracking |
| **Team** | $15/dev/mo | ≤50 | + **Team-anchored examples**, **wiki + HCL active**, team skill dashboard, prompt graduation, manager view |
| **Business** | $35/dev/mo | 50–500 multi-team | + Cross-team curriculum, org skill benchmarks, SSO, audit, repo-sync mode |
| **Enterprise** | Custom | 500+, regulated | + Repo-only mode, on-prem, BYO LLM, SOC2 |

**Team-tier upgrade trigger:** *"I want to learn from my teammates' prompts, not from generic prompt-engineering blogs."*

Bottom-up motion: dev signs up free → uses scaffold + diff against generic standards → invites teammates → team workspace activates with team-anchored curriculum → manager sees skill arcs → procurement signs.

---

## 7. Demo storyboard — 3 minutes

**0:00 — Hook (30s).** *"Software engineers have been prompting AI for two years and almost none have gotten better at it. The reason: they've never seen anyone else's prompts. We're a coach that turns prompting from invisible solo work into visible team craft — with your team's actual work as the curriculum."*

**0:30 — Articulation moment (40s).** Maria opens Cursor. Cmd+Shift+K. Three-field scaffold. 15 seconds, structured prompt appears. Below: *"Two teammates wrote similar prompts last week. Here's the one that shipped."* Comparison. She adopts a refinement.

**1:10 — The Prompt Diff (50s).** She fires. Gets a great answer. Marks helpful. Clicks "see how this compared." Diff slides in. *"You missed one dimension. Your team includes this one 89% of the time."* **The L1→L2 transition rendered as 30 seconds of pedagogy.**

**2:00 — Skill arc (30s).** Personal arc: 5 dimensions strong, 1 weakest, 1 stable. *"First time prompting has had a feedback loop."*

**2:30 — Team dashboard (20s).** Manager view: aggregate skill arcs up, reuse rate 47%, L1→L2 measurable. *"First time a CTO can prove AI is changing how the team works, not just whether they have access."*

**2:50 — Close (10s).** *"We're not making AI smarter. We're making engineers smarter at using AI. That's adoption."*

---

## 8. Build plan — 36 hours

| Phase | Hours | Deliverable | Live or mocked |
|-------|-------|-------------|----------------|
| Foundation | 0–4 | Cloud signup + dashboard skeleton + GitHub OAuth | Live |
| Wiki engine | 4–10 | `.wiki/` schema, HCL, MCP server with `update_learnings` + reinforcement | Live |
| Capture surface | 10–14 | VS Code/Cursor extension — captures prompts, surfaces team context | Live |
| **Articulation scaffold** | 14–18 | Cmd+Shift+K panel, 3-field form, structured prompt assembly | **Live — demo headline** |
| **Team-anchored examples** | 18–22 | Pre-prompt panel showing anonymized teammate prompts | **Live — demo headline** |
| **Prompt Diff** | 22–28 | Post-prompt diff, 7-dimension scoring, team-skilled synthesis | **Live — demo headline** |
| Outcome rating | 28–30 | One-keystroke widget after answer | Live |
| Skill arc | 30–32 | Personal arc bar chart | Mocked with seeded data |
| Manager dashboard | 32–34 | Team skill metrics view | Mocked with seeded data |
| Demo seed + polish | 34–36 | Pre-seed public demo repo with realistic team prompt history; rehearse | Critical |

### Must work live for the demo
1. Articulation scaffold (Cmd+Shift+K)
2. Team-anchored examples in pre-prompt panel
3. Prompt Diff (post-prompt)

### Cuts if behind schedule
- Cross-team transfer → slide only
- Personal skill arc → mocked screenshot
- Browser extension → cut entirely
- Manager dashboard → static screenshot

---

## 9. Tech stack

| Layer | Choice |
|-------|--------|
| Coach scoring (7 dimensions) | Claude Haiku 4.5 with structured output |
| Prompt diff synthesis | Claude Sonnet 4.6 + prompt caching |
| Embeddings (semantic similarity) | text-embedding-3-small |
| MCP server / CLI | Node + TypeScript |
| VS Code extension | TypeScript + VSCode API |
| Web dashboard | Next.js 15 + Tailwind + shadcn/ui |
| API | Hono |
| DB | Postgres + pgvector on Neon |
| Auth | Clerk + GitHub OAuth |
| Hosting | Vercel + Railway + Neon |

---

## 10. Mentor defenses

**"Isn't this just AI engineering with adoption framing?"**
> *"The product is a behavioral coach. The KPI is per-engineer skill progression across seven measurable dimensions, plus team-level reuse rate. Both are behavioral metrics. Swap any LLM out and the loop runs identically."*

**"Why won't engineers ignore the coach?"**
> *"Coaching surfaces are passive and respect flow. The articulation scaffold appears only when you ask. The Prompt Diff appears only when you click. We never interrupt and never judge."*

**"What about Copilot configured well?"**
> *"Copilot's instructions file is static reference. We're a coach. Different category. Copilot teaches your AI about your repo. We teach your engineers how to talk to any AI. The skill we develop is portable across Copilot, Cursor, Claude, and tools that don't exist yet."*

**"How is the team prompt library not just another shared doc that goes stale?"**
> *"The AI maintains it autonomously, mid-conversation, with reinforcement-based promotion. Patterns earn their place by happening 3× across distinct sessions. The maintenance loop that kills every shared doc — we own it structurally."*

**"What about juniors getting damaged?"**
> *"Today juniors get hallucinated answers from AI and ship code they can't debug. With Trailhead they see *the team's pattern* with citations and the rule that drove it — they're reading the team's mental model, not a hallucination. We're closer to mentorship than spoon-feeding."*

**"Privacy?"**
> *"Three layers: code never sent unless GitHub App connects, no chat logs anywhere, attribution off by default. There is no surveillance vector because there is no log to surveil."*

---

## 11. Five framing principles to memorize

1. **Coaching, not capturing.** The product develops skill, not just stores prompts.
2. **The team is the curriculum.** Real teammate prompts beat abstract principles.
3. **Visibility without judgment.** Anonymous, opt-in, personal-trajectory only.
4. **The wiki is the engine, not the product.** Infrastructure for the coach.
5. **Pedagogy of articulation.** Help them think; don't just polish their typing.

---

## 12. The status of the design

| | Status |
|---|--------|
| Coach pivot framing | Locked |
| Five hurdles + mechanism mapping | Locked |
| Seven-dimension skill rubric | Locked |
| Wiki-as-engine architecture | Locked |
| Cloud-primary deployment | Locked |
| Monetization tiers | Drafted |
| Demo storyboard | Drafted |
| Build plan with cuts | Drafted |
| **7-dimension scoring prompt for Haiku** | **Open — biggest implementation item** |
| **Team-skilled prompt synthesis** | **Open — implementation question** |
| Demo seed repo | Open |
