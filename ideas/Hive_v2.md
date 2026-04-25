# Hive v2 — The Re-Pitch

> This document supersedes both `Idea_Pitch.md` (Trailhead) and `ideas/Hive.md` (original Hive).
> It merges Hive's positioning with Trailhead's git-native storage, and aggressively cuts scope to fit a 24h hackathon.
> Rationale for every cut is logged at the bottom.

---

## One-sentence pitch

> Git made code collective. Hive makes AI-assisted engineering knowledge collective — so every question your team asks an AI compounds instead of dying in a browser tab.

**Adoption jump:** L1 → L2 — owned, not apologized for. The brief calls this the hardest transition. Systematizing prompts + answers into versioned repo artifacts is textbook L2.

**Form factor:** MCP server + a one-page web dashboard. No VS Code extension, no browser extension, no Slack bot in the MVP.

---

## Three features. That's it.

### 1. Capture
MCP server exposes `hive.log(question, answer, file_refs)`. Claude Code / Cursor / any MCP client calls it at the end of every substantive exchange. Writes to the nearest `.hive/qa.jsonl` — the file closest to the code being discussed.

### 2. Retrieve ("Already Asked")
MCP server exposes `hive.search(query)`. Before the AI answers, it checks if the team already resolved a semantically-similar question. If yes, returns the prior answer + attribution (*"Andrei asked this Tuesday, answer shipped in commit abc123"*). Embedding dedup, not string match.

### 3. Measure
One web page. Four numbers:
- **Questions logged this week**
- **Duplicates avoided** — your L1→L2 proof metric
- **Top topics** — what the team keeps getting stuck on; signal for real docs
- **Onboarding index** — questions asked by people <30 days in the repo

That dashboard is how you prove adoption to a manager. It directly answers the brief's *"AI adoption must be measured"* requirement — which Trailhead had no answer for.

---

## Architecture — one slide

```
AI Client (Claude Code / Cursor / Claude Desktop / Zed)
           │
           │  MCP protocol
           ▼
      Hive MCP Server (local, Node.js)
           │
           ├──► .hive/qa.jsonl  (per-folder, git-tracked)
           │     {q, a, asker, date, file_refs, embedding}
           │
           └──► Hive Dashboard (Next.js, reads .hive/ from repo)
```

No database. No auth. No cloud. Runs entirely local. Dashboard is `next dev` on localhost.

---

## Demo script — 2 minutes, 3 beats

### Beat 1 — the pain (20s)
Flash the stat: 76% of engineers use AI daily, <10% of teams systematize it. Every prompt reinvented, every insight lost.

### Beat 2 — the "Already Asked" moment (50s)
**Persona:** Radu, 2 weeks into a Romanian fintech.

- Radu asks Claude Code: *"ce face `ChargeProcessor.settle`?"*
- MCP server intercepts, finds Andrei's question from Tuesday, injects it as context.
- Claude answers with exact file:line citation, plus: *"Andrei asked this Tuesday — the team rule: all settle operations go through idempotency key X. He shipped it in PR #847."*
- **Radu learns in 30 seconds what took Andrei 20 minutes and a Slack thread.**

### Beat 3 — the compounding reveal (40s)
Cut to the dashboard:
- 47 questions this week, 12 duplicates caught (**26% deduped — that's your L1→L2 metric**)
- Top topic: "webhook retry logic" asked 5 times this week → clear signal someone should write a real doc
- 8 of 47 questions came from engineers <30 days in the repo — your onboarding curve, made visible

### Close (10s)
> *"We didn't build another AI tool. We built the reason your team's AI adds up to something."*

---

## 12-hour build plan

| Hours | Ship |
|---|---|
| 0–2 | MCP server skeleton, `hive.log` + `hive.search` tools, writes `.hive/qa.jsonl` |
| 2–4 | Embedding dedup (OpenAI `text-embedding-3-small`, cache locally) |
| 4–7 | Dashboard: the 4-number page + question list + topic clusters |
| 7–9 | Demo repo: pre-seed with 40 realistic Q&As across 4 topics |
| 9–11 | Polish the before/after moment, cache demo LLM calls, rehearse |
| 11–12 | Buffer for demo breakage |

---

## Anticipated questions (the ones that actually matter)

**"Isn't this Cursor memories / ChatGPT team folder?"**
Cursor memories are per-user and per-IDE. ChatGPT team folders are manually curated. Hive is repo-native, per-team, auto-captured, attributed, and tied to file paths. And it works across every MCP client, not just one vendor.

**"What about privacy? Q&A exposes what the team doesn't know."**
Git-tracked. PR-reviewable. Redact-before-commit is a one-line config. Same trust model as commit messages — teams already know how to handle this.

**"Cold start?"**
Pre-seeded demo repo. Honest answer for real deployment: useful after ~20 questions, compounding after ~100. Don't hide this — show the compounding curve.

**"Why not Notion / Confluence / Slack?"**
Those are push-based — someone has to remember to write. Hive is capture-at-source: the act of using AI *is* the act of contributing. Zero marginal effort.

**"How is this novel if Cursor already has nested rules?"**
Nested rules are declarative ("here's how to code"). Hive is episodic ("here's what the team has actually asked and learned"). Different artifact, different failure mode of the status quo.

---

## The three things that genuinely differentiate

Memorize these. They are what survives contact with a skeptical judge.

1. **Git-native storage.** Nobody else stores AI team memory in the repo itself. Cursor, ChatGPT, Notion, Slack — all centralized. That means no infra, no auth, no vendor lock, AND it travels with the code on fork/clone.

2. **Vendor-neutral via MCP.** Cursor Rules lock you to Cursor. Copilot instructions lock you to GitHub. Hive works with any MCP client. Three years from now when the IDE landscape shifts again, Hive still works.

3. **Measurement built-in.** The dashboard's dedup rate *is* the L1→L2 metric the brief demands. No competitor ships an adoption metric; they sell capabilities. You sell the proof that adoption is happening.

---

## Optional extensibility angle (for the Q&A only)

The same `.hive/qa.jsonl` pattern works for non-software engineering: an MEP engineer's questions about EU standards, a civil engineer's code-interpretation decisions. Don't demo this (scope). Have the answer ready — it signals vision beyond software, which addresses the "software-only persona" weakness called out in the organizer brief.

---

# Appendix A — Issues found in Trailhead (`Idea_Pitch.md`)

These are the weaknesses that forced this re-pitch.

### 1. The L1 → L2 target was under-owned
The organizer said L0 → L1 is "often winning" and L3 → L4 is "a trap." Trailhead picked the middle path without justifying why. Hive v2 owns L1 → L2 by making the adoption dashboard the proof artifact.

### 2. The space is the most saturated in AI tooling
Trailhead's core primitives already ship elsewhere:
- **Nested rules per folder** → Cursor `.cursor/rules/*.mdc`, Claude Code nested `CLAUDE.md`, industry-wide `AGENTS.md` convention.
- **Context routing / token efficiency** → Cursor, Windsurf, Claude Code, Cody, Continue.
- **Auto-generated repo docs** → Mintlify, Swimm, readme.ai, Greptile, Bloop.
- **Rule injection into AI output** → Cursor Rules, Copilot custom instructions, Claude Code hooks.

The defensive answer ("we're a context router, not a doc generator") didn't land because Cursor *is* a context router. v2 drops these framings entirely and leads with the one thing nobody ships: team Q&A as a first-class artifact.

### 3. Software-only persona is a stated liability in the brief
The organizer explicitly highlighted MEP, civil, automotive, architecture as under-served. Trailhead flagged this as a risk but didn't address it. v2 still demos software (scope), but keeps the extensibility story ready for Q&A.

### 4. Post-commit regeneration has real operational problems
Squashed commits skip hooks. Per-commit LLM calls cost real money. Stale branches diverge. PR noise from auto-generated files is disliked. Merge conflicts on `.wiki/*` are painful. Teams have tried auto-docs for a decade and turned them off. v2 captures at the MCP boundary instead — every question passes through naturally, no hook required.

### 5. No measurement story
The brief emphasizes that adoption *must be measured*. Trailhead had no dashboard, no L1→L2 signal, no ROI artifact for a manager. This was a theme gap, not a product gap. v2 fixes it with the 4-number dashboard.

### 6. Pitch was inside-baseball for developers
"Token efficiency" and "context routing" don't resonate with mixed judging panels the way a vivid before/after demo does. v2 leads with Radu's 30-second learning moment.

### 7. Scope risk in 24h
Indexer + Router + Logger + MCP server + VS Code extension + rule-enforcement hooks = high odds of a broken demo, which Trailhead itself named as the failure mode. v2 cuts to three features, one form factor, 12-hour build.

### 8. The "Git for AI prompts" analogy at the bottom was disconnected
It was the strongest framing in the whole doc but orphaned in a footer. v2 elevates it to the one-sentence pitch.

---

# Appendix B — Issues found in the original `ideas/Hive.md`

Hive was much closer to the right answer than Trailhead, but still over-scoped.

### 1. 36-hour build plan is a demo-risk machine
Turborepo + Postgres + pgvector + Clerk + Neon + Vercel + Railway + Slack + browser extension + VS Code extension + MCP + k-means + RAG distillation — all in one hackathon. v2 cuts to one MCP server + one Next.js page. Ships in 12h.

### 2. Centralized infra undermines the pitch
"Your team's knowledge lives in *your* repo" is a better story than "your team's knowledge lives in our Postgres database." Git-native storage removes auth, infra, privacy concerns, and vendor lock in one move.

### 3. Per-session opt-in privacy model conflicts with compounding
If capture defaults to off, most sessions are never captured, and the network effect the pitch relies on never starts. v2 uses git-tracked storage: the privacy control *is* PR review, which engineers already understand.

### 4. Stat used ("76% daily AI use") undercuts the target
If 76% are at L1 already, that's an argument *for* L1 → L2 but it also implies individual adoption is done — so anything below team systematization is table stakes. v2 keeps the stat but reframes it as "individual adoption is saturated; team adoption is the real gap."

### 5. k-means clustering + LLM wiki distillation is the wrong MVP feature
It's a 6-hour feature with a high "bland output" failure mode. The `qa.jsonl` + dashboard already tells the compounding story. Distillation is a v2 feature, not a demo feature.

### 6. "Surveillance" framing risk was acknowledged but not defused
Calling it "team memory" helps, but the real defuser is: *git-tracked means the engineer controls every commit*. v2 makes this the primary privacy answer.

### 7. Browser extension + Slack bot + VS Code extension dilute the core
MCP alone covers Claude Code, Cursor, Claude Desktop, Zed, Continue. Shipping one integration that covers five tools is better than shipping five integrations that each cover one tool.

---

# Appendix C — Genuine advantages (what survived the critique)

These are the parts of the original pitches that were real differentiators and carry into v2.

1. **Q&A log as a first-class repo artifact.** Nobody ships this. Cursor memories, ChatGPT team folders, Slack threads — all fail on attribution, persistence, or searchability. This is the single strongest idea across both original docs.

2. **Embedding-dedup on team questions.** "Andrei asked this 3 days ago" is a measurable productivity win AND the source metric for the adoption dashboard.

3. **MCP-first, vendor-neutral.** Survives IDE churn. Works across Claude Code, Cursor, Claude Desktop, Zed, Continue without per-tool integration work.

4. **Folder-scoped storage survives refactors.** Unlike centralized knowledge tools, `.hive/qa.jsonl` moves with the code it describes when a folder gets renamed or extracted.

5. **Onboarding attribution.** "New hire inherited the team's AI memory on day 1" is a concrete, demoable outcome — a thing no competitor can show.

6. **Measurement as the theme answer.** The dedup rate *is* the L1 → L2 proof. The brief demands measurement; this product produces it as a side-effect of normal use.

---

## TL;DR

Cut Trailhead's rule engine and auto-docs. Cut Hive's centralized infra and extension sprawl. Ship one MCP server + one dashboard. Lead with the "Already Asked" demo moment. Own L1 → L2 by putting the adoption metric on screen. 12 hours of build, 2 minutes of demo, one artifact the market doesn't have.
