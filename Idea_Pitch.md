# Trailhead — The Whole Idea

Working name: **Trailhead** (placeholder — swap freely).
Adoption-ladder target: **L1 → L2** (opportunistic prompting → systematized, versioned team prompting), with L2-to-L2 cross-team transfer in the paid tier.
Form factor: **MCP server + VS Code extension** (works with Claude Code, Cursor, Claude Desktop) + optional cloud control plane for paid tiers.

---

## 1. The adoption problem we're solving

Software engineers are saturated at **L1**: 76% use AI daily. Individual adoption is solved. The unsolved gap — and the one the brief explicitly names as hardest — is **L1 → L2**: turning solo, isolated, reinvented prompting into shared, versioned, team-systematized prompting.

European teams trail the US. The market is real and the gap is wide.

---

## 2. The opening line

> *"We're solving an AI adoption problem, not an AI engineering one. Software engineers already prompt every day — the unsolved gap is that no team's individual prompts ever compound into shared knowledge. We built a passive behavioral intervention that closes that gap without asking anyone to change how they work."*

Forbidden words: "we built an AI that...", "our LLM does...", "our context router..." — these all trigger the engineering reflex. Open with the behavior change. Always.

---

## 3. The behavioral intervention — six L1→L2 moments

Each is a small, deliberate place where the path of least resistance shifts from *individual* to *teamful*. Together they compound.

| # | Moment | What dies (L1) | What compounds (L2) |
|---|--------|----------------|---------------------|
| 1 | **Pre-prompt nudge** | Re-asking a solved question | While typing, team learnings + recent activity surface — Tab to adopt |
| 2 | **In-prompt context** | LLM gets only the dev's words | Layered team knowledge auto-injected, dev didn't ask for it |
| 3 | **Autonomous capture** | Q&A dies in browser tab | AI calls `wiki.update_learnings` mid-conversation, learnings file grows |
| 4 | **Crystallization threshold** | One-off insights pollute or vanish | 3× reinforcement promotes drafts to durable team patterns |
| 5 | **Prompt graduation** | Good prompt lives in one head | Reused 3+ times → auto-PR to `.prompts/<topic>.md` |
| 6 | **Day-1 onboarding** | New hire interrogates seniors | First prompt loads the team's full distilled context |

The product *is* these six moments. Everything else is infrastructure that makes them work.

---

## 4. The substrate — a wiki that lives in the repo and maintains itself

The behavior change needs a place to deposit knowledge. The wiki is that place. It is **deliberately boring**: just markdown files in a `.wiki/` folder, git-tracked.

```
repo/
  .wiki/
    repo.md                  # repo-level conventions, glossary
    index.yaml               # tree manifest
    src/
      node.md                # rules + structural summary (slow-changing, hand-curated)
      learnings.md           # AI-managed: drafts + durable patterns
      api/
        node.md
        learnings.md
        auth/
          node.md
          learnings.md
  .prompts/
    api-handler.md           # graduated prompts
    rate-limit.md
```

Two artifact kinds per layer:
- **`node.md`** — stable rules, invariants, structural summaries. Mostly hand-curated, occasionally edited via `/update wiki`.
- **`learnings.md`** — accumulated wisdom, AI-managed, semantically merged.

`learnings.md` has YAML frontmatter with reinforcement counters and two prose sections:

```markdown
---
counters:
  durable:
    "Idempotency key from request header": 7
    "Tokens validated via keystore.ts, never decoded inline": 4
  drafts:
    "Webhook handlers should debounce duplicate retries": 2
last_distilled: 2026-04-25
---

# Auth layer — accumulated learnings

## Durable patterns
[reinforced 3+ times — promoted to canonical]

## Recent observations (drafts)
[< 3 reinforcements — not yet team consensus]
```

There is **no Q&A log**. No transcripts. No "who asked what" history. We learned from raw chat-log designs that they create a surveillance vector that kills adoption — and they pollute the LLM's context window with noise. The wiki captures *what was learned*, never *what was asked*.

---

## 5. The AI is the wiki's author

There is no separate indexer. No background daemon. The AI the user is *already chatting with* maintains the wiki itself — invoked through MCP tools the AI calls autonomously, plus slash commands the user can fire manually.

**Slash commands (manual, user-driven):**

```
/init repo            → AI scaffolds .wiki/ from current codebase
/update wiki          → AI proposes node.md + learnings.md edits from this session
/update prompts       → AI proposes promoting reused prompts
/verify               → AI checks pending changes against ancestor rules
/explain rules        → Show layered context loaded for current file
/find similar         → Search team learnings before asking
/onboard              → New-hire mode: walk through the wiki top-down
```

**MCP tools (autonomous, AI-driven):**

```
wiki.context_for(file)               → returns layered node.md + learnings.md stack
wiki.search(query, scope)            → semantic search over learnings + rules
wiki.update_learnings(node, insight) → semantic merge, bump counter, auto-promote at 3×
wiki.propose_update(node, diff)      → draft node.md edit, user approves
wiki.graduate_prompt(template)       → propose moving prompt to .prompts/
wiki.verify_diff(diff, file)         → check generated code against ancestor rules
wiki.rules_for(file)                 → active rules for a path
```

**The AI knows when to act.** A steward prompt fragment is injected into the conversation, telling the AI: *"After substantive Q&A, call `wiki.update_learnings`. When the user reveals a non-obvious team rule, propose adding it to the relevant `node.md`. Before finalizing AI-generated code, verify against ancestor rules."* Every wiki write surfaces in the IDE as a one-click diff. The AI proposes, the user approves.

This is why the demo is visceral: judges watch the AI itself update the wiki mid-conversation. The capture step *is* the behavior change.

---

## 6. Hierarchical Context Loading — the substrate that makes it cheap

When the AI is asked about `src/api/auth/handlers/login.ts`, the MCP server walks the path top-down and stacks every ancestor's `node.md` + durable section of `learnings.md`. Closer to the leaf = more team-specific. Top layers change rarely → cache hits → 5–10× cheaper queries.

Three reasons the layered shape is right:
1. **Mirrors how engineers reason** — repo-wide → layer-specific → leaf.
2. **Prompt-cache goldmine** — top layers cache; only the leaf is hot.
3. **Encodes adoption progression** — the wiki naturally crystallizes from individual usage at the leaf, then propagates upward as patterns mature.

This is infrastructure. It is not the pitch. The pitch is the behavioral intervention.

---

## 7. Privacy by design

Three layers of protection, in order:

1. **Code never leaves the repo.** The data plane is local. BYO LLM key.
2. **No conversation logs anywhere.** We capture *learnings*, never transcripts. No "Bogdan asked this dumb question" trail because there is no Q&A file at all.
3. **Default anonymous social proof.** "Reinforced 7× by your team" — never "Andrei asked this Tuesday." Attribution is opt-in, per team, and surfaced via git blame on the `learnings.md` file rather than stored as a structured field.

This is the line we repeat in every enterprise call: *"There is no surveillance vector because there is no log to surveil."*

---

## 8. Architecture — Variant C′ hybrid

**Data plane (local, in repo, free):**
- `.wiki/` — markdown + YAML, git-tracked
- Trailhead MCP server — local Node process, exposes the tools above
- VS Code extension — pre-prompt nudge UI, sidebar showing layered context, rule-violation gutters
- Slash commands registered with Claude Code, Cursor, Claude Desktop
- Optional post-commit hook — minimal nudge, not the main update vector

**Control plane (cloud, paid tiers, additive):**
- Web dashboard — L1→L2 metrics, graduation feed, wiki health, cross-team search
- GitHub/GitLab App — PR comments showing rule violations
- Org-level glossary, propagated above every team's `repo.md`
- Cross-team semantic search over learnings.md *summaries* (never raw, never code)
- SSO/SAML, audit, RBAC

**What syncs to control plane:** event metadata only — counter increments, graduation events, coverage stats. Never raw learnings content. Never code. Never Q&A (there is none).

---

## 9. Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| MCP server / CLI | Node + TypeScript | Fastest path, MCP SDK is TS-native |
| VS Code extension | TypeScript + VSCode API | Standard |
| Embeddings | `text-embedding-3-small` (or local BGE) | Cheap, good quality |
| Semantic merge | Claude Haiku 4.5 | Cheap bulk distillation |
| Wiki query | Claude Sonnet 4.6 + prompt caching | Layered context = cache-friendly |
| Web dashboard | Next.js 15 + Tailwind + shadcn/ui | Standard |
| API | Hono | Edge-deployable |
| DB | Postgres + pgvector on Neon | Metadata + summaries' embeddings |
| Auth | Clerk + GitHub OAuth | Team mapping via GitHub orgs |
| Hosting | Vercel + Railway + Neon | Standard |

---

## 10. Monetization

| Tier | Price | Who | Unlocks | Upgrade trigger |
|------|-------|-----|---------|-----------------|
| **OSS / Solo** | Free | Individuals, OSS repos | CLI, MCP server, VS Code extension, layered context, BYO LLM, all slash commands | Used at work |
| **Team** | $15/dev/mo | Single team, ≤50 | + L1→L2 dashboard, graduation feed, GitHub App, basic admin | "Is this actually working?" |
| **Business** | $35/dev/mo | 50–500, multi-team | + Cross-team search, org glossary, SSO, audit, conflict detection | "Five teams reinventing each other's patterns" |
| **Enterprise** | Custom | 500+, regulated | + On-prem control plane, BYO LLM endpoint, SOC2, dedicated support | Procurement, compliance |

Bottom-up motion: dev installs free → team workspace activates → manager sees their first L1→L2 graph → procurement signs. Same playbook as Linear, Vercel, Cursor, Sentry.

---

## 11. Demo storyboard — 3 minutes

**0:00 — The adoption hook (30s).** *"76% of engineers prompt AI every day. Less than 10% of teams have systematized it. Every prompt dies alone. We're not here to make AI better at coding. We're here to make teams better at adopting AI."*

**0:30 — Setup (15s).** Open Cursor on a clean public repo. Fire `/init repo`. The AI scaffolds `.wiki/` live, generates `node.md` and empty `learnings.md` for every folder, commits.

**0:45 — Moment 1, the pre-prompt nudge (45s).** Open `src/api/auth/handlers/login.ts`. Start typing *"how do I add retry logic"*. Pre-prompt panel shows: *"Team learning (reinforced 7×): wrap settle() with exponential-backoff-with-jitter. Idempotency key from request header required."* Tab. Cursor returns the team's actual pattern with `auth/learnings.md` citations. Ship.

**1:30 — Moment 3, autonomous capture (45s).** Mid-conversation the user says *"actually we always use exponential backoff with jitter here, that's our convention."* The AI immediately calls `wiki.update_learnings`. MCP popup: *"This insight matches a draft from 2 days ago — reinforcing. Counter: 2/3."* User keeps coding. Cut to a different teammate's laptop the next day, same insight surfaces. Counter: 3/3. **Auto-promoted to durable.** Now in everyone's pre-prompt nudge, forever. *No log was ever written. The wiki just got smarter.*

**2:15 — The dashboard (30s).** Zoom out to web dashboard. This week: 12 crystallizations, 3 prompt graduations, 47% reuse rate. The L1→L2 progression line going up and to the right. Cross-team panel: Team A's retry pattern available for Team B to adopt with one click.

**2:45 — Close (15s).** *"Three behaviors changed: nobody re-solves what a teammate solved. Team knowledge compounds instead of decays. Day-1 hires inherit everything. We didn't build another AI tool. We built the reason your team's AI use actually adds up to something."*

---

## 12. The adoption-defense cheat sheet

For mentor / judge questions, memorize these:

**"Isn't this just AI engineering with an adoption sticker?"**
> *"Swap any LLM in — the loop works identically. The AI is infrastructure; the behavior change is the product. Our primary KPI is the percentage of insights reinforced by multiple teammates — that's a behavioral metric. The brief explicitly says we don't even need to use AI to win, as long as we drive adoption."*

**"Why wouldn't a team just maintain a `CLAUDE.md` manually?"**
> *"They don't. They write it once, it goes stale in two weeks, and `.cursorrules` gets ignored within a sprint. Manual systematization fails because it requires friction-against-deadline. Our intervention is passive: engineers do zero extra work, but team-level behavior changes anyway."*

**"Isn't L0→L1 the brief's recommended target?"**
> *"For non-software engineers, yes. For software engineers, L1 is already at 76% saturation — there's no audience left there. The available jump is L1→L2, which the brief itself names as the hardest transition. Both targets count."*

**"How is this different from Mintlify, Swimm, Greptile?"**
> *"Those are doc generators or code-search tools — execution products that target individual productivity. We're a behavioral intervention that targets team systematization. Different KPI, different motion, different product."*

**"What about privacy in enterprises?"**
> *"Three layers: code never leaves the repo, no chat logs anywhere, attribution off by default. There is no surveillance vector because there is no log to surveil. That's not a bolt-on — it's the only way the capture step earns trust at all."*

---

## 13. The five framing principles to repeat until memorized

1. **Behavior change is the product. AI is infrastructure.**
2. **The KPI is team-level reinforcement, not code quality.**
3. **Passive intervention beats training content** (the brief explicitly says this).
4. **L1→L2 is the unsolved gap for software engineers** (L0→L1 is solved).
5. **The brief says we don't need AI to win** — we use it; we don't have to.

---

## 14. What's locked, what's left

| | Status |
|---|--------|
| Adoption framing | Locked |
| Architecture (Variant C′ hybrid) | Locked |
| L1→L2 mechanism (six moments) | Locked |
| AI-as-steward model | Locked |
| Insights File model (no Q&A log) | Locked |
| Privacy by design | Locked |
| `learnings.md` schema with reinforcement counters | Locked |
| Tech stack | Drafted |
| Monetization tiers | Drafted |
| Demo storyboard | Drafted |
| MCP tool signatures | Sketched |
| **Steward system prompt fragment** | **Biggest open item** |
| `.wiki/index.yaml` formal schema | Needs writing |
| Demo seed repo | Needs picking |
