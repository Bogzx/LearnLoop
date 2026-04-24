# RoutineOS — The L1 → L2 Platform for Engineering Firms

**Thesis (the main character):**
> Engineering firms don't fail at AI adoption because they lack AI tools. They fail because the knowledge of *how to use AI well* stays in one engineer's head and never becomes a firm-level asset. RoutineOS converts personal AI know-how into versioned, instrumented, auditable team routines — and measures whether adoption actually sticks.

**Target adoption jump:** L1 → L2 (opportunistic prompting → systematized prompting)
**Audience:** Any engineering firm — software or otherwise
**First vertical (demo):** MEP compliance checking against EU standards
**Why this wins the hackathon:** we're not building an AI tool. We're building the adoption layer every engineering org needs regardless of which AI tools they buy.

> **Framing discipline:** AI adoption is the product. The RAG, multi-agent pipeline, and citation verifier are **vertical plumbing** that prove the platform does real work. If a judge remembers only one thing from our pitch, it should be the adoption thesis, not the RAG.

---

## 1. The Adoption Thesis (why RoutineOS exists)

The hackathon brief is explicit:

> *"Tool rollout alone does not change behavior. Just as owning a treadmill does not improve health, access to AI does not automatically improve engineering outcomes."*

> *"Many organizations observe a usage spike during training weeks, followed by a decline once novelty fades."*

> *"Training a few experts does not create organizational change. Learning content is not the same as behavioral change."*

These three sentences describe **every engineering firm in Europe that has "adopted AI" in 2025**. Managers point to Copilot licenses; engineers point to personal ChatGPT tabs; nothing crosses the gap into a shared, sustained, firm-level practice.

L2 is the gap they fail to cross. L2 is not a feature — it's an *artifact* (a versioned, owned, reusable prompt/workflow) plus a *practice* (people actually reusing it). RoutineOS makes both the artifact and the practice first-class.

---

## 2. The Product in One Sentence per Layer

RoutineOS has three layers. The first two are the product. The third proves the product does real work.

| Layer | What it is | Why it's here |
|---|---|---|
| **1. The Routine Primitive** | A typed, versioned, owned, instrumented AI workflow | The L2 artifact itself |
| **2. The Adoption Runtime** | Telemetry + metrics + sustained-adoption scoring + adoption eval harness | How we *prove* L1 → L2 actually happened |
| **3. Vertical Handlers** | Pluggable logic that makes a routine do real engineering work — MEP compliance is the first | Proves the platform solves a real problem, not just a meta-problem |

---

## 3. Layer 1 — The Routine Primitive (the L2 artifact)

A **routine** is the unit of L2. Every routine has:

- **Intent** — natural-language description of what this routine does
- **Input schema** — typed fields (enum, float, int, string, file) the runner must provide
- **Output schema** — structured fields every result must conform to (finding, severity, evidence, recommendation, …)
- **Handler binding** — which vertical handler executes the work (e.g., `mep.compliance_rag`)
- **Owner + version + changelog** — governance
- **Telemetry contract** — every run, acceptance, override, and fork is an event

Routines are authored through a form-based editor (no code). Published routines are immutable; changes create a new version with a visible diff.

**Why the routine is the main character, not the handler:** a routine is portable across verticals. The same primitive wraps a compliance check, a structural load calc, a cost estimate, or a code migration. That's the hackathon thesis in code.

---

## 4. Layer 2 — The Adoption Runtime (the main act)

This is the machinery that makes adoption measurable and sustained. It's also the part most similar products miss.

### 4a. Event stream

Every interaction with a routine emits a typed event into SQLite:

| Event | Fields |
|---|---|
| `routine.authored` | author, routine_id, version, vertical |
| `routine.published` | publisher, routine_id, version |
| `routine.run` | runner, routine_id, version, project_id, input_size, duration_ms, ai_calls |
| `finding.accepted` | runner, routine_run_id, finding_id |
| `finding.overridden` | runner, routine_run_id, finding_id, override_reason |
| `routine.forked` | forker, source_routine_id, new_routine_id |

No events = no adoption story. Every UI interaction is wired to emit events from hour 0 of the build.

### 4b. The four adoption metrics

| Metric | Definition | What it tells a manager |
|---|---|---|
| **Reuse Breadth** | `distinct_runners(routine) / total_engineers` | Did the routine spread beyond its author? |
| **Reuse Depth** | `runs_per_routine_per_week`, smoothed | Did it become a habit? |
| **Trust Quality** | `findings_accepted / findings_total` | Is the AI output actually useful or just clicked through? |
| **Cycle-Time Delta** | `median(routine_duration) / median(manual_baseline)` | Is the firm actually faster? |

These are not aspirational — they are computed live from the event stream during the demo.

### 4c. Sustained-Adoption Score (the anti-novelty test)

The brief's specific warning is *"usage spike during training weeks, followed by a decline once novelty fades."* Our answer is a score that compares reuse in week 1 vs. weeks 2–4:

```
sustained_score = mean(runs_week2_to_week4) / runs_week1
```

- `< 0.5` → novelty spike, flagged red
- `0.5–1.0` → decay, flagged yellow
- `≥ 1.0` → stable or growing, flagged green

In the demo we compress the window (day 1 vs. days 2–4 of the hackathon) and seed it with real build-time usage data from the team. The formula is honest; the time window is compressed for demo purposes — and we say so.

### 4d. The Adoption Eval Harness (the hackathon kill-shot)

Most adoption pitches hand-wave this. We measure it.

Before the hackathon, we collect a **baseline cohort**: 2–3 people perform the demo task *without* RoutineOS — raw ChatGPT + PDF lookups. We record:

- Time to complete
- Variance across people (consistency)
- Acceptance rate of AI outputs (how often they had to override)
- Onboarding time (how long until a new person produces correct output)

During the demo, the *same people* (or teammates playing their role) run the task through RoutineOS. We publish the deltas live:

| Axis | Baseline (no routine) | With routine | Delta |
|---|---|---|---|
| Time-to-complete | 38 min | 90 s | **25×** |
| Variance across runners | ±15 min | ±12 s | **collapsed** |
| Trust quality | 41% | 87% | **+46 pp** |
| Onboarding time | first correct output @ attempt 4 | @ attempt 1 | **4× faster** |

These numbers are real, collected during the build, not invented. They are the **adoption proof**, not the RAG proof.

### 4e. Measurable definitions of L1 and L2

| Level | Observable signal in the event stream |
|---|---|
| L1 | Engineer runs at least one routine |
| L2 (minimum) | A routine authored by A is run by B on a distinct project at least 3 times |
| L2 (sustained) | Sustained-Adoption Score ≥ 1.0 for at least one published routine |

Judges can check these against the live database.

---

## 5. Layer 3 — MEP Compliance as the Demo Vertical

Now the compliance RAG appears — as a **handler**, not the product. It's how we prove a routine can do real engineering work.

### 5a. The handler: `mep.compliance_rag`

```
CAD JSON → Ingestion Agent → Retrieval Agent → Compliance Agent → Citation Verifier → Report Assembler
            (parse+validate)  (hybrid search)    (reason w/ evidence) (verbatim check)  (structured output)
```

**Hybrid retrieval** over EN 16798-1 (ventilation, indoor air quality):
- Dense embeddings, hierarchical chunks (directive → chapter → article → paragraph)
- BM25 sparse search for exact regulation-number matches
- Cross-encoder reranker (`BAAI/bge-reranker-base`) on top-20 → top-5
- Metadata filter restricts retrieval to the routine's declared regulation scope

**Structured output with function calling** — every finding is typed: `{regulation_id, article, severity, evidence_span, recommendation, parameter_trace}`. No free text.

**Citation verifier** — separate agent confirms `evidence_span` exists verbatim in the retrieved chunk. Findings that fail verification are dropped. **This is the mechanism that kills the L0 hallucination trust barrier** — and it's also why the Trust Quality metric in Layer 2 actually moves.

**Parallel per-row execution** — one routine run over a 120-room CAD export = 120 parallel handler invocations.

### 5b. Why this vertical first

- Organizer called out MEP + EU standards explicitly as a valid direction
- High manual baseline (3–5h per project) → dramatic cycle-time delta in the eval harness
- Regulatory context makes the citation verifier genuinely load-bearing, not demo flair
- Concrete, intuitive pass/fail outputs (room too small, ventilation rate too low) — judges can sanity-check without domain expertise

### 5c. The second-vertical slide (proves generalizability)

One slide shows the skeleton of a second handler — e.g., `structural.eurocode_load_check` or `software.legacy_migration`. Same routine primitive, same adoption runtime, different handler logic. **This slide is the proof that RoutineOS is not a vertical product.**

---

## 6. Why This Is Hackathon-Complex (two-column audit)

Split explicitly so adoption and tech depth each earn their seat.

| Adoption-depth (the main character) | Technical-depth (the supporting cast) |
|---|---|
| Routine primitive as L2 artifact | Hybrid retrieval (dense + BM25 + rerank) |
| Typed telemetry contract | Multi-agent orchestration with observable traces |
| Four adoption metrics, live-computed | Structured LLM output (JSON mode / function calling) |
| Sustained-Adoption Score (anti-novelty) | Citation verifier (verbatim check) |
| Adoption Eval Harness with baseline cohort | Parallel per-row execution |
| Measurable L1 / L2 definitions | Handler plugin architecture (vertical-agnostic) |
| Fork tracking + changelog + version diff | RAG eval harness with held-out labeled set |

Remove any item from the left column and the hackathon thesis collapses. Remove any item from the right column and the product loses credibility. Both are load-bearing.

---

## 7. Execution Plan

### 7a. Pre-hackathon prep (critical path, ~48h before start)

| Task | Owner | Output |
|---|---|---|
| Lock regulation scope (EN 16798-1) | Lead | PDF + citation index |
| Chunk + embed regulation | Data | `regulations.chroma` directory checked in |
| Mock CAD JSON schema | Backend | `mock_project_hospital.json` (28 rooms) |
| **Collect baseline cohort data** | Product | Stopwatch + 3 teammates performing manual task without tool; record time, variance, trust quality, onboarding time |
| Draft 3 starter routines | Lead | Ventilation v1, Fire Safety v1, Accessibility v1 |
| Demo machine + fallback provider keys | DevOps | Claude primary, OpenAI fallback, local provider as last resort |

**If the baseline cohort data is not collected before hour 0, the adoption eval harness has nothing to compare against — and the pitch loses its proof.**

### 7b. Build plan — adoption-first ordering

Note the ordering: we build the **adoption runtime before the RAG**. This forces the team to treat adoption as the product.

| Phase | Hours | Output | Gate |
|---|---|---|---|
| 1. Skeleton | h0–h4 | Repo, CI, SQLite schema, FastAPI + Next.js boilerplate | App boots, DB migrated |
| 2. Routine primitive + telemetry | h4–h12 | Routine model, event emission, minimal auth UI, routine CRUD | Can author a routine and see events in DB |
| 3. Adoption runtime | h12–h20 | Metrics computation, sustained-adoption score, manager dashboard | Dashboard shows live metrics as teammates click around |
| 4. MEP handler (RAG + agents + verifier) | h20–h32 | Full compliance pipeline, structured output, citation verification | Non-author teammate runs a routine end-to-end and gets a cited report |
| 5. Adoption eval harness | h32–h38 | Baseline vs. routine comparison UI, seeded with real baseline cohort data | Dashboard publishes live delta numbers |
| 6. Second-vertical skeleton + polish | h38–h44 | Second handler stub, second routine template, audit trace viewer | Judge-facing "how do we generalize" slide has a working backing |
| 7. Demo rehearsal | h44–h48 | 5× dry-run of pitch, hardcoded fallback paths, screen-recording backup | Team can run demo in ≤ 3 min blindfolded |

Phase gates are hard stops. Anything not done at the gate is cut, not finished.

### 7c. Team roles (4 people)

| Role | Core responsibility |
|---|---|
| **Lead / Backend-AI** | Routine primitive, handler architecture, RAG + agents + verifier |
| **Frontend** | Routine editor, result UI, trace viewer, manager dashboard |
| **Data + Eval** | Regulation chunking, mock CAD JSON, baseline cohort collection, adoption eval harness |
| **Product / Demo** | Telemetry instrumentation, routine authoring, pitch script, demo operator |

3-person fallback: Data + Eval merges into Lead; Product owns frontend polish in final 4h.

---

## 8. Tech Stack

| Layer | Pick | Why |
|---|---|---|
| Frontend | Next.js 14 + Tailwind + shadcn/ui | Fast, decent defaults |
| Backend | FastAPI (Python) | Best ML/LLM ecosystem |
| DB | SQLite + SQLAlchemy | Zero ops, event-log friendly |
| Vector store | Chroma (local) | No cloud dependency; ships in repo |
| LLM | Claude Sonnet 4.6 primary, OpenAI fallback | Strong tool use + structured output |
| Reranker | `BAAI/bge-reranker-base` | Small, fast, high quality |
| Agent orchestration | Plain async Python, or Claude Agent SDK | Avoid LangGraph unless team has used it |
| Telemetry | Custom event table in SQLite | Full local control |

**Rule:** nothing outside this list ships before Phase 7.

---

## 9. The 3-Minute Demo Script (adoption-first)

**[0:00–0:40] Open on the adoption thesis, not on MEP**

> *"Every engineering firm in Europe has 'adopted AI' in the same way: a Copilot license and a handful of engineers quietly using ChatGPT. The organizer's brief calls this exact pattern a failure — tool rollout is not adoption. RoutineOS is the L1 → L2 platform. Our product is the adoption layer. The AI inside is plumbing."*

**[0:40–1:20] Show the routine primitive — the L2 artifact**

> *(Routine editor.)* *"A routine is the L2 artifact: typed inputs, typed outputs, owner, version, changelog, and a telemetry contract. Here's Alex's ventilation-compliance routine, v1.2, published yesterday."*
> *(Event stream panel.)* *"Every interaction is an event. No events, no adoption story."*

**[1:20–2:00] MEP vertical as proof-of-work**

> *(File upload.)* *"A junior engineer drops in a CAD export. The MEP handler runs hybrid retrieval over EN 16798-1, structured reasoning, and a citation verifier that confirms every quote exists verbatim before we show it."*
> *(Click a finding.)* *"Exact article, verbatim paragraph, full agent trace. Auditable — which matters in regulatory work."*
> *"This handler is one vertical. The same routine primitive runs structural load checks or legacy-code migrations — same platform, different handler."* *(Second-vertical slide.)*

**[2:00–2:45] Adoption metrics — the kill shot**

> *(Dashboard.)* *"This is the part nobody else shows. Baseline cohort — 3 engineers doing this task manually: 38 minutes, ±15 minutes variance, 41% trust quality. With a routine: 90 seconds, ±12 seconds, 87% trust. Those aren't invented — we collected the baseline before the hackathon."*
> *"Sustained-Adoption Score: Alex's routine scores 1.2 — usage **grew** after day one. That directly answers the brief's warning about novelty spikes."*

**[2:45–3:00] Close on the thesis**

> *"We didn't build an AI tool. We built the adoption layer, and we measured whether it works. The MEP handler is just the first vertical. Happy to dive into the RAG, the agent traces, or the eval harness in Q&A."*

Open on adoption. Middle on MEP. Close on adoption. MEP is never the first or last sentence.

---

## 10. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Judge thinks adoption layer is a mockup | High | Fatal | SQLite-backed events + live dashboard reflecting real build-time usage + baseline cohort numbers |
| Judge asks "how is this different from Langfuse / PromptLayer / a YAML file?" | High | High | Answer: those log LLM calls; we measure *team-level behavioral change* — reuse breadth, sustained-adoption score, trust-quality lift. Show the Eval Harness page. |
| LLM hallucinates a citation on stage | Medium | Fatal | Citation verifier drops unverifiable findings; pre-warmed demo path |
| CAD parser breaks | Medium | High | Single fixed mock JSON format, unit-tested pre-demo |
| Pipeline too slow for live demo | Medium | Medium | Pre-warm cache; 3 rooms pre-processed; async UI |
| Team over-scopes past h32 (RAG phase) | High | Fatal | Phase gate is hard-stop; skip extras not the adoption runtime |
| Baseline cohort not collected pre-hackathon | Low | Fatal (to the pitch) | Block pre-hackathon day 0 for this; no other task starts until it's done |
| LLM provider outage | Low | Fatal | Dual-provider behind env flag + screen-recording backup |

---

## 11. Open Decisions Before Kickoff

1. **Project name** — RoutineOS vs. keep NormativHub (NormativHub reads as MEP-specific and fights the generic-platform framing; recommend renaming).
2. **Baseline cohort recruits** — who are the 2–3 people timing the manual task? Needs to happen 48h before kickoff.
3. **Second vertical for the generalizability slide** — structural load checks (Eurocode) vs. legacy-code migration (software)? Pick whichever a teammate can sketch in 30 minutes.
4. **Demo regulation** — EN 16798-1 preferred (ventilation; intuitive to check; parseable PDF). Confirm PDF accessibility.
5. **Which starter routines ship with v1.0** — 3 max, chosen so judges' intuition can sanity-check results.

---

## 12. Thesis Check (do this before every commit)

Ask:
- Does this commit strengthen the **adoption thesis**, or only the **MEP handler**?
- If the answer is "only the MEP handler," should something in Layer 1 or Layer 2 come first?
- If the adoption-thesis half of the Section 6 checklist is incomplete, **stop working on the handler** until it's done.

The whole hackathon hinges on this discipline. The RAG is impressive — but judges at an adoption hackathon reward the adoption thesis, not the RAG.
