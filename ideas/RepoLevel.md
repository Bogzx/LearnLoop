# RepoLevel — "Lighthouse for AI Adoption"

> One-sentence pitch: Install it, get a scored report of your repo's AI adoption level with evidence, and it auto-opens PRs to move you up one level.

---

## Why this wins the hackathon

1. **The hackathon theme *is* the product.** The brief calls measurement the thing most orgs fail at. No one else will build a measurement tool because measurement isn't sexy. That's the market inefficiency.
2. **Unforgettable demo moment.** "Give me any public repo URL" → score + opened PR → judges' jaws drop.
3. **Covers all adoption levels in one product** — we're not betting the whole pitch on a single audience.
4. **Low execution risk.** The MVP is heuristic scanning + templates, not ML. LLM is only used for the narrative report and PR body generation.
5. **Directly answers the challenge prompt:** "Help engineers progress from one adoption level to the next." RepoLevel literally does that and shows the delta.
6. **Memorable pitch metaphor:** "Lighthouse for AI." Judges immediately grasp it.

---

## What it actually does

### 1. Scan — detect current adoption level

A CLI + GitHub App that scans any repo for concrete artifacts that signal adoption level. Each signal has a point value. The repo scores between L0.0 and L4.0.

**L1 signals (opportunistic prompting):**
- `Co-authored-by: Claude` / `Co-authored-by: Copilot` in commit messages
- Presence of IDE AI config (`.vscode/settings.json` with AI keys, Cursor/Continue config)
- AI-related entries in `.gitignore` (e.g., `.claude/`, `.cursor/`)
- References to AI in PR descriptions

**L2 signals (systematized prompting):**
- `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`
- `.prompts/` or equivalent prompt directory
- Prompt templates referenced in docs or CONTRIBUTING.md
- Team-level conventions documented

**L3 signals (agent-based development):**
- GitHub Actions running AI agents (Claude Code Action, OpenAI Action, Cursor background agents)
- MCP server definitions (`.mcp.json`, `mcp.json`)
- Agent config files with scoped permissions
- Eval harnesses for AI outputs

**L4 signals (orchestrated agentic workflows):**
- Multi-agent workflow orchestration (LangGraph, CrewAI, custom DAGs)
- Cross-agent handoff patterns
- Production eval pipelines
- Agent observability / telemetry wiring

### 2. Report — narrative + evidence

Output looks like a Lighthouse audit — a **score with evidence**, not a vibe.

```
Repo: acme/payments-api
Adoption Level: L1.3 / L4.0

L1 signals detected:
  [OK] 47 commits with Co-authored-by: Claude
  [OK] .cursor/ directory present
  [--] No AI references in PR descriptions

L2 gaps (next level):
  [MISS] No AGENTS.md or CLAUDE.md
  [MISS] No .prompts/ directory
  [MISS] No copilot-instructions.md

Suggested next steps to reach L2:
  1. Add CLAUDE.md (starter provided)
  2. Add .prompts/ with 3 team-relevant templates
  3. Add .github/copilot-instructions.md

[Open PRs to apply these changes]
```

### 3. Uplift — auto-open PRs to advance one level

The moat. Not a reporting tool — a *doing* tool.

For each detected gap, RepoLevel opens a real PR with the concrete minimum change. Templates are seeded from the repo's actual content:
- **L0 → L1 uplift PR**: adds a `CLAUDE.md` seeded from the repo's README, package manifests, and file structure. Adds a starter `.gitignore` entry. Adds a PR description template that includes an "AI usage" field.
- **L1 → L2 uplift PR**: adds `.prompts/` with 3–5 starter prompts tuned to the repo's language/framework (e.g., TS → a "generate Jest test for this function" prompt; Python → "generate pytest with hypothesis"). Adds `AGENTS.md`.
- **L2 → L3 uplift PR**: adds a bounded `.github/workflows/ai-review.yml` (PR-comment-only, no merge permissions). Adds an eval harness skeleton.

Each PR body explains *why* this advances the repo's level, cites the rubric, and tells the reviewer what to expect.

### 4. Track — progression over time

- Scores persist. Dashboard shows repo's adoption curve over weeks/months.
- Drift detection: if signals degrade (prompts folder goes stale, CLAUDE.md untouched for 6 months), surface it.
- Optional leaderboard across an org's repos — gentle social pressure.

---

## Adoption level shift

**Any → Any + 1.** Meta-tool. Works for any level L0–L3.

- Individual engineer with a side project: L0 → L1.
- Team repo with scattered AI use: L1 → L2.
- Mature team with conventions: L2 → L3.

This is a feature, not a bug — one product, many audiences.

---

## Execution plan — ~24–36h build

### Day 1 (morning) — core scanning engine
- File-system scanner for ~10 concrete signals listed above.
- Scoring function: weighted sum, produces L0.0–L4.0 score.
- Git log parser for `Co-authored-by` and PR metadata.
- Output: JSON + markdown report.

### Day 1 (afternoon) — uplift PR generator
- Templates for L0→L1, L1→L2, L2→L3 uplift PRs.
- Seeder: reads repo README, package.json / pyproject.toml / Cargo.toml / etc., generates a `CLAUDE.md` customized to the detected stack.
- PR-opening logic via GitHub API (needs GitHub App or PAT).

### Day 2 (morning) — web dashboard
- Single-page app. Input: GitHub repo URL. Output: score + evidence + "Open uplift PR" button.
- Score visualization (radar chart across L1/L2/L3/L4 dimensions).
- Time-series if repo has been scanned before.

### Day 2 (afternoon) — polish + stretch
- **Stretch 1:** MCP server that exposes the score to your IDE's AI. "What's my repo's adoption level?" answerable in Claude Code / Cursor.
- **Stretch 2:** Leaderboard page (public opt-in).
- **Stretch 3:** GitHub Action that comments the score on every PR.

---

## Demo script (for 3-minute pitch)

1. **Hook (15s):** "Raise your hand if your team has actually measured AI adoption. *[Few hands.]* That's the problem."
2. **Problem framing (30s):** Cite the brief — measurement is called out as critical. European adoption is ~15%. Orgs roll out AI tools and hope. Hope is not a strategy.
3. **Live demo (90s):**
   - Paste a real public repo URL (ideally a sponsor's).
   - Show scan running → L1.3 score appears.
   - Point at the evidence panel: "Here's exactly what we found and didn't find."
   - Click "Open uplift PR." Real PR opens in GitHub with custom `CLAUDE.md` seeded from their README.
4. **Second demo (30s):** Run it on *our own* repo from 2 days ago (L0) vs. now (L2). Show the time-series curve.
5. **Close (15s):** "Lighthouse made web perf measurable, and perf got better. RepoLevel does the same for AI adoption. One install, any repo, any team, any level."

---

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Feels like "static analysis with AI branding" | The auto-PR generator is the moat. That's a *doing* tool, not a reporting tool. Lead the demo with the PR opening, not the score. |
| Judges think it's just a linter | Emphasize (a) the narrative report, (b) the time-series progression, (c) the templated uplift PRs seeded from the repo. Linters don't do any of these. |
| Heuristics feel shallow | Include at least one genuinely insightful signal — e.g., detecting whether a `CLAUDE.md` is actually used (referenced by recent commits) vs. abandoned. Depth over breadth. |
| Scope explodes | Ship L0→L1 uplift first. If time, add L1→L2. Don't build L2→L3 or L3→L4 uplifts unless core works end-to-end. |
| "But Copilot metrics already exist" | Those measure *tool usage*, not *behavioral adoption*. A repo can have 100% Copilot seat penetration and still be L0 (nothing in the code reflects AI-native ways of working). That distinction is the pitch. |

---

## Key differentiators vs. existing tools

- **vs. GitHub Copilot analytics:** Copilot measures seats + acceptance rate. RepoLevel measures whether the *repo itself* has evolved — a team can use Copilot daily and still be L0 if nothing is versioned.
- **vs. Linters / SonarQube:** Linters check code quality. RepoLevel checks AI-native operating model.
- **vs. Generic adoption dashboards:** Most "adoption dashboards" show tool usage charts. RepoLevel gives a **level**, **evidence**, and a **PR to fix it**.
- **vs. Consultants / AI adoption audits:** A $50k consulting engagement compressed into a `npx` call.

---

## Stretch / v2 ideas (post-hackathon, but good to mention)

- **Org-wide view:** Scan all repos in an org, show adoption distribution, identify laggards.
- **Policy-as-code:** Org sets a minimum level (e.g., "all repos must be L1 by Q3"); RepoLevel enforces it in CI.
- **Incentive hooks:** Integrate with performance reviews — "team reached L2" as a measurable artifact.
- **Level-specific coaching:** When a repo hits L1, surface learning resources for L2.

---

## TL;DR for the team

Build a tool that scores any repo's AI adoption level, explains the evidence, and opens real PRs to advance it. Demo it live on a sponsor's repo. Win because we're the only team solving the measurement problem the brief explicitly calls out — and we have a dramatic visual moment no other team will match.
