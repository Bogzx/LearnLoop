# The Idea — Quick-Explain Sheet

Working name: **Trailhead** (placeholder — swap freely).
Adoption-ladder target: **L1 → L2** (opportunistic prompting → systematized, versioned prompting).
Form factor: **MCP server + thin VS Code extension** (works with Claude Code, Cursor, Claude Desktop for free).

---

## One-Sentence Pitch

> *A repo-native wiki that writes itself, remembers what the team asked, and forces every AI-generated line of code to respect the rules that live in it.*

---

## 30-Second Version (for a teammate at the coffee machine)

A plugin that keeps a **living wiki inside every folder** of your repo. It auto-updates after every commit. It does two things:

1. **Makes AI queries cheap and correct.** Instead of the AI scanning the whole codebase, it traverses the wiki tree and only loads the nodes it needs. Big context-window / token savings.
2. **Enforces architecture rules automatically.** Each folder's wiki contains the rules for that layer. When Claude / Cursor / Copilot generate code there, those rules are injected as constraints — violations are blocked.

The killer detail: the wiki also contains a **log of past team questions**. When you ask *"what does this function do?"*, you also see *"Andrei asked the same thing 3 days ago — here's the answer."* Team memory, captured automatically.

---

## Two Features, Reframed So They Sell

| Your framing | Pitch framing |
|---|---|
| "Auto-generates documentation" | **"The AI has a cheap, always-fresh map of this codebase."** Sell cost + speed, not docs. |
| "Uniformizes the project" | **"The wiki is a contract the AI writes against."** Rules live next to code; AI cannot violate them. |

---

## The Wiki Structure (the picture to draw on a whiteboard)

```
repo/
  .wiki/
    index.yaml                 # tree manifest + routing hints for the AI
    src/
      api/
        node.md                # rules + invariants for this layer
        qa.jsonl               # {question, answer, asker, date, file_refs}
      ui/
        node.md
        qa.jsonl
```

Every folder = one wiki node. Every node = **rules** + **Q&A log**.

---

## Three Sub-Systems (name them in the pitch)

- **Indexer** — post-commit git hook regenerates only affected nodes. Not live-on-edit (too chatty, breaks cache).
- **Router** — given a user question, retrieves over `index.yaml` + node summaries to pick which nodes to load *before* the main LLM call. This is the token-efficiency story the organizer explicitly called out in the brief.
- **Logger** — the plugin is the MCP server, so every Q/A passes through it naturally and lands in the nearest `qa.jsonl`. Dedup via embedding similarity = "Andrei asked this already."

---

## The Demo (named persona, one query, one slide reveal)

> **Radu**, 27, mid-level dev at a 40-person Romanian fintech. Joined 2 weeks ago.
>
> Asks Claude: *"ce face `ChargeProcessor.settle`?"*
>
> - **Today:** half-hallucinated guess, model never saw the repo.
> - **Tomorrow with Trailhead:**
>   1. Exact answer with file + line citation.
>   2. The 3-line rule this layer enforces (*"all settle operations go through idempotency key X"*).
>   3. *"Andrei asked the same thing Tuesday — here's what he shipped afterward."*
>
> Architecture slide at the **end**, not the start.

---

## Why This Wins (rubric mapping)

- **Theme**: direct L1 → L2. Prompts + rules + team knowledge become versioned repo artifacts. Textbook systematization.
- **Innovation**: the Q&A log is genuinely novel — Mintlify / Swimm / readme.ai don't do team-memory capture.
- **Technical execution**: indexer + router + MCP server + rule-enforcement hook = real depth.
- **UX**: intentionally boring surface — dev asks a question, gets a better answer. Judge sees "a real engineer would use this."
- **Presentation**: persona-first story, architecture reveal at the end.

---

## Anticipated Questions (have the answers ready)

**"How is this different from Mintlify / Swimm / auto-doc tools?"**
Those are doc generators. We're a **context router** and a **team-memory log**. The doc is just the storage format.

**"Who updates the wiki?"**
Post-commit hook + agent. Diffs changed files, regenerates only affected nodes. Incremental, not full re-index.

**"How does rule enforcement actually work?"**
Two hooks: (a) wiki rules are injected into the AI's context when it edits that folder, (b) a `verify_against_wiki` MCP tool is called before code is finalized — violations block the output.

**"What about privacy? The Q&A log shows what the team doesn't know."**
Repo-scoped, git-tracked, PR-reviewable. Team controls what gets committed — same model as any other repo artifact.

**"Cold start on an empty repo?"**
First run = full index. Every subsequent run = incremental.

---

## Risks to Name Up Front

- **Software-only persona.** The organizer explicitly praised non-software. Most teams will also be software — sharpen the differentiator.
- **Demo-failure mode.** Live wrong answer = pitch collapses. **Cache demo queries.** Pre-generate the wiki on a small clean public repo.
- **Crowded adjacent space.** Have the "context router, not doc generator" answer memorized.

---

## Execution Order (first 12 hours)

1. Hours 0–3: lock persona (Radu), lock demo query, lock the exact layered answer.
2. Hours 3–6: acquire a clean public repo for the demo; write `.wiki/` schema; stub the MCP server.
3. Hours 6–12: end-to-end path at 40% quality — Indexer + Router + one-query demo working end-to-end before polishing anything.
4. After: cache demo queries, harden rule-enforcement hook, rehearse the pitch.

---

## Bottom Line

**Simple surface. Sophisticated brain. Named user. Live demo.**
A wiki that writes itself, remembers what the team asked, and keeps the AI inside the lines.


  Think about what Git did:
  - Before Git: engineers coded alone, emailed files, merged in nightmare sessions. Codebase was a pile of individual work.
  - After Git: codebase is collective, merges are explicit, history is shared, onboarding is possible, blame is attributable.

  Apply it to AI:
  - Before Hive: engineers prompt alone, knowledge dies in browser tabs, every question is re-asked, new hires inherit nothing.
  - After Hive: prompts are collective, graduations are explicit, history is shared, onboarding includes team AI context, learning is attributable.