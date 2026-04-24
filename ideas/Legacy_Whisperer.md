# Legacy Whisperer — Making AI Actually Work on Real Enterprise Codebases

> One-sentence pitch: Point it at any gnarly legacy repo, and it produces a layered, self-updating context pack (`CLAUDE.md`, `AGENTS.md`, per-service docs) that makes AI coding assistants genuinely useful instead of confidently wrong.

---

## The pain this solves (Reddit-confirmed)

- AI coding assistants fail hard on real codebases. Custom decorators buried three directories deep, sibling microservice overrides, scattered business logic — invisible to the model. Suggestions "look plausible but violate patterns established elsewhere."
- HN thread "AI code assistants on large messy legacy code bases" is a long list of devs saying the same thing: works on toy repos, breaks on real ones.
- This is the #1 enterprise-adoption blocker. European market is *more* legacy-heavy than the US, so the pain is worse here.
- Teams at L0/L1 can't even get to L2 because they don't trust AI with their actual code.

---

## What it actually does

### 1. Crawl — deep codebase analysis

Given a repo (local or GitHub URL), it performs:
- **Structural scan:** file tree, module boundaries, service boundaries in monorepos, build graph.
- **Convention detection:** naming patterns, import aliases (`@acme/core`), common decorators/base classes, test patterns, linting rules already enforced.
- **Cross-module link detection:** who imports whom, which services share contracts, "hot" files that break often (from git log), override hotspots.
- **Tribal knowledge miners:** parse recent PR descriptions, commit messages, CODEOWNERS, README files, CI config, ADRs if present.
- **Git archaeology:** frequently co-changed file pairs (signals hidden coupling), bus-factor-1 files (only one person ever touches them), recently stabilized vs. still-volatile modules.

### 2. Compose — layered context output

Produces a *tree* of context files, not one monolithic dump:

```
CLAUDE.md                              # repo-root overview, global rules
AGENTS.md                              # agent-specific guidance
.context/
  architecture.md                      # how services fit together
  conventions.md                       # naming, patterns, gotchas
  hot-files.md                         # files that break often, touch carefully
  ownership.md                         # who knows what
services/
  payments/CLAUDE.md                   # service-specific context
  auth/CLAUDE.md
  billing/CLAUDE.md
```

Each file is **minimal and token-efficient** — not a dump of the README. Structured for consumption by an LLM working on a specific task.

Example output (anonymized):
```markdown
# payments service

- Transactions use the custom `@Atomic` decorator (src/lib/atomic.py).
  Do NOT use @transaction.atomic — we overrode it for retry semantics.
- Idempotency keys are required on all mutating endpoints.
  Pattern: see `charges/create.py`.
- Never import from `services/billing` directly — use the message bus.
  (This rule was added after incident INC-482, see ADR-012.)
- Hot file warnings:
  - `src/charges/processor.py` — 47 bug-fix commits in last 6 months, review carefully
  - `src/webhooks/handler.py` — critical path, has subtle ordering requirements
```

### 3. Update — keep it alive

- Git hook / GitHub Action: on every merged PR, re-analyze affected modules and update only the relevant context files.
- Drift detection: if a context file hasn't been touched but the code it describes has been heavily modified, flag for review.
- Optional: opens a maintenance PR when drift exceeds a threshold.

### 4. Serve — make it accessible to any AI tool

- Files live in the repo (`.context/`, `CLAUDE.md`, etc.) — works out-of-the-box with Claude Code, Cursor, Copilot, Continue, Aider.
- Optional MCP server: exposes the same context as tools (e.g., `get_service_context("payments")`, `find_hot_files()`, `who_owns(path)`) so any MCP-capable client can pull it dynamically.
- CLI: `whisperer query "how do I add a new payment method?"` returns the relevant context slice.

---

## Why this wins

1. **Biggest enterprise-adoption blocker.** Every "AI is great!" story is on a greenfield repo. Every "AI sucks!" story is on a legacy one. This bridges the gap.
2. **European market advantage.** More legacy code here → this lands harder locally than it would in SF.
3. **Dramatic live demo.** Let a judge pick any messy public repo (Django, Odoo, Airflow, Kubernetes). Run before/after: same AI, same prompt, night-and-day output quality.
4. **Clean adoption-level story.** Moves a repo from L0 (no AI context) → L1 (basic context present) → L2 (layered, maintained, team-convention context). All three jumps can be shown.
5. **Low execution risk.** AST parsing + git log mining + 1 LLM call per service for summarization. No novel ML needed.
6. **Generalist.** Works on any language, any repo — judges can try it on their own code.
7. **Defensible.** The generated files are in the repo. Users own them. No lock-in. Trust comes free.

---

## Adoption level shift

**L0 → L2 in one tool.**

- L0 repo: no AI context files → auto-generates the first layer.
- L1 repo: has a `CLAUDE.md` but shallow → deepens into service-level files, adds tribal knowledge.
- L2 repo: has team conventions → adds maintenance automation and drift detection.

---

## Execution plan — 24–36h build

### Day 1 (morning) — core crawler
- File-tree + language detection (py, ts, go, java — pick 2 for the demo).
- Git log parser for co-change, hot files, ownership.
- AST pass for Python/TS to extract public APIs, decorators, import graphs.

### Day 1 (afternoon) — composer
- Templates for `CLAUDE.md`, `AGENTS.md`, per-service docs.
- LLM call (Claude Sonnet / Haiku) to summarize each service from (README + public API + top contributors + recent PR titles).
- Prompt engineering: force concise, rule-style output — not prose.

### Day 2 (morning) — web dashboard + demo mode
- Single-page app: paste a GitHub URL → progress bar → generated files preview → "download zip" or "open PR".
- Side-by-side demo: a sample AI prompt run with and without the context files, showing quality delta.

### Day 2 (afternoon) — polish + stretch
- **Stretch 1:** GitHub Action that runs on every merged PR to update only the affected context files.
- **Stretch 2:** MCP server exposing context as tools.
- **Stretch 3:** `whisperer query` CLI for ad-hoc questions.

---

## Demo script (3 minutes)

1. **Hook (20s):** "Every 'AI writes all my code' demo is on a brand-new repo. Let me show you what happens on a real one." Pull up a messy public repo.
2. **Bad before (30s):** Open Cursor/Claude Code on that repo. Ask: "Add a new payment provider." Watch it confidently invent patterns that don't exist in the codebase.
3. **Run Whisperer (30s):** `npx legacy-whisperer .` → live progress → generated `.context/` tree appears.
4. **Good after (60s):** Same prompt, same AI. Now it cites the right decorators, respects the message-bus boundary, warns about the hot file. Judges see the delta viscerally.
5. **Maintenance (20s):** Show the GitHub Action diff from a recent commit — context auto-updated.
6. **Close (20s):** "This is how European enterprises actually adopt AI. Not by rewriting their codebase — by making their codebase legible to AI."

---

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| LLM summaries are generic/shallow | Prompt with explicit rules: "Output must be rule-form, not prose. Cite specific file paths. Include at least one gotcha." Give few-shot examples from well-maintained open-source `CLAUDE.md` files. |
| Demo repo works by luck | Pre-test on 3–4 messy repos in the week before. Know the gotchas ahead of time. Have a fallback repo ready. |
| Hallucinated rules make things worse | Always cite source (file path, line, or commit). If the model can't cite, it doesn't include. Verify import aliases against actual tsconfig/pyproject. |
| "Just use Cursor's codebase index" | Cursor's index is opaque, vendor-locked, ephemeral. Our output is versioned, reviewable, repo-local, and works across all AI tools. That's the pitch. |
| Scope creep into "rebuild Cursor" | We generate *files*, not an index. One input → one output. Keep it boring. |

---

## Differentiators vs. existing tools

- **vs. Cursor/Copilot codebase indexing:** Theirs is vendor-locked, opaque, can't be reviewed or version-controlled. Ours is a set of files in your repo — reviewable, portable, auditable.
- **vs. Manual `CLAUDE.md` authoring:** Most teams' `CLAUDE.md` is ~20 lines and outdated in 3 months. Ours is deep, layered, and auto-maintained.
- **vs. GitHub's `copilot-instructions.md`:** Single-file, no service-level scoping. We produce a layered tree.
- **vs. Sourcegraph/code search:** They're about humans searching code. We're about giving AI enough context to stop hallucinating.

---

## Future / v2

- **Incident learning:** tie context files to postmortems — "this file was involved in INC-482, be extra careful."
- **Onboarding mode:** generate a new-hire reading path from the same analysis.
- **Team fingerprint:** detect your team's "style" and enforce it on AI output.
- **Multi-repo:** for orgs with 50+ repos, a meta-index.

---

## TL;DR

Unblock the biggest AI-adoption barrier: AI doesn't understand real codebases. Generate the context files that make AI go from confidently wrong to actually useful, keep them fresh automatically, and make the demo dramatic enough that judges feel the before/after in their bones.
