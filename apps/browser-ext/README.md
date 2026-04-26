# browser-ext — LearnLoop extension for Claude.ai

The demo headline (spec §2). Live 5-dimension score-card under Claude.ai's
textarea, four widgets injected into the conversation surface, Socratic-mode
augmentation on send. Vanilla TypeScript + esbuild — same toolchain as
`apps/vscode-ext`.

## Surface

| Where | What |
|---|---|
| Below the textarea | Score-card with 5 dimension rows, missing hints, *Send as-is* / *Have Claude clarify* buttons |
| Each user bubble | Score badge + "Compare to team" link → inline `/diff` panel |
| Each assistant bubble | Outcome chips (👍 / 🤷 / 👎) → /capture |
| Inside the conversation | Wiki toasts driven by 2s `/wiki/recent` polling |

## Behavior (spec §6)

- 250 ms debounce on input → `POST /score`
- ≥7 → no friction (native send fires)
- &lt;7 → 5 s nudge with *Have Claude clarify* / *Send as-is*; auto-sends as-is on timeout
- **Fail-open:** any API error or selector miss → no card, native send still works
- **Kill-switch:** `chrome.storage.local.set({'trailhead.disabled': true})` halts the extension on next load (spec §6.6)

## Build & side-load

```bash
# from the repo root
npm install
npm --workspace=@trailhead/browser-ext run build
```

`dist/` then contains `manifest.json` + `content.js`. Load it as an unpacked
extension:

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click *Load unpacked* → select `apps/browser-ext/dist/`
4. Visit `https://claude.ai/` — the score-card mounts on first input.

## Pinned demo Chrome (spec §19)

Lock the demo machine to a specific Chrome build. After verifying the
selectors at hour 6, capture `chrome://version` to:

```
apps/browser-ext/PINNED_CHROME.txt
```

Use a separate Chrome profile for the demo (`chrome://settings/manageProfile`)
so extension state doesn't drift.

## Smoke test

```bash
bash apps/browser-ext/scripts/smoke.sh           # against live Railway
bash apps/browser-ext/scripts/smoke.sh --local   # against http://localhost:3000
```

Hits `/score`, `/capture`, `/diff`, `/wiki/recent` with the hardcoded demo
team token. Run before each rehearsal.

## Tests

```bash
npm --workspace=@trailhead/browser-ext run test
```

Pure-function tests (hash, augment, diff parser, wiki toast diff,
fetch-stubbed API wrapper) plus a bundle-load test that sandbox-executes
`dist/content.js` and asserts the `[trailhead]` log fires.

DOM smoke testing on Claude.ai itself is the spec §7.5 manual deliverable —
done with the pinned Chrome build, not in this repo.

## Talks to

`apps/api` only (Hono on Railway). Hardcoded URL +
`X-Team-Token: trailhead_demo_acme_2026` (spec §3, no per-team auth in v1).
