# browser-ext — Plasmo extension for Claude.ai

The demo headline. Live 5-dim score-card under Claude.ai's textarea,
Socratic-mode augmentation on send. The visceral cross-platform "wow" moment.

**Tech:** Plasmo + TypeScript + React. Side-loaded into a **pinned Chrome
build** for the demo (spec §19 risk register).

**Behavior (spec §6):**
- 250ms debounce on input → `POST /score`
- Renders score-card below textarea: 5 dimensions + "missing" hints
- On send: ≥7 → no friction (native send fires); <7 → 5s nudge with
  "Have Claude clarify" then auto-sends as-is if user does nothing
- **Fail-open:** if `/score` 500s, no card, native send proceeds
- Every send writes a `skill_observation` (the arc data is real)

**Talks to:** `apps/api` only.

**Spec refs:** §2, §6 (Socratic Mode), §19 (DOM-change risk + fail-open rule)
