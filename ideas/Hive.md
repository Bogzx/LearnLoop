# Hive — The Team AI Brain

> Working name. Other candidates: Wavelength, Recall, Common, Atlas, Echo, Prism.

> One-sentence pitch: Every AI session in your team flows into a living, searchable, AI-queryable team wiki — so nobody reinvents what a teammate already solved, and institutional AI memory compounds instead of dying in private browser tabs.

---

## The insight

- 72–76% of software engineers use AI daily. **Individual adoption is saturated.**
- <10% of teams have systematized that use (shared prompts, `.prompts/`, conventions that stick).
- Every AI session is invisible to the rest of the team. Every prompt is reinvented. Every insight is lost.
- **The L1→L2 gap is the real gap for software engineering teams**, and the hackathon brief explicitly calls this the hardest transition.

Hive closes that gap by making individual AI use automatically compound into collective team intelligence — no manual sharing required.

---

## The four pillars

### 1. CAPTURE — every AI session flows into team memory
Seamless, privacy-first ingestion from wherever your team is actually using AI:

- **Claude Code MCP server** — primary integration. Exposes `hive.search(query)`, `hive.log(session)`, `hive.ask_wiki(question)` tools. Claude Code can call them autonomously mid-conversation.
- **VS Code / Cursor extension** — captures chat, inline completions accepted, and associated commits.
- **Browser extension (Plasmo)** — captures Claude.ai / ChatGPT / Gemini web sessions.
- **CLI wrapper** — for terminal AI tools.

**Privacy is the whole game:**
- Per-session opt-in toggle (default: off, user opts in per session or globally).
- Automatic PII + secret redaction before storage (API keys, emails, tokens scrubbed).
- Team-scoped: data never leaves your tenant.
- User controls what gets shared, what stays private.

### 2. SEARCH — "Already Asked" with pre-emptive suggestions
Before you fire a prompt, Hive shows semantically similar teammate sessions.

- pgvector semantic search, sub-second latency
- Inline in your IDE: *"Priya solved something similar 3 days ago — [View session] [Adopt her prompt]"*
- One-click "adopt" forks her prompt into your session, with your context substituted
- Keyword + vector hybrid search for the web dashboard
- Filters: by author, by project, by outcome (merged commit vs. abandoned), by recency

### 3. WIKI — the Karpathy angle
**The differentiator.**

Karpathy's LLM OS vision: an LLM that knows everything about *you* — a personal context that compounds forever. Hive extends this to teams.

Every captured session feeds a living auto-organized wiki:

- Background job clusters sessions by topic via embedding k-means
- Claude Haiku distills each cluster into a wiki page
  - *"Payment Retry Logic"*, *"Auth Token Validation"*, *"Webhook Patterns"*
- Pages interlink automatically (like Obsidian, but generated)
- Evergreen — updates as new sessions arrive, deprecates outdated info
- **Askable via RAG** — "What do we know about rate limiting?" → Hive answers from the team corpus, citing source sessions and the engineer who taught the team that pattern

**Pitch line:** *"Your AI knows everything your team has ever learned."*

### 4. COLLABORATION — make AI a team sport
- **Team feed** (Slack + web): "3 notable sessions your team had yesterday"
- **Prompt graduation:** prompt reused 3+ times → auto-promoted to team `.prompts/` template, opens a PR to your repo
- **Reactions & comments** on sessions ("Nice prompt 🔥", "Try adding X context")
- **Real-time presence** (stretch): see who's prompting what right now, jump into a pair-prompt session
- **Weekly digest:** top-adopted prompts, most-cited teammates, new wiki pages

---

## Adoption level shift

**L1 → L2** — clean, unambiguous.

Individuals at L1 (already using AI alone) generate data that Hive compounds into L2 (shared, systematized team intelligence) with zero additional manual effort. The behavior change happens passively.

Secondary: feeds L2 → L3 by producing high-quality team-specific prompts that become agent seeds.

---

## Tech stack

### Monorepo
- Turborepo + pnpm
- Shared TypeScript types across extension + web + backend

### Frontend / UI
- **Web dashboard:** Next.js 15 (App Router) + React + Tailwind + shadcn/ui
- **VS Code extension:** TypeScript + VSCode API + WebView for richer UI
- **Browser extension (stretch):** Plasmo framework
- **Slack integration:** Bolt.js SDK

### Backend
- Node.js + TypeScript
- **API framework:** Hono (fast, edge-deployable)
- **Database:** PostgreSQL + pgvector on Neon or Supabase (structured + embeddings in one place)
- **Auth:** Clerk with GitHub OAuth (team mapping automatic via GitHub orgs)
- **Real-time:** Pusher or Server-Sent Events
- **Background jobs:** Trigger.dev or simple node-cron for clustering + wiki regeneration

### AI / ML layer
- **Embeddings:** OpenAI `text-embedding-3-small` — $0.02 / 1M tokens, fast, good quality
  - Fallback: local via Transformers.js + BGE for privacy-sensitive teams
- **Clustering:** k-means on embeddings (background job, runs hourly)
- **Wiki distillation:** Claude Haiku 4.5 — cheap bulk summarization
- **Wiki query / RAG:** Claude Sonnet 4.6 with prompt caching (huge savings when multiple users query same wiki context)

### Infra
- Vercel (web + API)
- Railway or Fly.io (background workers)
- Neon (Postgres)
- PostHog (product analytics, free tier)
- GitHub Actions (CI)

### Ship-priority integrations
1. **Claude Code MCP server** — biggest demo punch, minimal surface
2. **VS Code extension** — broadest reach
3. **Web dashboard** — for wiki, feed, admin
4. **Slack bot** — daily digest, stretch
5. **Browser extension** — captures web AI tools, stretch

---

## Build plan — 24–36 hours

### Hours 0–6 — foundation
- Turborepo setup, pnpm workspaces
- Postgres + pgvector schema: `teams`, `users`, `sessions`, `prompts`, `clusters`, `wiki_pages`
- Clerk auth with GitHub OAuth
- Ingest API: `POST /sessions` → store + embed

### Hours 6–12 — capture + search
- **Primary:** Claude Code MCP server exposing `search` / `log` / `ask_wiki` tools
- Alt: VS Code extension with manual "Log session to Hive" + auto-capture toggle
- Semantic search endpoint, keyword + vector hybrid

### Hours 12–18 — web app + team feed
- Next.js dashboard
- Team timeline (recent sessions)
- Search page (filters, faceted)
- Prompt library page with graduation logic (3+ reuses → template)

### Hours 18–24 — the wiki magic (the differentiator)
- Background job: cluster sessions via k-means on embeddings
- Per-cluster LLM distillation → wiki markdown page
- Wiki viewer in dashboard (markdown render, inter-page links)
- RAG endpoint: "ask the team brain"

### Hours 24–32 — collaboration + polish
- Comments + reactions on sessions
- One-click "adopt this prompt" → opens PR to team repo
- Slack integration: daily digest bot
- Seed the demo team with 30–50 realistic sessions (PRE-MADE, so the demo is not empty)
- Visual polish pass

### Hours 32–36 — stretch + rehearsal
- Real-time presence
- Export prompts to `.prompts/` folder via automated PR
- Leaderboards
- Rehearse the 3-minute demo three times, time it, refine

---

## Demo script — 3 minutes

### Hook (30s)
*"Your team uses AI every day. But every session dies alone in a private browser tab."*

Flash stats slide:
- 76% of engineers use AI daily
- <10% of teams systematize it
- Every prompt is reinvented; every insight is lost

*"We're building the collective AI brain for engineering teams."*

### Demo 1 — the "Already Asked" moment (60s)

Split-screen: Alice and Bob, same team, two laptops.

- Two days ago, Alice worked through "payment retry logic in our codebase" in Claude Code — 5-turn session, landed a great pattern, committed.
- Today Bob, in Claude Code, types: *"how do I add retry logic to the webhook handler?"*
- **Hive's MCP server intercepts:** Claude Code automatically calls `hive.search` and surfaces Alice's session.
- Claude Code shows Bob: *"Alice solved a similar problem 2 days ago. [View] [Adopt her prompt]"*
- Bob clicks adopt. Claude Code re-runs with Alice's hardened prompt + Bob's context.
- **Bob ships in 3 minutes what took Alice 15.**

### Demo 2 — the wiki reveal (60s)

Zoom out to the team dashboard.

*"After a month of use, Hive has auto-generated your team's AI wiki."*

Show the wiki:
- *Payment Retry Logic*
- *Auth Token Validation*
- *Webhook Ordering*
- *Rate Limiting Patterns*

Each page is distilled from real sessions, linked to source prompts, continuously updating.

Ask the wiki live: *"What do we know about rate limiting?"*

Hive answers from the corpus, citing the engineer whose session taught the team that pattern.

**Drop the Karpathy line:** *"This is Karpathy's LLM-OS vision applied to teams. Your AI doesn't just know the world — it knows everything your team has ever learned."*

### Close (30s)

Three outcomes:
1. No one reinvents what a teammate already solved.
2. Team knowledge compounds instead of decays.
3. A new hire on day 1 inherits the team's full AI memory.

*"We didn't build another AI tool. We built the reason your team's AI actually adds up to something."*

Adoption level: **L1 → L2** — the gap the brief itself calls the hardest.

---

## Sales angles per judge type

### Hackathon rubric
- **Innovation:** Karpathy-inspired team AI-wiki is novel and memorable.
- **Execution:** Full stack — MCP + IDE + web + AI + realtime.
- **Impact:** Directly attacks the L1→L2 gap the brief explicitly calls out as hardest.
- **Presentation:** Visceral before/after demo, clear pitch, concrete metrics.

### Engineer judges
*"Your team's AI knowledge is compounding for your competitors. Yours is decaying. We fix that."*

- Duplicate-prompt waste is real and daily.
- The "I swear somebody on this team already figured this out" frustration is universal.
- Onboarding shortcut that beats any README.

### Manager / CFO judges
- **Duplicate API spend:** if 10 engineers prompt the same thing, that's 10× the token cost. Hive drops team token spend 30–40% via reuse.
- **Onboarding:** new hire has full team AI memory from day 1. Cut ramp time in half.
- **Measurable adoption:** Hive itself provides the L1→L2 metric — % of team members whose prompts contributed to a reused template.

### European / compliance judges
- Per-session opt-in. Full user control.
- Automatic PII + secret redaction pre-storage.
- Team-scoped, tenant-isolated storage. Data never leaves your environment.
- AI Act friendly: auditable session log, explicit reuse tracking.
- GDPR: users can delete their sessions; redaction is default.

---

## Differentiators

| vs. | How Hive is different |
|-----|-----------------------|
| Cursor team features | Cursor silos sessions per user. Hive makes them collective. |
| Notion / Confluence | Manual documentation. Hive auto-organizes from real AI work. |
| ChatGPT Enterprise team folder | Static shared folder. Hive is a living, semantically searchable, pre-emptive wiki. |
| PromptHub / prompt marketplaces | Abstract and generic. Hive's prompts come from your team's real battle-tested sessions. |
| Internal Slack threads | Unsearchable, forgotten. Hive is structured + semantic + queryable. |
| Manually maintained `CLAUDE.md` | Goes stale in weeks. Hive updates continuously from real usage. |

---

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Privacy concerns around prompt capture | Per-session opt-in (default off), automatic PII/secret redaction, team-scoped storage, on-prem option |
| Critical mass problem — wiki needs data | Seed the demo team with 30–50 high-quality synthetic sessions; pitch network-effect: "value grows exponentially as your team uses it" |
| "Feels like surveillance" | Frame as team memory, not boss oversight. User always controls what's shared. No manager-only views; transparent to all team members. |
| MCP integration is new / possibly buggy | Ship VS Code extension as fallback primary; MCP as stretch/showcase |
| Karpathy framing too niche for some judges | It's a pitch device, not the product. Lead with "team AI wiki" → invoke Karpathy as a credibility tag for the Karpathy-aware judges. |
| Wiki distillation produces bland summaries | Few-shot the prompt with great examples; include source citations so users can verify; allow humans to edit wiki pages. |
| Duplicates of duplicates — hive grows noisy | Dedup logic on embedding similarity; auto-archive sessions >90 days untouched. |

---

## One-liners for different contexts

- **Formal:** *"A collective AI knowledge platform that turns every engineer's AI session into shared team intelligence."*
- **Karpathy nod:** *"The LLM OS, but for teams — every prompt feeds the team brain."*
- **CFO:** *"Stop paying for the same AI answer ten times."*
- **Engineer:** *"Before you prompt, check if your teammate already did. After you prompt, your team learns too."*
- **Manager:** *"Onboarding day 1 = your new hire inherits the team's AI memory."*
- **Skeptic:** *"We didn't build another AI tool. We built the reason your team's AI actually adds up to something."*

---

## Future / v2

- **Cross-team leak control:** org-wide wiki for shared domains (security, infra), team-local for product.
- **Prompt quality scoring:** measure which prompts produce merged commits vs. abandoned sessions. Rank library accordingly.
- **Adoption Compass built-in:** the team's own dashboard showing L1→L2 progression metrics, friction reports.
- **Model-agnostic replay:** re-run an old session against a new model to see quality delta.
- **Incident learning:** when a postmortem is filed, Hive surfaces AI sessions that touched the affected code in the prior month.
- **Pair-prompt rooms:** synchronous co-prompting like Figma for AI.
- **Knowledge decay warnings:** flag wiki pages whose source sessions are all >90 days old — maybe the pattern is outdated.

---

## TL;DR

Software engineers are already at L1 (76% daily AI use). The real gap — and what the brief rewards — is L1→L2 (team systematization). Hive closes it automatically: capture every session, search before you prompt, distill into a living team wiki, graduate prompts into templates. Karpathy's LLM-OS for teams. Dramatic demo. Clean adoption-level story. Zero manual sharing overhead. The hackathon shape.
