# scoring — Haiku/Sonnet prompt templates

Locked prompts that score, augment, and extract. Versioned in one place
so `apps/api`, `apps/mcp-server`, and `apps/stop-hook` all use the same
wording. Prompt-cache friendly — system prompts stay byte-stable across
calls so cache hit rate is high.

**Templates (spec §18):**
- `score-prompt.ts`   — 5-dim Haiku scorer (lock by hour 4, §18 #1)
- `augment-prompt.ts` — "Have Claude clarify" template (§6, §18 #2)
- `extract-prompt.ts` — Stop hook learning extraction (§18 #3)
- `topic-prompt.ts`   — Prompt Diff topic extraction (§18 #4)

**Why a separate package:** `apps/api` uses score, augment, topic.
`apps/stop-hook` uses extract. `apps/mcp-server` may use extract too.
Sharing prevents the "three slightly different scoring prompts" failure
mode and keeps cost-per-call predictable (Haiku 4.5 ≈ $0.0003/score).

**Spec refs:** §5 (scoring prompt template), §18 (open implementation
questions — which prompts must be locked when)
