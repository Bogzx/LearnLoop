# Adoption, Not Execution — The Real Reframe

> Everything in the prior three docs (NormativAI, Glass, Aegis, SkyLex, Rețea, Cadastru.AI) was an **AI execution product**. The hackathon is about **AI adoption**. This doc rebuilds the search space under the right frame and picks a winner.

---

## 0. The Distinction, Explicitly

| | AI Execution Product | AI Adoption Product |
|---|---|---|
| **What it does** | Performs a task with AI | Changes how a human works with AI |
| **Unit of value** | Task completed | Habit formed, behavior changed |
| **Success metric** | Accuracy, latency, cost | Usage frequency, retention, level progression |
| **Who benefits on day 90** | The user, for that task | The organization, because the user is transformed |
| **Prior docs pitched this** | NormativAI, Glass, SkyLex, Rețea, Cadastru, Aegis, ContextForge | — |

**The organizer said it in the kickoff, three different ways:**

1. *"You don't even need to use AI in your application, and you can still win the competition — as long as your application helps drive AI adoption."*
2. *"Owning a treadmill does not improve health. Access to AI does not automatically improve engineering outcomes."*
3. *"Training a few experts does not create organizational change. Sustainable adoption requires hands-on practice, coaching, grassroots momentum, and feedback systems."*

All three quotes point the same direction: the product is the **behavior-change system**, not the AI tool. Every prior idea in this folder (my own included) missed that. This doc corrects.

---

## 1. What an "Adoption Product" Actually Is — Taxonomy

The brief names five signals of sustainable adoption:

- Frequency of AI-assisted workflows
- Quality improvements
- Cycle-time reduction
- Team-level collaboration patterns
- Retention of new ways of working

An adoption product is anything whose primary job is to move one or more of those signals. That decomposes into six product families:

| Family | What it does | Example motif |
|---|---|---|
| **Measurement** | Instrumentation of adoption level over time | Per-engineer L0–L4 scoring, retention curves |
| **Behavioral nudging** | Time-appropriate interventions when the human isn't using AI they could | "You just spent 20 min on boilerplate — try this" |
| **Just-in-time training** | Context-specific learning delivered at the moment of relevance | Embedded micro-lesson inside the IDE |
| **Peer learning / grassroots** | Social-proof engine that surfaces teammates' AI wins to nearby peers | "Alex solved this yesterday with prompt X — try it?" |
| **Workflow redesign** | Maps current task flow, shows AI-augmented flow, guides progression | Before/after workflow mapper |
| **Team contract / governance** | Facilitates team norms for AI use, versions them | Shared team AI charter generator |

**Adoption products combine families.** A strong product does measurement + nudging + peer learning because the organizer's "grassroots momentum and feedback systems" phrase implies all three at once.

---

## 2. Anti-Patterns Specific to This Frame

Three ways a team thinks they're building adoption but is actually building execution:

1. **"Our AI tool is so good it drives adoption."** No — a tool is a treadmill. People buy treadmills. They don't run. Your tool's existence does not cause adoption. A coach does.
2. **"We train five power users who evangelize."** The organizer called this out by name as **AI champion myth**. Top-down expert training is exactly what does *not* work. Grassroots does.
3. **"We'll add dashboards after we ship the AI app."** Then you've built execution first and adoption as a bolt-on. Adoption must be the core. Pure dashboards fail the reverse test (purely measurement without intervention doesn't change behavior either).

---

## 3. The Idea Universe Under the Correct Frame

Fifteen adoption-product concepts, each tagged by family.

### Individual Enablement (L0 → L1)

| # | Name | One-line | Families |
|---|---|---|---|
| 1 | **Momentum** | Behavioral-nudge + measurement system for teams with installed-but-unused AI licenses. | Nudging + Measurement + Peer |
| 2 | **Sidekick** | Passive ambient observer of your workflow; surfaces AI-adoption opportunities in a quiet sidebar. | Nudging + JIT Training |
| 3 | **Retrospect** | End-of-day/week review of what you did; finds 3 moments where AI would have helped; suggests tomorrow's habit. | Measurement + JIT |
| 4 | **Reflex** | Streak/habit tracker ("Strava for AI adoption") — daily micro-practice, progression badges, streaks. | Nudging + Measurement |
| 5 | **First-Touch** | New-hire AI onboarding agent — teaches your team's AI workflow *during* their first 10 real tasks. | JIT + Governance |
| 6 | **Whisper** | WhatsApp-based adoption coach for the 50+ Romanian engineer who'll never install VS Code. | Nudging |

### Team Transformation (L1 → L2)

| # | Name | One-line | Families |
|---|---|---|---|
| 7 | **Sonar** | Peer-learning engine — surfaces teammate AI wins to *other teammates about to do similar work*. | Peer learning + JIT |
| 8 | **Charter** | 1-hour workshop-in-a-box that produces a team's AI-use contract, versioned in the repo, re-checked quarterly. | Governance |
| 9 | **Cookbook** | Continuously-generated team prompt/recipe library; extracts repeatable prompts from usage, versions them in git. | Peer + Workflow redesign |
| 10 | **Rewind** | Sprint retro tool: analyses what happened, shows where AI could have helped, produces specific prompts for next sprint. | Measurement + JIT |

### Organizational Scaling (L2 → L3+)

| # | Name | One-line | Families |
|---|---|---|---|
| 11 | **Traces** | Adoption-level dashboard across engineers, teams, org. ROI attribution. Retention curves. | Measurement |
| 12 | **Audit-in-a-Box** | One-shot org AI-adoption audit producing a 90-day playbook. *(This is the referenced past PoliHack winner's shape.)* | Workflow redesign + Measurement |
| 13 | **Drift Alarm** | Catches when teams *regress* (stop using AI) and alerts the manager with diagnosis. | Measurement + Nudging |
| 14 | **Ladder** | Organizational AI-skill matrix — every engineer placed on L0–L4 with competency evidence + next-level path. | Measurement + Governance |
| 15 | **Cascade** | Role-model-to-peer propagation tool: identifies the team's AI-strong engineers and pairs them with AI-weak peers automatically. | Peer + JIT |

---

## 4. The Uniqueness Filter

Apply the same lens as Domain_Exploration: what will nobody else at PoliHack build?

- **#1 Momentum, #7 Sonar, #2 Sidekick** — uniquely positioned against the organizer's headline concerns (tool rollout fallacy, champion myth). Very few hackathon teams think at this level; most will build execution products.
- **#11 Traces, #12 Audit-in-a-Box** — uniqueness compromised: Traces is a dashboard (crowded concept shape), Audit-in-a-Box was referenced as a past winner.
- **#4 Reflex, #6 Whisper** — form-factor novelty but risks being dismissed as gimmick.
- **Rest** — viable but narrower.

The uniqueness + commercial-plausibility sweet spot is in Momentum / Sonar / Sidekick — the behavioral-system family.

---

## 5. Deep Dives — The Three Contenders

### 5.1 Momentum — Behavioral Adoption System for Teams with Stranded AI Licenses

**Thesis.** Romanian engineering orgs (and European ones generally) have bought AI licenses and don't know if they're being used. Half of Copilot seats sit idle. Engineers don't know *when* to use AI. Managers don't know *who* is or isn't. This is exactly the "tool rollout fallacy" the organizer described. The product that resolves it is not another AI tool — it's the coach that sits on top of whatever AI tools are already installed and drives active behavior change.

**Persona — explicit.**
- **Cristina**, 38, CTO at a Bucharest fintech. 45 engineers. €42 000/year Copilot Business subscription. Paid a year ago. No idea whether it's helping. Board asks next Thursday. Her data today: a GitHub Copilot Metrics page showing "34% suggestion acceptance rate" — a number she cannot translate into anything decision-relevant.
- Secondary persona: **Alex**, her tech lead. Has tried to run three "AI show-and-tell" sessions. Attendance dropped each time. Felt stuck. Knows something else is required but doesn't know what.

**Surface — what the judge sees.**
1. **Overview dashboard.** Team of 45 split across five adoption bands: 8 engineers at L0 (never touched AI), 16 at L0.5 (occasional), 14 at L1.2 (regular), 5 at L2 (team-sharing prompts), 2 at L2.8 (writing agents). The dashboard doesn't just *show* the distribution — it shows the **delta since 30 days ago** (two engineers regressed from L1 to L0.5; one climbed L0→L1.3).
2. **Per-engineer view.** Drill into Maria: L0.4, Copilot installed 4 months ago, ten total accepted suggestions ever, never completed in-product walkthrough. Momentum's diagnosis: "passive non-user; barrier is likely unfamiliarity rather than skepticism." Prescription: three specific micro-actions this week, each delivered as a timed in-IDE nudge.
3. **Live nudge demo.** Maria opens a file with a repetitive switch-case block. VS Code sidebar slides in: *"This pattern is a common refactor. A teammate (anonymized) solved something similar yesterday with this prompt: '…'. Try it? (estimated save: 9 min) [Try] [Not now] [Stop nudging me]"*. Maria clicks Try. Completion happens. Logged.
4. **Peer-showcase feed.** "Wins this week": three anonymized before/after snippets where a teammate saved meaningful time with AI. Grassroots, not top-down. Attribution opt-in.
5. **Manager ROI view.** Not "% acceptance rate." Instead: "47 engineer-hours saved this month (est.); 23 engineers meaningfully progressed a level; retention of new habits at 4 weeks: 61%." Pound-for-pound language a CTO can take to a board meeting.

**Hidden depth.**
- **Adoption-level classifier.** Multi-signal model combining: commit patterns (perplexity-based AI-content estimator), IDE telemetry (acceptance rate, prompt length, prompt reuse), git history (revert rate on AI-assisted commits), time-series clustering of behavior. Outputs a continuous L0.0–L4.0 score with uncertainty band. **This is the real ML problem in the product, and it is non-trivial.**
- **Nudge-timing model.** Detects in-IDE moments when an AI suggestion would help (repetitive patterns, boilerplate starts, doc-writing moments, test-writing). Nudge fires only at the *right* moment — a wrong-time nudge reduces adoption (we cite recent IDE UX research here).
- **Personalized prompt generator.** LLM-in-loop generates the specific prompt based on the engineer's current file + recent commit context + team cookbook. This is where the product *does* use AI internally — but the product isn't an AI tool, it's a behavioral system that happens to use AI in its machinery.
- **Peer-matching graph.** For the Sonar feature: matches the engineer about to do task X with a teammate who recently did a similar task successfully with AI. Uses the same symbol-graph + embedding trick as a good code-retrieval system, applied to task-similarity.
- **Privacy architecture.** All telemetry opt-in, aggregate-only by default. Per-engineer data visible only to the engineer themselves unless explicitly shared. Manager view is anonymized until a threshold (e.g., aggregate five engineers).
- **Integration surface.** GitHub App (primary), VS Code extension (primary), Cursor / Claude Code (via MCP), Slack (for weekly digest). Pitch ships with GitHub + VS Code; others on the L2 roadmap slide.

**Why it wins.**
1. **Directly on-theme.** The organizer's headline complaint — tool rollout fallacy — is the exact problem Momentum solves. Walking in with this puts us at full marks on theme without argument.
2. **Addresses all three adoption phases.** Individual (per-engineer nudges), team (peer showcase), organizational (manager dashboard + retention). The brief's "x-times engineers / teams / company" framing is literally our dashboard sections.
3. **Grassroots, not champion-myth.** Sonar-style peer showcases are explicitly grassroots. Nudges surface *other engineers' wins*, not corporate-mandated training. The organizer will notice.
4. **Measurement is built in.** The brief emphasises measurement; our product is *instrumentally* measurement — the nudges close the loop (measure → intervene → measure retention).
5. **Uses AI without *being* an AI app.** The product uses AI to generate nudges, detect timing, match peers. But the product's category is behavioral system. This straddle is exactly the paradox the organizer endorsed ("you don't even need to use AI").
6. **Unique in the room.** Most PoliHack teams will ship an AI tool. Very few will ship the adoption layer *on top of* AI tools. The differentiation is sharp and defensible.
7. **Romanian market reality.** RO engineering orgs trail on adoption (cited in the organizer's own brief — European adoption lags US). Every RO org that bought Copilot/Cursor has stranded seats. TAM is the entire installed base.

**Risks and mitigations.**

| Risk | Likelihood | Mitigation |
|---|---|---|
| Dashboard-first demos feel dull | High | Lead with the **live nudge in VS Code**, not the dashboard. The nudge is the demo-visceral moment. Dashboard is the architecture-slide. |
| "Just another dev productivity analytics tool" objection | Medium | Own the distinction: we *intervene*, we don't just *measure*. Linearity / Swarmia / Sleuth measure outcomes; we drive behavior. |
| Privacy pushback during demo | Medium | Lead with "opt-in, aggregate-only by default." Show the consent flow first. |
| Adoption-level classifier takes longer than 24h | High | Ship a rule-based classifier for demo with an ML-in-roadmap slide. Do NOT try to train a classifier in the hackathon window. |
| Multi-integration scope creep | High | GitHub + VS Code only. Everything else is a roadmap bullet. |
| "Isn't this like the past PoliHack winning audit?" | Medium | No — that was a one-shot service. Momentum is a **continuous product**. One delivers a report; the other ships a daily nudge. Emphasise this in the pitch. |

**Demo beat-by-beat (3 min).**
- 0:00 — Persona slide. Cristina + €42 000 Copilot bill + no idea if it works. Alex + failed show-and-tell. "This is not the AI problem. This is the adoption problem."
- 0:25 — Open Momentum. Team overview: 45 engineers across the L0–L2.8 band. Show the 30-day delta — a live number, some progression, some regression.
- 0:50 — Drill into Maria. L0.4, passive non-user, 4 months stranded. Show Momentum's diagnosis — a behavioral classification, not a judgment.
- 1:15 — **The nudge demo.** Switch to VS Code. Open a file. Start typing a repetitive pattern. A sidebar slides in with a specific prompt suggestion and a "what a teammate did yesterday" snippet. Accept. Save. Logged.
- 1:45 — Show Sonar feed — team's anonymized wins this week. "This is grassroots, not top-down. Nobody was trained. Alex saw what Radu did and copied the pattern. That's the adoption mechanism."
- 2:05 — Manager ROI view. 47 hours saved; 23 engineers leveled up; retention at 4 weeks: 61%. "This is the number Cristina takes to her board."
- 2:25 — Architecture slide: adoption-level classifier, nudge-timing model, peer-matching graph, privacy-first telemetry, MCP exposure.
- 2:45 — Close: *"Every other team here today is going to pitch you an AI tool. We're the tool that makes sure the AI tools you already bought actually get used. That's the hackathon theme, written in one sentence."*

**Pitch anchor line.**
> *"Everyone in this room built an AI app this weekend. Half of them will sit unused in 90 days. We built the thing that makes sure yours doesn't."*

---

### 5.2 Sonar — Peer-Learning Engine (the "grassroots momentum" specialist)

**Thesis.** Training a few AI champions doesn't create change — grassroots peer learning does. But peer learning is bottlenecked on *awareness*: you don't know that your teammate solved your exact problem yesterday. Sonar is the awareness layer. When you're about to do task X, Sonar surfaces the teammate who recently did something similar with AI, and the specific prompt they used.

**Persona.** **Radu**, 30, dev at a 20-engineer team. Uses Copilot reluctantly. Has no idea his teammate Alex has a 5-line prompt that would save him an hour on the task he just started.

**Surface.** Passive sidebar. When Radu opens an issue or begins editing a file, Sonar checks for semantically-similar recent work across the team. If found and AI-accelerated: "Alex solved something similar 3 days ago — prompt + outcome shown here."

**Hidden depth.** Task-similarity graph (embeddings of issues + files + PRs), AI-attribution detection on commits, peer-matching ranking, opt-in attribution ("show my name"/"anonymous").

**Why it could win over Momentum.** Narrower, more unique. Precisely targets the champion-myth antipattern. The demo is singular: Radu opens a file, sees Alex's prompt, uses it, saves time.

**Why Momentum beats it overall.** Momentum contains Sonar as a feature. Shipping Sonar alone loses the measurement and nudging stories that also matter. Sonar is a feature; Momentum is a product.

---

### 5.3 Retrospect — End-of-Day Adoption Coach

**Thesis.** Instead of nudging in real time (UX-hard, interruption-risky), Retrospect analyzes your day *after* it's done and shows the three moments where AI would have helped — with the specific prompt you should have used, and a plan to form that habit tomorrow.

**Persona.** Any individual engineer. Simpler persona story than Momentum (no CTO).

**Surface.** 5-minute end-of-day digest in email / Slack. "Today you spent 22 min on task X; here's the prompt you could have used. Here's the prompt saved for tomorrow."

**Why it's a viable backup.** Lower execution risk (asynchronous batch analysis is simpler than real-time in-IDE). Demo-friendly (digest is visual).

**Why it's second-best.** Retrospective-only misses the "feedback systems" phrase in the brief — feedback should close the loop, not just post-hoc analyse.

---

## 6. Comparative Matrix

| Criterion | **Momentum** | Sonar | Retrospect | Reflex (streak) | First-Touch (onboarding) |
|---|---|---|---|---|---|
| On-theme (adoption-first) | 5 | 5 | 5 | 4 | 5 |
| Addresses tool-rollout fallacy | 5 | 3 | 4 | 3 | 2 |
| Addresses champion myth | 4 | 5 | 2 | 2 | 3 |
| Addresses measurement | 5 | 2 | 4 | 3 | 3 |
| Demo visceral-ness | 4 — live nudge | 4 — peer pop-up | 3 — digest | 3 — streak UI | 3 — onboarding flow |
| Technical depth | 5 — classifier + timing + peer graph | 4 — similarity graph | 3 — batch analyser | 2 — tracking | 3 — playbook engine |
| Build risk in 24h | 3 — broad scope, must cut | 4 — narrower | 4 | 4 | 3 |
| Uniqueness at PoliHack | 5 | 5 | 4 | 3 — gamification is familiar | 4 |
| Story memorability | 5 — "the thing that makes your AI tools get used" | 4 — "your teammate's prompt surfaced" | 3 | 3 | 3 |
| **Sum** | **41** | 36 | 32 | 27 | 30 |

---

## 7. Recommendation

### Primary: **Momentum**

The organizer told us three times what he wants. Momentum answers each:

1. **Tool rollout fallacy** → Momentum turns installed-unused AI into actively-used AI through timed nudges.
2. **Use-case problem** (engineers can't extrapolate generic AI to their work) → Momentum generates *personalized, task-specific* prompt suggestions from the engineer's current file.
3. **AI champion myth** → Sonar-style peer showcase makes adoption *grassroots*, not *top-down*. Nudges cite "your teammate did this yesterday," not "here's a corporate training."

And Momentum contains an explicit **measurement layer** (adoption-level classifier, retention curves) which the brief directly asks for.

**The positioning line that wins the room:**
> *"Every team at PoliHack today pitched you an AI app. Half those apps will be unused in 90 days. Momentum is the one that makes sure the AI apps you already own get used — and measurably."*

This is the rare pitch that **reframes every other pitch in the room in our favor**. After our demo, every other team's product becomes a candidate customer.

### Secondary: **Sonar alone**

If Momentum's scope feels unbuildable in 24h, ship Sonar alone. Narrower, same adoption DNA, addresses the champion-myth antipattern cleanly. Can be demo'd with two VS Code instances open showing peer-cross-talk. Loses the manager-ROI slide but keeps the grassroots story intact.

### Tertiary: **Retrospect**

Lowest execution risk. Async batch analysis. Works even if real-time IDE nudging is too hard. Ship this if the team is single-dev or has no strong front-end muscle.

### Explicitly demoted (from prior docs)

| Prior pick | Why demoted under this frame |
|---|---|
| NormativAI / SkyLex / Rețea / Cadastru / LegalDevAI | AI execution. Single-query tools. Adoption happens as side-effect, not as product. |
| Glass | AI execution (offline AI tool). Uniqueness comes from constraint, not adoption mechanism. |
| Aegis / Ledger / AgentCI | AI execution (code-review automation). The engineer uses it for a task; no behavioral system. |
| ContextForge / Rulebook Live | Closer to adoption (L1→L2 recipe sharing), but primary value is still execution efficiency, not behavior change. |
| Traces (prior doc's measurement pick) | Measurement-only — fails the organizer's "feedback systems" phrase which implies loop-closing intervention. Momentum swallows Traces. |

---

## 8. What to Build in 24 Hours (Execution Contract)

The single hardest discipline: **do not build an AI app**. Momentum *uses* AI (to generate nudges, detect task similarity, classify adoption levels) — but we must never drift into "let's also ship a better AI coding tool." We are the adoption layer, not the execution layer.

- **H00–H02** — Lock persona (Cristina + Maria). Write the exact nudge that will fire on stage. Decide exactly what the dashboard shows. Everything downstream flows from these three artifacts.
- **H02–H06** — VS Code extension skeleton + fake-but-plausible nudge trigger. GitHub App stub reading commit data. Baseline adoption-level classifier (rules-based, no ML).
- **H06–H12** — Dashboard with real data from one real repo + mocked data for other engineers. The live nudge must work end-to-end by hour 12.
- **H12–H16** — Sonar feature: peer-win feed. Even with two real engineers (us) as the data source, it demos cleanly.
- **H16–H20** — Manager ROI view with plausible-enough numbers. Architecture slide. Pitch script.
- **H20–H22** — Dress rehearsal, 10× through the demo. Caching + warm-up.
- **H22–H24** — Hardware check + backup plan.

**The three things we must NOT do:**
1. Train a real adoption-level classifier. Rules + human-plausible numbers is enough; the architecture slide says "here's how we'd train it at scale."
2. Ship four integrations. GitHub + VS Code only. Everything else is an MCP stub and a roadmap bullet.
3. Make the dashboard the demo headline. The **live nudge** is the demo headline. Dashboard is depth.

---

## 9. Anti-Patterns to Forbid

1. **Slipping into building an AI app.** Any time the team says "we should also make the AI smarter at X," stop. Momentum doesn't care how smart X is; it cares whether the human uses X.
2. **Building a dashboard and calling it adoption.** Pure measurement without intervention is the "data without action" antipattern. Every measurement must be wired to a nudge or a peer-surfacing.
3. **Top-down training content.** No video tutorials. No "AI 101" modules. Everything must be grassroots-shaped (peer-surfaced) or just-in-time (task-specific).
4. **Privacy hand-waving.** The first judge question will be privacy. Lead with the opt-in + aggregate model, don't let it be a Q&A surprise.
5. **Repeating the past audit winner.** Don't pitch this as "AI adoption consulting" — pitch as "AI adoption product." Service → Product is the upgrade; don't skip it.

---

## 10. Bottom Line

Every prior pick in this folder — including my own SkyLex recommendation from yesterday — was an AI execution product. The hackathon theme is adoption. The fix is not a different domain, not a better demo; it is a different *product category*.

Momentum is that category in concrete form: a behavioral-adoption system that sits on top of whatever AI tools an org already owns, nudges engineers into active use, surfaces peer wins as grassroots momentum, and measures level progression across the team.

> **Every other team at PoliHack will pitch an AI. Momentum is the tool that pitches itself to every other team's customers.**

That is the winning frame, and it only works under the correct reading of the theme — which is the reframe you just forced.
