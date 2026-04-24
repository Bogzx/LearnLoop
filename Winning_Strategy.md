# PoliHack — Winning Strategy: AI Adoption Track

> Critical analysis of the organizer brief + kickoff transcript, and the strategy we're going to run.

---

## 1. Re-audit of the Brief

An earlier read pushed hard on *"keep it simple, L0→L1, don't over-engineer."* That reading was too conservative. Going back to the organizer's actual words:

> *"Un părbăț valid poate fi de la level 0 la level 1, leger. **Dacă e foarte ok, noi o subcuntăm în consecințe.**"*

Translation: a simple L0→L1 is **valid**, and **if it's very good, we score accordingly**. That's a **floor**, not a ceiling. He is warning mediocre teams off overreach — not telling strong teams to stay shallow.

Two more lines carry a lot of weight:

> *"Toată lumea face aplicații cu un pic de AI [...] și nimeni nu le folosește."*
> *"Paradoxul e că nici nu trebuie să folosiți AI și puteți câștiga competiția."*

Together these mean: **the theme bar is low, so hitting the theme alone won't win**. On the standard PoliHack rubric (execution, innovation, UX, theme, presentation), the real differentiators become **execution quality and innovation** — because everyone will clear the theme bar.

Technical depth is not punished. **Uncoupled technical depth** — AI theater with no user — is.

---

## 2. Precisely What "The Trap" Is

The organizer's trap is **pushing the user from L3 to L4**, not using L4 tech internally. These are different axes:

| Dimension | Organizer warned against | Organizer did NOT warn against |
|---|---|---|
| **User's adoption level progression** | L3 → L4 in one app | — |
| **System's internal complexity** | — | No limit stated |
| **Surface complexity shown to user** | AI theater, nobody uses it | — |

Conclusion: **sophisticated backend serving an L0 user is fully on-theme.** The ambition just has to live on the right axis.

---

## 3. The Winning Architecture — Simple Surface, Sophisticated Brain

Build what looks like a boring, obviously-useful tool for a named non-AI-native engineer. Behind it sits the full RAG / MCP / multi-agent stack.

**Why this wins:**

1. **Theme compliance is automatic** — a real L0 user using the tool = adoption demonstrated.
2. **Demo is reliable** — single query in, clean answer out. Agent systems fail in hackathon demos precisely because they are exposed as the surface. Hide them and they become robust.
3. **Rubric — execution + innovation points** come from the hidden depth, revealed on the architecture slide.
4. **Story beats the field.** Most teams will either (a) ship a shallow L0→L1 toy or (b) ship an agent framework with no user. Doing both-at-once is the actual gap.
5. **Matches the organizer's own example.** He explicitly said: MEP engineer searching EU standards with a mouse → build them a ChatGPT. The *user* goes L0→L1. Nothing stops the *system* from being RAG + reranker + multi-agent verifier + MCP-exposed.

---

## 4. Recommended Project — "NormativAI"

A Romanian engineering standards assistant for MEP / construction / architecture engineers.

### 4.1 User-Visible Surface (what the judge sees demoed)

- A single clean input box, Romanian language.
- Engineer types: *"ce grosime de izolație trebuie pentru conducte de încălzire în clădiri industriale"*.
- Returns: the exact clause, page, citation from the relevant SR EN / I-13 / NP standard, with a 2-line plain-Romanian explanation.
- Optional: drag-drop a project PDF → get compliance flags with references.

### 4.2 Hidden Depth (what the architecture slide shows)

- **RAG pipeline** over scraped/public Romanian + EU engineering norms (ASRO, CEN/CENELEC where public).
- **Hybrid retrieval** — BM25 + dense embeddings + cross-encoder reranker.
- **Multi-agent verification chain**:
  - Retrieval agent fetches candidate clauses.
  - Answer agent synthesizes.
  - **Citation-verifier agent** rejects hallucinated references against the source chunks.
  - **Contradiction-detector** flags when two standards disagree (a real pain point).
- **MCP server** exposing the corpus so it plugs into Cursor / Claude Desktop / AutoCAD plugins — this is the "L2-ready" story for extra points.
- **Smart model router**: cheap model for retrieval/verification, strong model for final synthesis — directly demonstrates the cost-consciousness the organizer praised in the transcript.

### 4.3 Why This Specifically Wins

- The organizer **named this exact use case** (~3:37 in the transcript). We are literally answering the prompt on screen.
- It is **non-software engineering** — a bonus creativity signal he explicitly asked for.
- The persona is **unambiguously L0**: Romanian MEP engineers genuinely do not use AI for this today. The L0→L1 transition is verifiable, not hand-waved.
- **Corpus is real, finite, and acquirable in a hackathon.** Romanian standards are partially public; a credible subset can be bootstrapped in a few hours.
- **Demo failure modes are bounded.** Worst case: retrieval returns wrong clause → user still sees a clean UI. Compare to a multi-agent coding assistant where one hung agent kills the demo.

---

## 5. Viable Alternatives (ranked)

1. **CodCompliant** — architect uploads a design PDF; tool flags deviations from building code (P100, C107, etc.). Same RAG backbone plus a vision/document agent. Higher ceiling, higher execution risk.
2. **ShantierOps** — voice-first tool for a construction site foreman. Reports spoken in Romanian → structured daily log + regulation flags. Strong non-software story; mic-on-stage demo is risky.
3. **TeamPromptOps** — L1→L2 play. Observes a team's Cursor/Copilot usage, auto-extracts repeatable prompts, versions them in a git repo with review. Lower domain novelty but cleanest adoption story.

NormativAI is ranked first because data is accessible, the demo is deterministic, and the organizer pre-endorsed the persona.

---

## 6. Execution Discipline (this is where most teams lose)

1. **Spend the first 3 hours not coding.** Define: the persona (one name, one workflow), the exact query they'll type in the demo, the exact response that "wins." Everything else follows.
2. **Acquire the corpus first.** Before any ML work, have the document set downloaded and chunked. If the data isn't there by hour 6, pivot.
3. **End-to-end demo path at ~40% quality by hour 12**, then harden. Do not polish retrieval before the UI exists.
4. **Cache the demo queries.** Pre-run them. Have a warm cache ready for the presentation. Non-negotiable.
5. **One person owns the story.** Not the code — the narrative: *"Maria, 34, MEP engineer at [plausible RO firm]. Today she [specific workflow]. Tomorrow with us she [specific workflow]. That's L0→L1, and here's the receipt [live demo]."* The organizer's entire complaint is that nobody has a real user — having one loudly is half the battle.
6. **Architecture slide at the end, not the start.** Show Maria first, reveal the stack after. This mirrors the "simple surface, sophisticated brain" strategy in the pitch itself.
7. **One sentence on L2 readiness.** *"The MCP server lets a team version its normative queries as shared prompt contracts — that's the L1→L2 path we didn't build but unlocked."* Pre-empts "what's next."

---

## 7. Scoring Model — How We Map to the Rubric

Standard PoliHack rubric, projected mapping:

| Criterion | How NormativAI scores |
|---|---|
| **Theme alignment** | Direct L0→L1 on a persona the organizer named. Full marks. |
| **Innovation** | Multi-agent verification + contradiction detection on Romanian norms is novel domain work. |
| **Technical execution** | RAG + hybrid retrieval + reranker + multi-agent + MCP = serious CS-student-grade depth. |
| **UX / design** | Intentionally boring single-input surface. Wins on "a real engineer would use this." |
| **Presentation** | Persona-first story, architecture reveal at the end, live demo on cached queries. |

The weak point is UX polish — mitigated by keeping the surface *deliberately minimal* rather than attempting visual sophistication.

---

## 8. Anti-Patterns to Avoid

- Building an "AI adoption platform" — too abstract, no specific user.
- Building a "prompt manager" — already exists, boring.
- Building a multi-agent orchestration framework — infrastructure, not product.
- Mobile-first approach — unless it genuinely fits the user (jobsite only).
- Exposing the AI as "AI" to the user. They should just see "it works."
- The fridge-AI class of projects. Organizer called this out by name.

---

## 9. Bottom Line

The instinct to build something technically ambitious is **correct for this hackathon**. The earlier "dumb it down" framing was overcalibrated to safety.

The correction is not *less tech* — it is **invert the axis**: put the complexity in the plumbing, not in the user's face, and pick a user the organizer has already told us he wants to see helped.

**Simple surface. Sophisticated brain. Named user. Live demo. Win.**
