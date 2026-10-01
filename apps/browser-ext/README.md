# browser-ext — LearnLoop extension for Claude.ai

The demo headline (spec §2). Live 5-dimension score-card under Claude.ai's
textarea, four widgets injected into the conversation surface, Socratic-mode
augmentation on send. Vanilla TypeScript + esbuild — same toolchain as
`apps/vscode-ext`.

## Surface

| Where | What |
|---|---|
| Below the textarea | Score-card with 5 dimension rows, missing hints, *Improve* / *Send as-is* / *Edit* buttons |
| Each user bubble | Score badge + "Compare to team" link → inline `/diff` panel |
| Each assistant bubble | Outcome chips (👍 / 🤷 / 👎) → /capture |
| Inside the conversation | Wiki toasts driven by 2s `/wiki/recent` polling |

## Behavior (spec §6)

- Scores on send (`POST /score`), not on every keystroke
- ≥7 → no friction (native send fires)
- &lt;7 → the card stays up with *Improve* / *Send as-is* / *Edit* and waits;
  there is no timer and nothing is ever sent automatically
- If the API runs without a model (`TRAILHEAD_LLM=offline`), the card says
  "Rule-based score"
- **Fail-open:** any API error or selector miss → no card, native send still works
- **Kill-switch:** `chrome.storage.local.set({'trailhead.disabled': true})` halts the extension on next load (spec §6.6)

## Install from a release

Each GitHub release carries `learnloop-browser-ext-<version>.zip` (built by
`.github/workflows/release.yml`; every CI run also uploads it as the
`extensions` artifact). Unzip it, then load the folder unpacked as below. It is
not on the Chrome Web Store.

## Build & side-load

```bash
# from the repo root
npm install
npm --workspace=@trailhead/browser-ext run build     # dev build in dist/
npm --workspace=@trailhead/browser-ext run package   # production build + learnloop-browser-ext-<version>.zip
```

`dist/` then contains `manifest.json`, the bundles, `popup.html` and the
icons. Load it as an unpacked extension:

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click *Load unpacked* → select `apps/browser-ext/dist/`
4. Visit `https://claude.ai/` — the score-card mounts on first input.

## Pinned demo Chrome (spec §19)

The original plan was to lock the demo machine to a specific Chrome build by
capturing `chrome://version` into `apps/browser-ext/PINNED_CHROME.txt`. That
file was never created and no build is pinned — treat the selectors as
unverified against any particular Chrome version.

Using a separate Chrome profile (`chrome://settings/manageProfile`) is still
worthwhile so extension state doesn't drift between runs.

## Smoke test

```bash
bash apps/browser-ext/scripts/smoke.sh           # $TRAILHEAD_API_URL, else http://localhost:3000
bash apps/browser-ext/scripts/smoke.sh --local   # force http://localhost:3000
```

Hits `/score`, `/capture`, `/diff`, `/wiki/recent` with the hardcoded demo
team token. Run before each rehearsal.

## Tests

```bash
npm --workspace=@trailhead/browser-ext run test
```

Pure-function tests (hash, augment, diff parser, wiki toast diff), the API
messaging layer (`api.test.mts`: content client → fake worker running the real
worker core → stubbed fetch; `worker-core.test.mts`: allowlist, permissions,
timeouts, aborts, failure codes), plus bundle-load tests that sandbox-execute
`dist/content.js` and `dist/background.js`.

DOM smoke testing on Claude.ai itself is the spec §7.5 manual deliverable —
done with the pinned Chrome build, not in this repo.

## Talks to

`apps/api` only, at the URL set in the popup's **API server** row (default
`http://localhost:3000`).

**Every request is made by the extension's service worker**
(`src/background.ts`, `src/worker-core.ts`), never by the content script:
`src/api.ts` sends a `chrome.runtime` message and the worker does the fetch.
A fetch from the content script would carry the page's origin
(`https://claude.ai`), and Chrome's Local Network Access checks block a public
site from calling `http://localhost` ("access the loopback address space").
The worker has the manifest's host permissions and isn't subject to that. It
reads the API URL and team secret from `chrome.storage` on every request, only
serves the routes the content script uses, and refuses an origin you haven't
granted (the popup requests that permission when you **Save** a
non-localhost URL). Failures, including a 429, come back as a reply and the
content script fails open.

The worker sends the popup-selected team token as `X-Team-Token`, falling back to the public demo token
`trailhead_demo_acme_2026`. `user_id` is a random per-install UUID
(`src/user-state.ts`), or `anonymous` if you untick *Send an anonymous
per-install ID* in the popup's Privacy section.
