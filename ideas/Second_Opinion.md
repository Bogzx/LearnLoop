# Second Opinion — The AI That Only Critiques Other AI's Code

> One-sentence pitch: A dedicated tool that does *nothing* but verify AI-generated code — catches hallucinated APIs, subtly wrong logic, repo-convention violations, and test-gaming before you ever commit. The lifeguard for the AI-code tsunami.

---

## The pain this solves (Reddit-confirmed)

- **96% of developers don't fully trust AI output. Only 48% verify it.** 38% skip review because reviewing AI code takes *longer* than reviewing a teammate's.
- Reviewers spend **91% more time** on AI-generated PRs. A fintech company hit a **1M-line review backlog** after adopting Cursor.
- **40% of AI-generated code is rewritten within two weeks.** First-year AI costs run 12% *higher* than pre-AI once churn is counted.
- The worst failure mode is "subtly wrong" code — compiles, looks right, has hallucinated API calls or logic errors that only surface in prod.
- Devs want to trust AI. They can't. Current tools all generate *more* code; nobody builds the verification layer.

Everyone at this hackathon will pitch an AI that writes code. We pitch the opposite — and that's why we win.

---

## What it actually does

### The core loop

```
AI generates code  →  Second Opinion critiques it  →  Human sees critique + code
                         (never writes code itself)
```

### Entry points (it meets devs where they are)

- **VS Code / Cursor extension:** sidebar panel. When AI suggests code, Second Opinion reviews it *before* you accept. Red/yellow/green indicators.
- **CLI:** `second-opinion review <file>` or `second-opinion review-last-commit`.
- **Pre-commit hook:** blocks commits of AI-authored code that fails critical checks.
- **GitHub Action:** PR reviewer that only triggers on PRs flagged as AI-assisted (via `Co-authored-by` or label).
- **Clipboard watcher (optional):** paste AI output → instant critique window.

### What it actually checks (the moat is the checklist)

1. **Hallucinated API calls.** Parse every symbol the AI referenced. Check against actual `node_modules` / `site-packages` / typeshed / local imports. Flag: `requests.download_file_async()` does not exist in `requests==2.32.3`.
2. **Non-existent imports.** Grep every import against the lockfile. The most embarrassing AI failure, caught instantly.
3. **Pattern violations vs. your own repo.** Quick embedding-search: has this repo solved this problem before? Does the AI's solution match? If not, flag.
4. **Test-gaming detection.** Did the AI write code that just makes the specific test pass (mocking heavily, hardcoding expected values, `if test_case == X: return Y`)? Static heuristics + LLM judge.
5. **Over-confident docstrings / comments.** AI loves to write `# This handles all edge cases` when it doesn't. Flag confident claims that aren't verified by tests.
6. **Silent rule violations.** Take your `CLAUDE.md` / `.cursorrules` / style guide, check the AI output line by line. Caught: "no `any` types" rule violated at line 34.
7. **Logic sanity.** Single LLM pass: "list every non-obvious assumption this code makes. Rank by risk." Concentrates reviewer attention.
8. **Edge-case sweep.** Auto-generate a short list of inputs the code might break on (null, empty, negative, unicode, large). Run them if possible.
9. **Diff-against-reality.** For modified functions, check if the AI changed behavior in ways not reflected in the PR description or tests.

### The output — structured, not prose

Not a wall of text. A scannable report:

```
Second Opinion — verdict: WARN

[BLOCK] Hallucinated API
  src/payments.py:42
  Call: stripe.charges.refund_partial()
  This method does not exist in stripe==7.2.0.
  Suggestion: use stripe.Refund.create(amount=...).

[WARN] Pattern violation
  src/auth/tokens.py:88
  AI used @transaction.atomic for retry logic.
  Repo uses custom @Atomic decorator (src/lib/atomic.py) — see ADR-012.

[WARN] Test-gaming
  tests/test_pricing.py:14
  Test mocks the function under test. Likely spurious pass.

[INFO] Non-obvious assumption
  src/queue.py:103
  Assumes input list is sorted. Not documented. Not tested.

2 blocks, 2 warnings, 1 info. Fix blocks before commit.
```

### Confidence-calibrated

Every finding has a confidence score. Low-confidence nits are collapsed; high-confidence blocks are loud. Trains reviewers to trust the tool instead of dismissing it as noisy.

### Learns your team over time (stretch)

- Feedback button: "this was a real issue" / "false positive."
- Aggregates team-wide: what kinds of defects your team's AI usage actually produces.
- Over weeks, tuning improves. Dashboard shows defects caught and team-specific weak spots.

---

## Why this wins

1. **Counter-narrative pitch.** Everyone else at the hackathon will build "AI that writes X". We build the one thing that the market has convinced itself it doesn't need but absolutely does.
2. **Pain is universal.** Every dev who uses AI has felt this. Judges will nod within 10 seconds.
3. **Visceral demo.** Paste a plausible-looking AI PR that has a subtle bug. Watch the red flags pop up instantly. Jaws drop.
4. **Addresses the measurement theme from the brief.** Defects caught, hallucinations blocked, review time saved — all countable, all dashboardable.
5. **Europe-aligned.** European teams are more cautious / compliance-driven. A verification-first tool lands harder than yet another code generator.
6. **No model training required.** Mostly static analysis + type checks + embedding search + one focused LLM pass. Low build risk.
7. **Portable.** Works with any code generator — Cursor, Copilot, Claude Code, Cody, local LLMs. Product-vs-platform play.

---

## Adoption level shift

**L1 → L2.** Moves teams from "I use AI ad-hoc and hope for the best" to "my team has a systematic verification layer between AI output and the codebase."

Secondary: for teams at L3 (agents in the repo), Second Opinion is the safety rail that makes agents deployable without anxiety. So it also enables L2 → L3.

---

## Execution plan — 24–36h build

### Day 1 (morning) — the core critic
- Language support: TypeScript + Python for the demo.
- Hallucinated-API checker: parse imports/calls, cross-reference against installed packages' actual exports (introspection via `inspect` / TS language server).
- Rule-violation checker: parse `CLAUDE.md` / `.cursorrules` into testable assertions, validate output.

### Day 1 (afternoon) — LLM-assisted checks
- "List non-obvious assumptions" prompt, carefully tuned.
- Test-gaming heuristics: detect mocks of the function-under-test, hardcoded return matching the expected value.
- Output formatter → structured JSON → pretty console + JSON for CI.

### Day 2 (morning) — UX surfaces
- VS Code extension: sidebar panel, triggered by AI acceptance or a keybinding.
- CLI + pre-commit hook.
- GitHub Action skeleton (stretch).

### Day 2 (afternoon) — demo polish + stretch
- Prepare 3 AI-generated snippets with different failure modes for the demo.
- **Stretch 1:** feedback loop (mark false positive / true positive).
- **Stretch 2:** team dashboard (aggregated defect types).
- **Stretch 3:** model-agnostic clipboard watcher — works even for engineers using ChatGPT in a browser.

---

## Demo script (3 minutes)

1. **Hook (20s):** "Raise your hand if you've committed AI code without really reading it." *[Laughter, hands go up.]* "This is the safety net."
2. **Problem (30s):** One slide. 96% of devs don't trust AI. 48% skip review. 40% of AI code rewritten in 2 weeks. "AI is generating faster than humans verify. This closes the gap."
3. **Demo A — hallucinated API (30s):** Paste an AI-generated snippet calling a method that doesn't exist. Second Opinion blocks it in <2 seconds with the exact reason and a suggested real API.
4. **Demo B — subtly wrong logic (45s):** A plausible function with an off-by-one and a hidden assumption. Second Opinion flags the assumption, proposes an edge case that breaks it. Run the edge case: it breaks. Dead silence in the room.
5. **Demo C — rule violation (30s):** Pre-commit hook blocks a commit because the AI used `any` where the repo bans it.
6. **Close (15s):** "Everyone's building AI that writes code. We built the one thing every dev already wanted but nobody ships: the AI that catches the other AI lying to you."

---

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| False positives destroy trust | Confidence scoring. Default to showing only high-confidence flags. One-click "false positive" feedback. |
| Feels like a linter | Linters don't check AI-specific failure modes (hallucinated APIs, test-gaming, confidence overclaiming). Emphasize the AI-specific checks in the pitch. |
| Judges ask "why not just a better model?" | Because the current models ARE the problem, and every model vendor is racing to generate *more*, not verify. Verification is an orthogonal layer — it works regardless of which model you use. |
| Latency kills the flow | Run fast checks synchronously (<500ms), slow checks (LLM) async and show progressively. |
| Integration sprawl | Ship one killer surface (VS Code panel) well. Others are stretch. |

---

## Differentiators vs. existing tools

- **vs. CodeRabbit / Bugbot / CodiumAI:** those review *all* PRs with generic suggestions (often drowning reviewers in noise). Second Opinion triggers only on AI-authored code and focuses exclusively on AI-failure modes.
- **vs. Linters / Sonar:** linters don't know about hallucinated APIs or test-gaming. They check form, not AI-specific failure modes.
- **vs. "just read the code yourself":** 48% of devs don't. This does it for them in 3 seconds.
- **vs. Cursor's own review feature:** same vendor generating and reviewing is a conflict of interest. Second Opinion is vendor-neutral.

---

## Future / v2

- **Model-defect database:** aggregate anonymized findings across orgs. "GPT-5 hallucinates stripe APIs in 3.2% of calls; Claude 4.6 in 0.8%." Real data on model reliability.
- **Regression shield:** replay past bugs as check cases — "this repo had an AI-caused bug last month, make sure it doesn't come back."
- **Team-weighted rules:** learn that this team cares deeply about X and weakly about Y. Personalize noise.
- **Bounty hook:** when Second Opinion catches a high-severity issue, post to a team feed — celebrates verification, nudges L1→L2 culturally.

---

## TL;DR

Everyone's building AI that writes code. Nobody's building the verification layer. 96% of devs know they should verify AI output; nearly half don't. Second Opinion does it for them — fast, focused on AI-specific failure modes, model-agnostic. Counter-narrative pitch. Universal pain. Visceral demo. A hackathon-winning shape.
