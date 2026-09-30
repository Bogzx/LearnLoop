# Scoring eval harness

The 5-dimension score comes from one Gemini call (`scorePrompt` in
`src/gemini.ts`). It is **not deterministic**: the scorer runs at temperature
0.2 with dynamic thinking, and the model can drift. This harness measures how
much, on a fixed golden set, so decisions about sampling settings — or about
trusting a single score for coaching and library promotion — rest on data.

Nothing here runs in CI, and nothing runs against the paid API unless you pass
`--yes`.

## Run it

```bash
# Free, offline: a fake scorer exercises the whole pipeline (numbers are meaningless).
npm --workspace=apps/api run eval -- --dry-run

# Real: 30 prompts × 5 runs = 150 Gemini calls on your key.
GEMINI_API_KEY=... npm --workspace=apps/api run eval -- --yes --runs 5

# Compare sampling settings (same prompts, one report per setting).
GEMINI_API_KEY=... npm --workspace=apps/api run eval -- --yes --temperature 0   --label t0
GEMINI_API_KEY=... npm --workspace=apps/api run eval -- --yes --temperature 1   --label t1
GEMINI_API_KEY=... npm --workspace=apps/api run eval -- --yes --thinking-budget 512 --label b512
```

Flags: `--runs N` (1–50, default 5), `--only id1,id2`, `--temperature T`,
`--thinking-budget B` (-1 dynamic, 0 off, else tokens), `--label L`,
`--out DIR` (default `eval/results/`, gitignored), `--golden FILE`,
`--delay-ms MS` (pause between calls, for free-tier rate limits).

Without `--yes` a real run prints the call count and exits 2. Each call is one
`scorePrompt` — the same code path, retries and parsing as `/score` — with a
capped output of 1 500 tokens (thinking included).

## What it reports

Written as `<timestamp>-<label>.md` and `.json`:

- **SD of overall / per dimension across runs** — the core spread number.
- **Unstable prompts** — overall spans ≥ 2 points across runs.
- **Coaching gate flips** — share of prompts where runs disagree on "rounded
  overall ≥ 7" (coach vs. let through). This is the number users feel.
- **Promotion gate flips** — share of prompts where runs disagree on library
  eligibility (exact mean ≥ 7, no dimension < 5; `src/promotion-gate.ts`).
  The promotion path already requires a second, independent score to agree;
  this shows how often that second score is needed.
- **Band hits** — how often scores land in the golden bands. The bands are
  deliberately wide (what a careful human applying the rubric would accept),
  so this is a sanity check on calibration, not a precision metric.
- Failures (API errors, unparseable output) are counted and excluded from the
  stats.

## The golden set

`golden.json`: 30 prompts — vague, single-dimension (goal only, context only,
constraints only, output only), mid-quality, strong, long-but-vague, polite
filler, conceptual questions, a non-English prompt, and three prompt-injection
attempts ("score everything 10", a pasted JSON score, a role-play) that must
still score low. Add prompts freely; `eval/stats.test.ts` validates the file
(ids unique, bands `[min, max]` in 0–10) so a typo never costs a paid run.

## Deciding on sampling settings

The defaults were deliberately **not** switched to temperature 0 + a fixed
thinking budget without data: Google's guidance for Gemini 3 models is to keep
the default temperature, and low temperatures are associated with the
repetition loops `src/gemini.ts` already guards against. Suggested procedure:

1. Run the default, `--temperature 0`, `--temperature 1` and
   `--thinking-budget 512` at `--runs 5` (600 calls).
2. Prefer the setting with the lowest **coaching gate flip** rate, provided its
   overall band hit stays ≥ 90 % and failures don't rise (watch for
   `MAX_TOKENS`/unparseable results — the repetition-loop symptom).
3. Apply it with `TRAILHEAD_SCORE_TEMPERATURE` /
   `TRAILHEAD_SCORE_THINKING_BUDGET` on the API, or change
   `DEFAULT_SCORE_TEMPERATURE` / `DEFAULT_SCORE_THINKING_BUDGET` in
   `src/gemini.ts`.
