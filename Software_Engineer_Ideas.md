# Software Engineer AI Adoption — Deep Idea Pool

> Pivot from the MEP-engineer audience (NormativAI) toward software engineers — the domain where we have ground-truth expertise. This document enumerates the idea space, tiers it, and makes a recommendation.

---

## 0. Why Pivot (and what we give up)

### What we gain by targeting software engineers
- **We are the user.** Domain-learning risk drops to zero. We don't have to guess what pain MEP engineers feel — we know what Cursor/Copilot/Claude Code feel like every day.
- **Ground-truth demos.** We can demo on our own code, not on scraped PDFs we half-understand.
- **Judge alignment.** PoliHack judges are CS students + industry engineers. Our persona *is them*. They'll recognize the pain in half a sentence.
- **Iteration speed.** We can test the product on ourselves in real time — no domain expert required in the room at 3am.
- **Technical depth is natural.** Dev-tool plumbing (AST, MCP, LSP, git hooks, CI) is our native habitat.

### What we give up vs. NormativAI
- **The "first in Romania" uniqueness narrative.** NormativAI has a clean market gap; SWE ideas fight global incumbents (Cursor, Copilot, Continue, Aider, Cody).
- **The L0 persona that the organizer literally named.** MEP engineer with a mouse + EU standards was his example.
- **Pre-validated judge sympathy.** He said it. We'd be aligning against his headline example.

### Resolution
The audience pivot is only worth it if the SWE idea has **equivalent defensibility** — i.e., a narrow, specific persona with a real gap nobody serves. Generic "AI for devs" loses to NormativAI because NormativAI has a named, under-served market. The SWE idea needs the same.

**The candidates below are filtered for that property:** specific persona, real gap, demo that doesn't evaporate under scrutiny.

---

## 1. Rules of the Game (compressed from brief + kickoff)

- **Adoption levels:** L0 (none) → L1 (personal prompting) → L2 (team-shared prompting) → L3 (repo contains agents) → L4 (orchestrated agentic DAGs).
- **L0→L1 explicitly wins if executed well.** The "trap" is pushing the *user* from L3→L4 — NOT having L4-grade internals.
- **Sophisticated brain behind a boring surface is the winning architecture.**
- **Real user, real pain. No fridge-AI.**
- **Measurement matters.** The brief emphasizes it; a measurement layer scores well on theme.
- **Non-software engineering is encouraged** — but we can credibly stay in software if our angle is non-generic.
- **Form factor is open.** CLI, IDE extension, GitHub App, desktop, hardware — all valid.

---

## 2. The Idea Universe (30 ideas, one line each)

Organized by the level transition the *user* makes. Parenthetical = rough novelty score (1 = crowded, 5 = uncontested).

### L0 → L1 (a named user who today uses no AI)

| # | Name | One-line | Novelty |
|---|------|----------|---------|
| 1 | **Glass** | Turnkey offline AI dev stack for engineers in compliance-locked orgs (banks, defense, healthcare, gov). | 5 |
| 2 | **LegalDevAI** | RAG + IDE nudges over Romanian software law (GDPR-RO, DORA, NIS2, eIDAS, AI Act) for fintech/medtech devs. | 4 |
| 3 | **Onboarding Agent** | Repo-aware first-week coach for new hires who've never used AI on a real codebase. | 3 |
| 4 | **SimSim** | Simulated bug-fix environment that grades how well a learner collaborates with AI (educational). | 3 |
| 5 | **Whisperer** | Voice-first IDE-AI for engineers with RSI / visual impairment — accessibility-constrained L0. | 3 |
| 6 | **Embedded Pairing** | Firmware/embedded-C engineers are near-L0 because cloud AI doesn't fit their flow; local model + hardware awareness. | 4 |

### L1 → L2 (individual prompters into shared, systematized practice)

| # | Name | One-line | Novelty |
|---|------|----------|---------|
| 7 | **ContextForge** | Repo-aware context packager + team "context recipe" library, MCP-exposed. | 3 |
| 8 | **Rulebook Live** | Continuously-updated, living `CLAUDE.md`/`.cursorrules` generated from actual codebase behavior. | 4 |
| 9 | **PromptLint** | ESLint/pylint-style static analysis for prompt strings embedded in production code. | 4 |
| 10 | **Stable Prompts** | pytest-for-prompts — write assertions, run in CI, block regressions. | 3 |
| 11 | **Switch** | Intelligent model router + visual debugger showing why-this-model-was-chosen. | 2 |
| 12 | **Context Bench** | The organizer's own example — VS Code extension that teaches token/context efficiency visually. | 3 |
| 13 | **PairProof** | Gentle interrogator that asks "what does this do?" before you accept AI output — juniors especially. | 4 |
| 14 | **Acumen** | 30-min diagnostic that scores your AI-collaboration skill and prescribes next steps. | 4 |
| 15 | **AI Culture Contract** | Facilitator that helps a team write a shared AI-usage charter, versioned in the repo. | 3 |
| 16 | **PRompt** | Given an AI coding session + diff, produce a high-quality PR description the reviewer actually reads. | 2 |

### L2 → L3 (team practice into agent-in-repo)

| # | Name | One-line | Novelty |
|---|------|----------|---------|
| 17 | **Aegis** | Multi-agent security reviewer specifically for AI-generated diffs (hallucinated deps, stale crypto, secret echo, license smells). | 5 |
| 18 | **Ledger** | AI provenance for every commit — model, prompt hash, rules version — with cryptographic attestation and review overlay in GitHub. | 4 |
| 19 | **AgentCI** | CI bot that reviews AI-generated PRs on axes human review misses (hallucinated imports, stale SDK calls, tautological tests). | 4 |
| 20 | **DIFF-AI** | Semantic diff viewer that surfaces the *actually-novel* lines in a 500-line AI PR, hides the cosmetic refactors. | 4 |
| 21 | **TestGen Verifier** | Agent that mutation-tests AI-generated tests — catches the tautological "assert True" style regression. | 4 |
| 22 | **AI Linter** | Detects "AI-slop" code smells (over-defensive, boilerplate-heavy, redundant guards) and suggests simplification. | 4 |
| 23 | **Git Blame for AI** | Line-level AI provenance — "which prompt produced this?" — tracing back session + model + rules. | 4 |
| 24 | **Sentry-to-PR** | Agent that ingests a production error and ships a draft fix PR with repro test. | 3 |
| 25 | **Flakehunter** | Agent that roots-causes flaky tests by replaying + bisecting + reasoning about timing assumptions. | 4 |
| 26 | **ShipIt** | Validates AI-generated Terraform/K8s/Helm against real cluster/cloud APIs before apply. | 3 |
| 27 | **CR²** | Code-review-for-code-reviewers — overlays an AI-aware checklist on human-led PR reviews. | 3 |

### Cross-cutting / measurement layer

| # | Name | One-line | Novelty |
|---|------|----------|---------|
| 28 | **Traces** | Adoption dashboard: per-engineer / per-team / per-org AI-adoption level scored from git + IDE signals. | 4 |
| 29 | **Copilot Observability** | Narrow slice of Traces — ROI dashboard specifically for paid Copilot/Cursor seats. | 2 |
| 30 | **Adoption Ladder** | Gamified "where am I, where do I go next" personal adoption tracker w/ badges. | 2 |

---

## 3. Tier List

### Tier S — highest win probability
- **#1 Glass** — uncontested persona (regulated-RO engineers), visceral demo (airplane mode), 5/5 novelty, European-adoption-gap narrative writes itself.
- **#17 Aegis** — untouched niche (AI-specific security review), multi-agent architecture is natural, concrete per-finding demo.
- **#7 ContextForge** — organizer pre-endorsed adjacent space, L1→L2 is literal, token-cost-delta demo is irrefutable.

### Tier A — strong contenders
- **#2 LegalDevAI** — inherits NormativAI's "first in RO" DNA, now in our domain.
- **#18 Ledger** — AI provenance is a real and growing gap; GitHub App surface is clean.
- **#28 Traces** — measurement is what the organizer explicitly asked for.
- **#8 Rulebook Live** — clean L1→L2, self-maintaining rules is defensible.

### Tier B — viable but lower ceiling
- #12 Context Bench, #22 AI Linter, #19 AgentCI, #20 DIFF-AI, #9 PromptLint, #25 Flakehunter, #21 TestGen Verifier

### Tier C — skip (crowded, weak story, or mismatched)
- #11 Switch (crowded space; organizer named it so competitors will pick it)
- #29 Copilot Observability (too BI, undersized)
- #30 Adoption Ladder (fluff risk)
- #24 Sentry-to-PR, #26 ShipIt (Sentry AI, Pulumi AI already exist)
- #14 Acumen, #4 SimSim, #15 AI Culture Contract (education / soft — hard to demo in 3 min)

---

## 4. Deep Dives — Top 6

Each dive follows the same frame: **Persona → Surface → Hidden depth → Why it wins → Risks → Demo beat-by-beat → Pitch anchor.**

---

### 4.1 Glass — Offline AI Dev Assistant for Regulated Europe

**Thesis:** Romanian banking, defense, healthcare, and public-sector engineers are at L0 *by policy*, not by choice. Cloud AI is forbidden. The tools to make them L1 locally exist in pieces (Ollama, local embeddings, MCP) but are non-trivial to integrate. We ship the integration.

**Persona — explicit.**
- **Cosmin**, 31, senior backend at Banca Transilvania. Works on core-banking services. Policy: no source code may leave the corporate network. Today: L0. Uses Stack Overflow + internal wiki. Would kill for Copilot but cannot install it.
- Adjacent personas: DGA/SRI contractors, IAR Brașov embedded engineers, Ministerul Sănătății IT, Electrica SCADA engineers. Every one of them is policy-locked at L0.

**Surface (what the judge sees).**
- A single `docker compose up` on a laptop. Two minutes, one pull of a quantized Qwen2.5-Coder-32B (or DeepSeek-Coder-V2 16B, picked for speed on demo hardware).
- VS Code sidebar opens, points at the local endpoint, shows a chat pane and an inline-suggestion pane.
- **Wi-Fi toggled OFF on the laptop, on camera.** The model still answers. Retrieval still works over the indexed repo. This is the moment.
- Ask "refactor the Auth middleware to support RFC 7519 JWT validation" → get an edited file with cited lines from the repo, no network calls.

**Hidden depth (architecture slide).**
- **Local model tier** — Ollama runner, quantized coder model. Default Qwen2.5-Coder-32B-Instruct-Q5_K_M on 32GB laptop; fallback Qwen2.5-Coder-7B-Q4_K_M on 16GB.
- **Local embeddings** — `nomic-embed-code` or `bge-code-v1`, indexing the repo on first boot into a SQLite-backed vector store (sqlite-vec).
- **Repo context engine** — AST-aware chunker (tree-sitter), symbol graph, git-history-weighted relevance.
- **MCP server** — so the same backend plugs into Claude Desktop / Cursor / Cline when the user is on an unconstrained machine. (Keeps the L1→L2 story alive — policies evolve.)
- **Compliance story** — zero egress, audit log of every prompt, air-gapped mode switch, SBOM of every dependency shipped.
- **Model router** — local router that picks between the coder model (code tasks), an instruct model (chat/explain), and a tiny reranker model — directly the cost-consciousness the organizer praised, translated to compute-consciousness.

**Why it wins.**
1. **Uncontested audience.** No incumbent ships a turnkey offline dev-AI stack for EU regulated industries. GitHub Copilot Enterprise's "self-hosted" is a slideware marketing claim, not a product for a 5-person bank team. Tabnine Enterprise exists but costs enterprise dollars and is opaque.
2. **The WiFi-off demo is iconic.** You cannot fake it. Every judge understands it instantly.
3. **Romanian market math is real.** BCR, BT, Raiffeisen, ING-RO, BRD alone employ thousands of engineers. Add defense (IAR, Aerostar, Romarm), healthcare, SRI/STS, ANAF IT, and you have a four-figure paying-seat TAM in Romania that is *forced* to buy on-prem AI. DORA (2025), NIS2 (2024 transposition), and the EU AI Act (2026) are all tailwinds.
4. **Matches the organizer's thesis precisely.** He said: European adoption lags US; the hackathon is about pushing people up the ladder. Our claim: the reason European adoption lags is not cultural, it's regulatory — and regulation-compliant tools don't exist. We built the first one.
5. **Software-engineer expertise is fully utilized.** Quantization, runtime tuning, MCP protocol work, IDE extension, CLI UX, Docker/compose ergonomics — our native skillset.
6. **L0→L1 transition is verifiable and constraint-driven.** Nobody can dispute that Cosmin is L0. Nobody can dispute he becomes L1 after `docker compose up`.

**Risks & mitigations.**

| Risk | Likelihood | Mitigation |
|---|---|---|
| Model latency embarrasses us on demo hardware | Medium | Ship with queries pre-warmed + KV-cached. Rehearse on the exact laptop we demo on. Pick a 7B fallback model as insurance. |
| Judges dismiss "offline Ollama" as non-novel | Medium | The novelty isn't running a model locally — it's the full stack (context engine, MCP, IDE, compliance mode) shipped turnkey. Make this explicit on the slide. Also: lead with the persona, not the tech. |
| Local model produces bad code in demo | Medium | Pre-pick two queries with known-good answers. Rehearse. Have a backup query. |
| "Anyone can `ollama run` a model" rebuttal | High | Counter head-on: "Yes, and Cosmin at BT cannot, because no-one has shipped the integration, the compliance mode, the IDE plumbing, and the MCP bridge in one installable unit. That's the product." |
| Scope creep into "also solves everything" | High | Pick two features for demo (chat + inline-edit). Cut everything else. |

**Demo beat-by-beat (3 min).**
- 0:00 Persona slide — "Cosmin, BT, policy says no cloud AI, L0 forever." One hand shows. (Story beat.)
- 0:30 Wi-Fi off, on camera. Run `docker compose up`. (Trust beat.)
- 1:00 Open VS Code. Point sidebar at localhost:11434. Ask a repo question. Model answers citing lines. (Proof beat.)
- 1:45 Ask for an edit. Model produces a diff. Apply it. Tests still pass (pre-warmed). (Utility beat.)
- 2:15 Architecture slide. Quant model + repo index + MCP + IDE + compliance mode. Show the MCP server connecting Claude Desktop on a separate non-air-gapped laptop — same backend, different surface. (Depth beat.)
- 2:45 Market slide. Romanian banks + defense + healthcare = 4-figure seat TAM forced-buy. DORA / NIS2 / EU AI Act tailwind. (Close beat.)

**Pitch anchor line.**
> *"Romania's banks, hospitals, and defense engineers are at L0 by policy. Every tool on the market asks them to break policy. We asked: what if the tool respected the policy? Wi-Fi off, Copilot on — that's L0 to L1, and it's the only L0 to L1 that's legal to take in these sectors."*

---

### 4.2 Aegis — Security-Focused Review Agent for AI-Generated PRs

**Thesis:** AI-written code has a distinct security smell profile (hallucinated deps, deprecated crypto, secret echo, license confusion, supply-chain naivety). Traditional SAST was designed for human code and misses most of it. The *reviewer* — human or AI — needs a specialized lens.

**Persona — explicit.**
- **Tudor**, 36, application-security lead at a 200-engineer Romanian scaleup. Sees ~40 AI-generated PRs per week. Zero tooling designed for AI PRs specifically. Reviews by gut + SAST that wasn't built for this.

**Surface.**
- GitHub App. PR opens. Within 60 seconds a bot comment lands:
  - ❌ `fast_jsonify==0.3.1` — this package does not exist on PyPI. Did you mean `orjson`? (hallucinated-deps agent)
  - ⚠️ `hashlib.md5()` used for a session token — deprecated for security. (crypto-hygiene agent)
  - ❌ `API_KEY = "sk-proj-..."` in test fixture — looks like a real OpenAI key; please rotate. (secret-echo agent)
  - ⚠️ Block copied from a GPL-3 Stack Overflow answer — license incompatibility risk. (license-smell agent)
- Each finding links to the specific line, the specific reason, and the specific agent that flagged it.

**Hidden depth.**
- **Multi-agent verifier chain** — five specialized agents, each with its own tools and retrieval:
  1. **Dep-existence agent** — queries PyPI / npm / crates.io / pkg.go.dev for every import in the diff, confirms version exists, flags typosquats (Levenshtein ≤ 2 to popular packages).
  2. **Crypto-hygiene agent** — RAG over OWASP + NIST + CWE-327 guidance; flags MD5/SHA1 for security, weak RNGs, broken modes.
  3. **Secret-echo agent** — regex + entropy + format-family detector (OpenAI sk-, AWS AKIA, GitHub ghp_, etc.), plus LLM pass over any remaining suspicious string-literals.
  4. **License-smell agent** — fuzzy-match code blocks against a compressed index of popular GPL/AGPL-copyleft OSS, flags close matches.
  5. **Stale-SDK agent** — per-language knowledge of deprecated/removed APIs (e.g., `axios.create({timeout: null})`, Python 3.12 removals, K8s apiVersion drift).
- **Orchestrator** decides which agents to run on which files based on file type, flags aggregation, dedupe.
- **GitHub App** — standard webhook → annotate PR. Incremental: runs only on changed files.

**Why it wins.**
- **Novelty is high.** GitHub's CodeQL, Snyk, Semgrep — none are positioned as "AI-PR-aware." The five specific smells above are empirically what reviewers miss.
- **Security is respected by judges.** Unlike prompt-management, AI-security tooling has gravitas.
- **Multi-agent architecture is natural and honest** — each finding genuinely needs a specialized retrieval tool. This isn't agent-theater; it's how you'd actually build it.
- **L2→L3 is explicit.** The repo gains a reviewer-agent.

**Risks.**
- False positives will kill a demo. Solution: handpick three repos, handpick the demo PR, show real findings.
- Some findings overlap with existing linters — must lead with the findings those linters miss (hallucinated deps is the flagship).
- "Just use CodeQL" objection. Answer: CodeQL has no concept of hallucinated imports; it assumes imports are real.

**Demo.**
- 0:00 Persona: Tudor, 40 AI PRs/week.
- 0:30 Open a pre-staged PR. Bot comment lands live.
- 1:00 Walk through the five findings, emphasize the hallucinated-dep one — "this package does not exist. No human linter would catch this. CodeQL wouldn't. Cursor's own review wouldn't."
- 1:45 Architecture: five agents, orchestrator, why each agent is its own retrieval pipeline.
- 2:15 Market slide: OWASP 2024 report on AI-assisted dev security gaps, typosquat attack examples from 2024.

**Pitch anchor.**
> *"The uncomfortable truth of AI-generated code: every line compiles, every test passes, and the imports point at packages that don't exist. Aegis is the reviewer that reads AI code for what it actually is."*

---

### 4.3 ContextForge — Repo-Aware Context Packager + Recipe Library

**Thesis:** Engineers using Cursor/Claude Code burn 80%+ of their context window on irrelevant noise. They know it's wasteful, they don't know how to fix it, and there's no mechanism to *share* the good context configs they eventually discover. The fix is a context-engineering library + team recipe versioning.

**Persona.**
- **Alex**, 29, senior backend at a 100-dev RO SaaS. Pays €200/month for Cursor. Pastes 50 files into every chat. Knows it's dumb. Doesn't have time to tune it.

**Surface.**
- VS Code command: `ContextForge: Build context for "refactor auth middleware"`.
- Panel opens. Shows the optimizer's output:
  - **Recommended context (612 tokens):** `auth/middleware.py`, `auth/jwt.py` (symbols `validate_token`, `TokenError`), `config/auth.yaml`, last 3 commits touching auth/.
  - **Rejected context (3,981 tokens):** `tests/test_auth.py` (reason: reference test, not needed for refactor), `README.md` (reason: generic), `migrations/*.sql` (reason: unrelated schema).
- One click — piped into Cursor / Claude Code / Claude Desktop via MCP.
- Save as recipe: "auth-refactor" → versioned in `.contextforge/recipes.yaml` in the repo.
- Teammate runs `auth-refactor` recipe → gets same curated pack tomorrow.

**Hidden depth.**
- **Relevance scorer** — hybrid of:
  - Symbol-graph distance (tree-sitter + LSP) — how many hops from any identifier in the query?
  - Embedding similarity — standard.
  - Git churn weighting — files that changed often for queries like this in history rank higher.
  - Import-graph reach — close imports rank higher.
- **Token-budget optimizer** — a relaxed knapsack: maximize `Σ(relevance * inclusion)` subject to `Σ(tokens * inclusion) ≤ budget`.
- **Recipe versioning** — git-tracked YAML; the repo gets shared context primitives. **This is the L1→L2 move.**
- **MCP server** — exposes the `build_context(query)` tool to any MCP-compatible host.

**Why it wins.**
- Organizer pre-endorsed the adjacent idea ("VS Code extension that teaches context windows") — we're in his cone.
- **L1→L2 is structurally visible:** recipes are the versioned shared artifact.
- The demo is a single slide: "4,593 tokens → 612 tokens. Same answer. Costs 7x less. We just saved Alex €140/month."
- Technical depth (symbol graph + hybrid retrieval + MCP) is natural and well-known to ML-literate judges.

**Risks.**
- **Cursor and Claude Code already do repo context.** We have to differentiate on (a) teachability (*show the prune*), (b) cross-tool (MCP → any client), and (c) recipes (versioned, shared). Without those three, we're a clone.
- Token-budget math is easy to get wrong in a demo — pre-stage carefully.
- MCP is bleeding-edge; judges may not know what it means. Good — explain it on the slide; it makes us look current.

**Demo.**
- 0:00 Persona: Alex, €200/month Cursor, pastes too much.
- 0:30 Query. Show "naive Cursor" result: 4,593 tokens of input, 15 files, some good, mostly noise.
- 1:00 ContextForge result: 612 tokens, 4 files, same answer quality. Cost $0.02 vs $0.14.
- 1:30 Save as recipe. Commit to repo. Pretend to be the next engineer tomorrow — `contextforge load auth-refactor` → same curated pack.
- 2:00 Architecture: symbol graph + hybrid retrieval + token knapsack + MCP.
- 2:30 L2 story: "Everyone on Alex's team now inherits Alex's context engineering. That's the L1→L2 transition, written to git."

**Pitch anchor.**
> *"Cursor indexes your repo. We package the right 1% of it for the question you're asking — and we let your team share the packaging."*

---

### 4.4 LegalDevAI — Romanian Software-Law Assistant

**Thesis:** NormativAI, reshaped for our audience. Romanian software engineers in regulated domains (fintech, medtech, public sector, gov contracts) need to know GDPR-RO, DORA, NIS2, eIDAS, AI Act, Law 129/2019 (anti-money-laundering), Law 190/2018 (GDPR implementation) — and they today grep through PDFs like the MEP engineer. Same shape as NormativAI, same "first in RO" narrative, different vertical.

**Persona.**
- **Ana**, 33, engineering manager at a Bucharest fintech building PSD2 payment flows. Weekly, she asks "does this data flow need explicit consent under 190/2018?" and has no good answer. Legal costs €250/hour. Devs just guess.

**Surface.**
- IDE extension: as you write code that handles personal data, API tokens, or regulated operations, inline flags appear — "this looks like Art. 6 GDPR processing; basis?"
- Chat surface: "Can we store customer IBANs unencrypted in transit logs?" → cited answer from 190/2018 + PSD2 RTS + BNR circulars.

**Hidden depth.**
- RAG over RO software-relevant law — public, downloadable: Lege 190/2018, PSD2 transposition, Reg. BNR 3/2018, Lege 362/2022 (NIS2 transposition), EU AI Act text, DORA (Reg. EU 2022/2554), eIDAS 2.
- Multi-agent verifier (citation check + contradiction detection — crucial when laws reference each other).
- Code-aware surface: scans the diff for patterns — PII fields, auth flows, logging of sensitive data — triggers the legal check without the dev asking.
- MCP server exposing the corpus.

**Why it wins.**
- **Inherits NormativAI's DNA.** "First RO-language AI over RO software law." Same market-gap angle as MEP-NormativAI, same press-ready narrative.
- **Our expertise.** We know the data flows, we know the code shapes that trigger GDPR, we know what an auth-token smell looks like. No domain research required.
- **Regulatory tailwind is huge.** DORA (Jan 2025), NIS2 (RO transposition late 2024), AI Act (phased 2026), plus GDPR enforcement trajectory.
- **Demo is crisp:** type regex that captures IBAN into a log string, see legal flag appear with citation.

**Risks.**
- Competes with the NormativAI pitch directly — you're picking one. Pros/cons discussed in §6.
- Legal AI is a liability domain. We're not lawyers. We must frame as *research accelerator*, not *advice-giver*.
- Depending on "will the judges care about software law?" — CS judges may not; industry judges will.

**Demo.**
- Type `logger.info(f"user {email} paid {amount} to IBAN {iban}")` → inline flag: "Art. 5(1)(c) minimization; IBAN in logs without pseudonymization likely violates. Cite: 190/2018 Art. 12; BNR Reg. 3/2018 Art. 22."
- Chat for the deeper question. Cited response.
- Architecture reveal: RAG + verifier + MCP + code-aware trigger.

**Pitch anchor.**
> *"Your senior engineer doesn't know Romanian data-protection law. Your legal team doesn't know Python. LegalDevAI is the seam."*

---

### 4.5 Traces — AI Adoption Measurement Layer

**Thesis:** The brief says it three times: *"Measurement enables course correction and scaling."* No org has a real measurement stack for AI adoption. Traces is the dashboard — per-engineer, per-team, per-org.

**Persona.**
- **Radu**, 41, CTO at an 80-dev scaleup. Paid €40k for Copilot seats last year. Has no idea whether it helped. Boardroom question next week.

**Surface.**
- GitHub App + optional IDE telemetry (opt-in per engineer).
- Dashboard views:
  - **Engineer view** — "you're at L1.3. Two months ago you were L0.8. Here's the next habit to try."
  - **Team view** — distribution of adoption levels, cycle-time delta by level, merge-success delta.
  - **Org view** — adoption heatmap across teams; retention curve of new AI workflows (do they stick or evaporate after 2 weeks?).
- Privacy mode: no prompt content, only usage shapes.

**Hidden depth.**
- **AI-assisted commit detector** — this is the interesting ML problem. Signals: commit-message patterns, diff style (pure additions, specific idioms), timing patterns (burst vs. paced), perplexity-based classifier, or explicit opt-in signal from IDE plugin.
- **Adoption-level classifier** — rule-based + signals combined into level scores per engineer.
- **Outcome regression** — cycle-time, revert-rate, test-coverage-delta as a function of adoption level.
- **Recommendations engine** — "you've never committed with a `.claude/`-versioned rules file; here's a starter" — small nudges to next level.

**Why it wins.**
- **Directly matches the brief's measurement thesis.** Judges scoring on theme alignment will see it.
- **Addresses an objection the organizer has — "nobody uses what we build."** Traces is the instrument that would expose this.
- Adjacent product exists only inside GitHub (their Copilot metrics page), which is (a) GitHub-locked, (b) single-vendor, (c) shows usage not adoption level, (d) not available to orgs that mix Copilot + Cursor + Claude Code.

**Risks.**
- Feels like BI. Counter with: the L0→L4 classifier is a non-trivial ML problem, not BI.
- Hard to demo a dashboard without looking boring. Counter: pick one engineer's story arc — "here's Alex two months ago (L0.8), here's Alex today (L1.3), here's the single habit that moved him." Narrative beats charts.
- Privacy concerns — must be addressed head-on.

**Pitch anchor.**
> *"You can't scale what you don't measure. Everyone in this room will ship an AI tool this week. None of them know if the tool will be used in three weeks. We built the instrument."*

---

### 4.6 Ledger — AI Commit Provenance + Review Assistant

**Thesis:** A year from now, every commit in every repo will have AI contribution. Nobody has the provenance infrastructure for this. `git blame` says "Alex, 3 days ago." It should say "Alex, 3 days ago, via Claude 3.5 Sonnet, prompt hash ab12cd, rules v5, at 73% AI / 27% human edit." Ledger is that substrate.

**Persona.**
- **Ioana**, 38, tech lead reviewing 30 AI PRs/week. Needs signal on which ones to dig into. Also: six months from now an AI-generated regression will escape to prod and the postmortem will ask "why did that happen?" — nobody will have the answer.

**Surface.**
- Git hook on commit captures AI session metadata (which model, which prompt, which rules, which files).
- GitHub App shows an "AI Lineage" tab on every PR.
- Reviewers get an AI-aware checklist: "check hallucinated imports ✅, check tests actually assert behavior ✅, check licensing ✅."
- `git blame` extension shows AI lineage on hover.

**Hidden depth.**
- Session capture via IDE hook (VS Code / JetBrains / Cursor wrap).
- Cryptographic attestation — SLSA-inspired signed envelope per commit.
- Lineage storage — sidecar files in `.git/` or `.ledger/` directory; searchable.
- Review-assistant overlay — each AI commit triggers a specific multi-check pipeline (overlap with Aegis).

**Why it wins.**
- Compliance-future-proof — in a year, this will be regulatory in some sectors.
- Multi-agent verification on the review side gives real technical depth.
- GitHub App surface is clean, familiar, judge-friendly.

**Risks.**
- Scope creep — provenance + attestation + review-assistant is three products.
- Some overlap with GitHub's own nascent "AI commits" markers.
- If we skew toward the review-assistant side, we converge on Aegis — so pick one or commit to the broader story.

**Pitch anchor.**
> *"`git blame` tells you who wrote this line. Ledger tells you who wrote it, with what model, against what rules. That's the audit trail the next decade of software will need."*

---

## 5. Comparative Matrix (Top 6)

| Criterion | Glass | Aegis | ContextForge | LegalDevAI | Traces | Ledger |
|---|---|---|---|---|---|---|
| **Persona specificity** | 5 — RO bank/defense eng | 4 — security lead | 3 — any IDE user | 5 — RO fintech dev | 3 — CTO / eng mgr | 3 — tech lead |
| **Market gap** | 5 — uncontested | 4 — niche gap | 2 — crowded | 4 — RO-specific | 3 — partial | 3 — partial |
| **Demo visceral-ness** | 5 — WiFi-off moment | 4 — live finding | 4 — token delta | 3 — inline flag | 2 — dashboard | 3 — PR overlay |
| **Technical depth (hidden)** | 5 — quant + RAG + MCP + IDE | 5 — 5-agent pipeline | 4 — graph + knapsack + MCP | 4 — RAG + verifier + MCP | 4 — classifier ML | 4 — attestation + multi-agent |
| **Level transition clarity** | 5 — forced L0→L1 | 4 — L2→L3 | 4 — L1→L2 (recipes) | 4 — L0→L1 or L1→L2 | 5 — measures all | 4 — L2→L3 |
| **Organizer anchoring** | 5 — "EU lags" quote | 3 — generic | 4 — near his example | 4 — MEP-analog | 5 — measurement thesis | 3 — generic |
| **Our execution risk** | 3 — hardware demo risk | 3 — false-positive risk | 2 — low-risk build | 3 — legal-corpus risk | 4 — classifier takes time | 4 — multi-surface integration |
| **Story memorability** | 5 — "Wi-Fi off" | 4 — "the hallucinated import" | 3 — "7x cheaper" | 4 — "first RO software law" | 3 — "can't scale what you can't measure" | 3 — "git blame for AI" |
| **Total (of 40)** | **38** | **31** | **26** | **31** | **29** | **27** |

---

## 6. Recommendation

### Primary pick: **Glass**

The Winning_Strategy doc's architecture — *simple surface, sophisticated brain, named user* — applies identically to Glass. Better, in fact:

1. **The named user is more specific** than Maria the MEP engineer. Cosmin the Banca Transilvania engineer is *policy-locked* at L0. Maria *chose* L0; Cosmin *cannot leave* L0 without us. That's a stronger adoption story.
2. **The demo fails more gracefully.** NormativAI worst-case is wrong clause retrieval (a credibility hit on live stage). Glass worst-case is slower response — still works, still offline, still on-theme. The WiFi-off moment is built-in insurance.
3. **Our domain expertise reduces execution risk.** We don't need to acquire + OCR + chunk a Romanian-language technical PDF corpus in under 12 hours. We already know what a repo looks like.
4. **The market math is louder.** RO regulated-industries TAM in engineering seats is a four-figure forced-buy, not a speculative optional-buy. Legal + NIS2 + DORA + AI Act is a 36-month deterministic tailwind.
5. **The narrative is repeatable.** "EU is behind US on adoption because tools don't respect EU constraints. We built a tool that does." This is a line the organizer would repeat back to his own team.

### Glass vs. NormativAI — which to ship?

Both are defensible. If we're optimizing *purely* for hackathon wins, **Glass has a higher ceiling and a lower floor**:
- Higher ceiling: the demo has a physical-world credibility moment (Wi-Fi off) that NormativAI cannot match.
- Lower floor: our execution risk is smaller because we're in our expertise domain.

The only argument for NormativAI over Glass is **"the organizer literally named this persona, scoring his own example gets maximum theme points."** That's a real argument, but it's also the argument *every other team who watched the kickoff will make.* The NormativAI space will be crowded; Glass space will not.

### If Glass is rejected: secondary pick is **Aegis**

Same reasoning applied to security: under-solved niche, natural multi-agent architecture, concrete per-finding demo, clean L2→L3 story. Lower ceiling than Glass (no "Wi-Fi off" moment), but very low floor — the demo is mostly green-text-on-terminal, which is robust.

### Tertiary: **Glass × LegalDevAI hybrid**

If we have time in hours 18–24 and the core Glass demo is solid, bolt LegalDevAI on as a *corpus pack* that Glass ships with — "offline AI + Romanian software law, local, compliant." This compounds both stories. Don't attempt this unless the core is done by hour 18.

### What NOT to do
- Don't ship Traces alone — the dashboard demo is too quiet for the 3-minute stage.
- Don't ship ContextForge alone — the space is crowded enough that incumbents own the narrative.
- Don't split effort across two ideas. Pick one. Ship the demo. Harden.

---

## 7. Anti-Patterns Specific to the Software-Engineer Audience

The Winning_Strategy doc calls out generic hackathon anti-patterns. Here are the SWE-specific traps:

1. **"AI pair programmer" clone.** Unless we're differentiated on a specific axis (Glass = offline, Aegis = security, LegalDevAI = legal), we become Cursor-lite and lose to Cursor.
2. **Shipping features instead of a surface.** Five features with no persona < one feature with a persona. Cosmin can use Glass in the first 30 seconds; that's the bar.
3. **Exposing the AI as "AI."** Judge-facing surface should say "Glass" or "Aegis" not "our AI-powered AI AI dev assistant." Hidden AI beats branded AI.
4. **Demo on a codebase we wrote today.** Always demo on a real repo the judge has heard of — a RO-relevant OSS project, or a fork of a public Romanian company repo. Credibility compounds.
5. **Ignoring Romanian-language affordances.** Even for a SWE audience, having the surface support Romanian queries ("refactorizează middleware-ul de autentificare") is a free differentiation versus US/UK incumbents.
6. **Trying to cover all five levels.** Pick one transition. Cosmin goes L0→L1. Done. The L1→L2 story is a single slide at the end.
7. **Over-rotating on "the organizer said X."** He gave examples, not a scoring rubric. Matching his examples is safe; exceeding them (named user he didn't mention, demo moment he didn't foresee) is how we actually win.

---

## 8. Execution Sketch (for Glass, compresses to 24 hours)

- **H00–H02** — Lock persona (Cosmin), write the demo script, pick the exact query we'll run, pick the laptop, pre-pull the Ollama model.
- **H02–H06** — Core loop: IDE extension skeleton, Ollama endpoint, basic repo indexing via sqlite-vec, MCP server stub. End-to-end hello-world.
- **H06–H12** — Symbol-graph + hybrid retrieval in the indexer. Inline-edit feature in the IDE extension. Compliance-mode toggle.
- **H12–H14** — Architecture slide, pitch script, deck.
- **H14–H18** — Harden the demo query. Pre-warm KV cache. Run full demo flow 10 times. Kill features that aren't stable.
- **H18–H20** — Optional stretch: LegalDevAI corpus pack shipping inside Glass.
- **H20–H22** — Rehearse pitch with full demo. Time it. Cut anything over 3 min.
- **H22–H24** — Dress rehearsal on presentation hardware. Pre-load decks, pre-warm model, pre-cache queries, verify Wi-Fi toggle moment.

**Critical discipline:** never polish retrieval before the IDE extension works end-to-end. The demo wins or loses on the Wi-Fi-off moment; everything else is secondary.

---

## 9. Bottom Line

We have three strong paths — Glass, Aegis, and the original NormativAI. Glass is the bet that best combines: **our expertise, a named + forced L0 user, a demo nobody can fake, a market signal with four-figure math, and an organizer narrative we're strengthening rather than merely matching.**

> **Wi-Fi off. Copilot on. That's L0 to L1 — and it's the only L0 to L1 that's legal in Romania's regulated sectors.**
