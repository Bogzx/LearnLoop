# Trailhead Browser Extension — Design Spec

**Date:** 2026-04-25
**Scope:** `apps/browser-ext/` (new) + `packages/score-card/` (new shared lib)
**Parent spec:** [`2026-04-25-trailhead-design.md`](./2026-04-25-trailhead-design.md) (read §2, §6, §13, §19 first)
**Roadmap referenced:** [`docs/roadmaps/2026-04-25-roadmap-browser-extension.md`](../../roadmaps/2026-04-25-roadmap-browser-extension.md)
**Status:** brainstorming approved; implementation plan to follow via `superpowers:writing-plans`.

---

## 1. Goal

Build the Plan-§2 demo headline: a Chrome MV3 extension that, when side-loaded into a pinned demo Chrome, makes Claude.ai grow a live 5-dimension prompt-quality score-card under the textarea **plus four small widgets injected into the conversation itself**. No popup, no options page, no login — the extension hardcodes the demo team token and the Railway API URL, and it Just Works the moment claude.ai loads.

The pedagogy is the score-card (the user explicitly sees their gaps, every keystroke). The four chat widgets layer behavioral data (skill arc, reuse rate, durable-promotion notification) into the same Claude.ai surface so the §13 storyboard renders entirely inside the browser when needed.

---

## 2. What ships

| Surface | Behavior |
|---|---|
| **Score-card** under the textarea (full card, spec §6) | Mounts on first input. 250 ms debounce → `POST /score`. Renders the 5-dim breakdown via `@trailhead/score-card`. Color: ≥7 green-no-highlight, 4–6 yellow, <4 red. Two buttons: *Send as-is* / *Have Claude clarify*. |
| **Send interception** | Enter and the send button both route through `onSendAttempt`. ≥7 → native send fires. <7 → `preventDefault` for 5 s with a pulse; auto-send unchanged on timeout. *Have Claude clarify* rewrites the textarea with the augmentation template (spec §6) and dispatches the send. |
| **Widget A — Score badge** on every user message | A pill (e.g. `Score 6/10`) on each user bubble. Reads from the in-memory `store` keyed by message-text hash; no extra network call. Hover/tap expands to the 5-dim breakdown. |
| **Widget B — Outcome rating** on every assistant message | 👍 Helpful / 🤷 Mixed / 👎 Not chips. Click → `POST /capture` with `surface: 'browser'`, the previous user prompt, the AI response, the chosen outcome, and the cached scored dimensions. Chips collapse to a "Recorded" pill. |
| **Widget C — Prompt diff** on every user message | "Compare to team" link. Click → `POST /diff` → render the response inline as an expandable panel (user vs team prompts, score deltas, narrative). Re-clicks are instant from the cache. |
| **Widget D — Wiki toast** in-conversation | Polls `GET /wiki/recent?since=<lastSeenIso>` every 2 s while the tab is visible (Page Visibility API). On a new item or a draft→durable transition, append a non-blocking toast inside the conversation. Dismisses on click or after 8 s. |

Out of scope for v1 (explicit cuts):
- Toolbar popup or options page — the only UI is the score-card and the four widgets
- Auth flow / per-team token — hardcoded `trailhead_demo_acme_2026`, single team
- Chrome Web Store publication — side-load only on the pinned demo Chrome
- Cross-provider support — Claude.ai only
- Persistent state across page reloads — re-attach widgets from DOM, not from `localStorage`

---

## 3. Architecture

### File layout

```
apps/browser-ext/
├── package.json            # @trailhead/browser-ext; deps: esbuild, tsx, vitest, jsdom
├── tsconfig.json
├── manifest.json           # MV3, host_permissions: claude.ai + Railway API
├── esbuild.config.mjs      # mirrors apps/vscode-ext/esbuild.config.mjs
├── README.md               # side-load steps + pinned Chrome version
├── scripts/
│   └── smoke.sh            # curl smoke tests against the live API
└── src/                    # tests colocated as *.test.ts next to implementation
    ├── content.ts          # the only content-script entry; injects into claude.ai
    ├── selectors.ts        # ALL Claude.ai DOM selectors with fallback chains
    ├── score-card.ts       # under-textarea mount; debounced /score
    ├── send-intercept.ts   # Enter / send-button hook; ≥7/<7 logic; augmentation
    ├── augment.ts          # augment(prompt, missing) → augmented string (spec §6)
    ├── augment.test.ts
    ├── widgets/
    │   ├── score-badge.ts        # widget A
    │   ├── outcome-rating.ts     # widget B
    │   ├── outcome-rating.test.ts
    │   ├── prompt-diff.ts        # widget C
    │   └── wiki-toast.ts         # widget D
    ├── api.ts              # fetch wrappers; AbortController; fail-open contract
    ├── api.test.ts
    ├── hash.ts             # simpleHash(s)
    ├── hash.test.ts
    ├── store.ts            # in-memory map: msgHash → { overall, dimensions, captureId? }
    └── styles.ts           # injected <style> with id-namespaced CSS

packages/score-card/        # NEW shared package
├── package.json            # @trailhead/score-card
├── src/
│   ├── render.ts           # pure DOM: renderScoreCard(scoreResponse) → HTMLElement
│   ├── render.test.ts      # vitest + jsdom
│   └── index.ts            # re-exports
```

### Toolchain

- **TypeScript + esbuild** — same config style as the existing `apps/vscode-ext`
- **MV3 manifest** hand-written; no Plasmo, no WXT, no React
- **vitest + jsdom** for tests
- **`@trailhead/shared`** for the locked request/response types
- **`@trailhead/score-card`** (new) — the pure DOM render function shared with the VS Code webview

### Why vanilla TS over Plasmo or WXT

1. The card and four widgets are static-ish DOM injected into a foreign page — React buys nothing
2. Same toolchain as the existing VS Code extension (esbuild) — one fewer thing to learn
3. Fastest path to the spec §19 hour-6 DOM smoke test (~30 min scaffold vs ~1.5 h with Plasmo)
4. Plasmo's known Windows path issues (spec §19 risk register) don't apply
5. Extracting `packages/score-card/render.ts` from existing vanilla `webview.ts` is a small refactor; from React would be a rewrite

### Deployment

- `npm --workspace=apps/browser-ext run build` produces `apps/browser-ext/dist/` (manifest + bundled `content.js` + assets)
- Demo machine loads `dist/` as an unpacked extension once, never again
- Disable on stage: `chrome.storage.local.set({'trailhead.disabled': true})` from DevTools (kill-switch — see §5)

---

## 4. Components

Six visible UI pieces and three invisible coordinators.

### 4.1 Score-card (`score-card.ts`)
- Mounts a `<div id="trailhead-score-card">` immediately below the textarea using the `score-card-anchor` selector from `selectors.ts`
- Listens to the textarea's `input` event with a 250 ms debounce
- On each debounced fire: hash the prompt, dedup against `store.lastHash`, abort any in-flight `/score`, call `api.score`, render via `renderScoreCard` from `@trailhead/score-card`
- Hidden when textarea is empty
- The two action buttons live inside the card: *Send as-is* invokes `triggerNativeSend()`; *Have Claude clarify* invokes `augmentAndSend()`

### 4.2 Score badge (`widgets/score-badge.ts`) — Widget A
- Mounts a small pill on every user bubble the MutationObserver surfaces
- Looks up `store.get(hash(bubbleText))`; if a score exists, render `Score N/10` colored by `colorForScore(N)`; if not, render nothing (silent)
- Click toggles a tooltip showing the same 5-dim breakdown the score-card uses (reuses `renderScoreCard`)

### 4.3 Outcome rating (`widgets/outcome-rating.ts`) — Widget B
- Mounts three chips (👍 / 🤷 / 👎) under each assistant bubble
- Click → `api.capture({ surface: 'browser', user_prompt, ai_response, outcome, scored_dimensions })`
- Replace chips with a "Recorded" pill on success; revert to clickable on `null` response (fail-open)

### 4.4 Prompt diff (`widgets/prompt-diff.ts`) — Widget C
- Mounts a "Compare to team" link on each user bubble
- Click → `api.diff({ user_prompt, file_path?, user_id: 'demo' })`
- Renders the response as an expandable inline panel below the bubble: user prompt vs team prompt side-by-side, score deltas, narrative text
- Caches the response in `store` keyed by user-prompt hash; subsequent clicks toggle the cached panel

### 4.5 Wiki toast (`widgets/wiki-toast.ts`) — Widget D
- Boot at content-script start; sets `lastSeenIso = new Date(Date.now() - 60*60*1000)` initially
- Every 2 s, if `document.visibilityState === 'visible'`: `api.wikiRecent(lastSeenIso)`
- For each item: compare against `wikiState.get(item.id)`; on first sight, on draft→durable transition, or on reinforcement_count increment, render a toast inside the conversation root. Update `wikiState` and `lastSeenIso` after each tick.
- Toasts auto-dismiss after 8 s or on click

### 4.6 Augmentation flow (`send-intercept.ts`)
- Hooks both Enter (textarea `keydown`) and the send button (`click`)
- `onSendAttempt`:
  - `overall = store.get(currentHash)?.overall ?? 10` (optimistic on missing)
  - If `overall >= 7`: return — native send fires
  - Else: `preventDefault`, pulse card 5 s, race `clarify-click | as-is-click | timeout`
- `augmentAndSend`: build augmented string via `augment(prompt, missing)` (spec §6 wording), set textarea value, dispatch synthetic `input` event, then trigger native send

### 4.7 Selector layer (`selectors.ts`)
- Single source of truth for all Claude.ai DOM selectors with fallback chains
- `resolveSelectors()` returns `{ textarea, sendButton, messageList, scoreCardAnchor } | null`
- One file change is the entire response surface for a Claude.ai DOM update

### 4.8 API wrapper (`api.ts`)
- Every `fetch` flows through here; sets the `X-Team-Token` header from a hardcoded constant
- 4 s default timeout via `AbortController`
- Returns `null` on any non-2xx, network error, abort, or JSON parse error — never throws to callers
- Exposes per-endpoint `AbortController` registers so the next `/score` call cancels the previous one

### 4.9 Store (`store.ts`)
- In-memory `Map<hash, { overall, dimensions, captureId? }>`
- `wikiState: Map<string, WikiRecentItem>` for toast dedup
- No persistence; on page reload we lose old scores (acceptable per §2)

---

## 5. Data flow

### 5.1 Page load
1. `content.ts` runs in the Claude.ai page
2. `chrome.storage.local.get('trailhead.disabled')` — if `true`, exit immediately
3. `resolveSelectors()`; if `null`, schedule a 5 s retry, log `[trailhead] dom-mismatch`, exit silently
4. Inject `<style>` from `styles.ts`
5. Mount the score-card root `<div>`
6. Start the `MutationObserver` on the message-list root
7. Start the wiki-toast 2 s poll loop

### 5.2 Live scoring loop
```
input event → 250 ms debounce → hash = simpleHash(textarea.value)
  → if hash === lastHash: skip                  (dedup)
  → abort any in-flight /score
  → api.score({ prompt, file_path?, user_id: 'demo' })
  → on success: store.set(hash, response); render-score-card(response)
  → on null  : hide card                         (fail-open)
```

### 5.3 Send paths (Enter or send-button click both route to `onSendAttempt`)
```
overall = store.get(currentHash)?.overall ?? 10  (optimistic on missing)
if overall ≥ 7 → return; native send fires; no card highlight
else → preventDefault
       pulse card 5 s
       wait for one of: clarify-click | as-is-click | 5 s timeout
       clarify  → textarea.value = augment(prompt, missing); dispatchInputEvent; native send
       as-is    → native send
       timeout  → native send
```

### 5.4 Widget attachment (driven by the MutationObserver)
- New user-bubble node:
  - `score-badge` looks up `store.get(hash(text))` → renders pill (or hides if no score available)
  - `prompt-diff` adds the "Compare to team" link
- New assistant-bubble node:
  - `outcome-rating` mounts the three chips
- Click on a chip:
  - `api.capture(...)` → store the returned id; replace chips with "Recorded" pill
- Click on "Compare to team":
  - `api.diff(...)` → render the panel inline; cache in `store` keyed by user-prompt hash so re-clicks are instant

### 5.5 Wiki toast loop
```
every 2 s while document.visibilityState === 'visible':
  api.wikiRecent(lastSeenIso)
  for each item:
    prev = wikiState.get(item.id)
    if !prev:                                  toast(`Wiki created: «${item.body}»`)
    elif item.status === 'durable' && prev.status === 'draft':
                                               toast(`«${item.body}» — promoted to durable`)
    elif item.reinforcement_count > prev.reinforcement_count:
                                               toast(`«${item.body}» — reinforced ${count}/3`)
    wikiState.set(item.id, item)
  lastSeenIso = max(lastSeenIso, items.last_seen_at)
```

### 5.6 Persistence
None across reloads. `wikiState` resets and `lastSeenIso` defaults to `Date.now() - 1 h` so a fresh tab surfaces recent activity without spam.

---

## 6. Error handling

**The contract:** every error path defaults to letting Claude.ai work normally. We add value when our code works; we never subtract value when it breaks.

### 6.1 Network errors (chokepoint: `api.ts`)
- Every `fetch` is wrapped in `try / catch` with a 4 s `AbortController` timeout
- Any 4xx, 5xx, abort, or parse error → return `null`, log `console.warn`
- Callers always handle `null` — no helper throws
- `/score` failure → hide the card; send proceeds; `onSendAttempt` treats unknown overall as ≥7
- `/capture` failure → silent no-op; chips revert to clickable
- `/diff` failure → single line in the panel: *"Couldn't reach the team comparison — try again."* — no retry storm
- `/wiki/recent` failure → skip this tick; after 5 consecutive failures, back off to 30 s polling (cheap circuit breaker, no UI change)

### 6.2 Selector failures (the spec §19 #1 risk)
- `resolveSelectors()` returns `null` on first miss
- We log `[trailhead] dom-mismatch` and don't mount anything; Claude.ai is fully usable
- Each selector has a fallback chain (e.g., `[contenteditable="true"]` → `textarea[data-testid="composer"]` → first `<textarea>` in the composer region); one step in the chain is allowed to fail silently
- Periodic 5 s retry: a SPA navigation that delays the DOM shouldn't permanently disable us

### 6.3 Send-intercept races
- `/score` in flight when Enter fires → optimistic ≥7 (don't block the user)
- Enter pressed twice within the 5 s nudge window → second press auto-sends regardless of clarify state
- Augmentation guards double-send via a `sentOnce` flag scoped to the current submit attempt

### 6.4 Widget-mount failures
- Each widget's `mount(bubble)` body is wrapped in `try / catch`
- Throw → log + skip that bubble; other widgets on other bubbles keep working

### 6.5 Top-level safety net
- `window.addEventListener('error', ...)` and `window.addEventListener('unhandledrejection', ...)` swallow Trailhead-originated errors only (filter by stack trace containing our extension id)
- Anything else bubbles to Claude.ai's own handler

### 6.6 Demo-day kill switch
- `chrome.storage.local.get('trailhead.disabled')` — if `true`, content script exits immediately
- Lets the demonstrator turn off the extension in 2 keystrokes if it misbehaves on stage
- No toggle UI needed for the demo (flip via DevTools console)

---

## 7. Testing strategy

Test pyramid: fast feedback first, expensive checks last.

### 7.1 Unit tests (vitest, no DOM)
- `simpleHash(s)` — deterministic same-input-same-output; collisions acceptable
- `augment(prompt, missing)` — template fills correctly for 0 / 1 / 2 / 3+ missing dimensions; matches spec §6 wording verbatim
- `colorForScore(n)` — boundaries at 0 / 3 / 4 / 6 / 7 / 10
- `parseDiffResponse(json)` — handles missing `narrative` field gracefully

### 7.2 DOM render tests (vitest + jsdom)
- `renderScoreCard(scoreResponse)` from `packages/score-card` — given a known response, the rendered tree has 5 dimension rows, the right color classes, the missing-hint text where expected, `data-testid` hooks our integration tests target
- Re-rendering with a new score updates in place (no flicker)
- `mountOutcomeRating(bubble)` — three buttons present, click invokes the supplied callback exactly once, then chips collapse
- `mountWikiToast(item, container)` — toast appears, dismisses on click and after 8 s

### 7.3 API wrapper tests (vitest, mocked `fetch`)
- 200 → returns parsed body
- 401 / 500 / timeout → returns `null`
- Concurrent calls → previous request aborted (assert `AbortController.abort` was invoked)
- `X-Team-Token` header set on every request

### 7.4 Live API smoke test (`apps/browser-ext/scripts/smoke.sh`)
```bash
curl -s -X POST $TRAILHEAD_API_URL/score \
  -H "Content-Type: application/json" \
  -H "X-Team-Token: $TRAILHEAD_TEAM_TOKEN" \
  -d '{"prompt":"fix the retry","user_id":"demo"}' | jq .
```
Hand-runnable; covers `/score`, `/capture`, `/diff`, `/wiki/recent`. Run before each integration session.

### 7.5 Manual DOM smoke test on Claude.ai (the spec §19 hour-6 deliverable)
- Pinned Chrome build noted in `apps/browser-ext/README.md` (capture from `chrome://version`)
- Selector matrix checklist committed to the repo:
  - Fresh conversation, first message
  - Reply within an existing conversation
  - With one or more file attachments
  - Multiline (Shift+Enter)
  - Paste (large clipboard)
  - Slow / fast typing
- Screen recording captured as the spec §19 fallback at hour 18, refreshed at hour 22

### 7.6 Integration rehearsal (the §13 storyboard, 3× consecutively, by hour 18)
- Open pinned Chrome → claude.ai
- Type *"fix the retry"* → score 3/10 with red rows
- Iterate to *"in src/api/webhooks/handler.ts, fix the retry"* → score climbs to 6/10
- Click *Have Claude clarify* → Claude asks 2-3 clarifying questions
- Answer them → Claude gives a perfect answer
- Wiki toast appears in-conversation (driven by Claude Code in the integrated terminal calling `wiki.update_learnings` via MCP)
- Click outcome rating on the assistant message → "Recorded" pill
- Click "Compare to team" on a user message → diff panel expands inline
- Pass criteria: every visible step in §13 fires; no UI lag >300 ms; no console errors with our extension id in the stack

### 7.7 Failure-mode rehearsal
- Manually break `TRAILHEAD_API_URL` to a 500 endpoint → confirm card hides, native send works, no error toast, console clean
- Manually edit a `selectors.ts` selector to a non-existent string → confirm no widgets mount, Claude.ai is fully usable
- Run with `chrome.storage.local.set({'trailhead.disabled': true})` → extension does nothing

### 7.8 Test-first discipline
Pure functions get tests before implementation: `simpleHash`, `augment`, `colorForScore`, `parseDiffResponse`, the score-card render. DOM-mount logic and the MutationObserver flow lean on jsdom integration tests after, plus the manual smoke test above. The `superpowers:test-driven-development` skill drives this during implementation.

---

## 8. Definition of done

- [ ] `apps/browser-ext/` builds via `esbuild`; `dist/` loads as an unpacked MV3 extension on the pinned demo Chrome
- [ ] `packages/score-card/` extracted from `apps/vscode-ext/src/webview.ts`; both surfaces import it; vitest tests pass
- [ ] Score-card mounts under the textarea on claude.ai, updates live as the user types (250 ms debounce)
- [ ] Score-card visual matches §6 (5 rows, color-coded, missing hints), uses option A layout (full card below textarea)
- [ ] ≥7 → no friction; <7 → 5 s nudge with auto-send fallback; *Have Claude clarify* augments and sends
- [ ] Widget A (score badge), B (outcome rating), C (prompt diff), D (wiki toast) all mount on the right bubbles, all wire to the right endpoints
- [ ] `selectors.ts` covers all six DOM test cases (§7.5) on the pinned Chrome
- [ ] Fail-open verified: API down → no card, native send works, no console error, no widgets mount
- [ ] Kill-switch verified: `trailhead.disabled` flag turns the extension off
- [ ] Live smoke test (`apps/browser-ext/scripts/smoke.sh`) passes against the Railway endpoint
- [ ] §13 storyboard runs 3× consecutively without intervention by hour 18
- [ ] Fallback recording exists at hour 18, refreshed at hour 22

---

## 9. Open implementation questions

These resolve during implementation, not now:

1. **Send button selector strategy** — Claude.ai may rotate `aria-label` or test-id strings. Document the actual selectors discovered during the hour-6 smoke test in `selectors.ts`, with at least 2 fallbacks per role.
2. **Augmentation template wording** — coordinate with Person D (backend Person who owns the augmentation prompt) before hour 6 so we ship one canonical string. Lives as a constant in `send-intercept.ts`, source-of-truth in `packages/shared/`.
3. **Toast container** — where in the conversation DOM does the wiki toast attach? Option α: inside the message-list root, scrolling with content. Option β: fixed-position overlay anchored to the conversation pane's top-right. Decide during the hour-6 smoke test.
4. **Score-card root mount** — directly below the composer (preferred) or below the entire input area including buttons? Pick whichever survives Claude.ai layout changes best when tested at hour 6.
5. **`packages/score-card/` extraction** — does the existing `apps/vscode-ext/src/webview.ts` use a structure clean enough to extract directly, or do we write `render.ts` fresh and refactor the VS Code webview to use it second? The implementation plan should call this out.

---

## 10. References

- Parent spec: `docs/superpowers/specs/2026-04-25-trailhead-design.md`
- Browser-ext roadmap: `docs/roadmaps/2026-04-25-roadmap-browser-extension.md`
- Shared types: `packages/shared/types.ts`
- Existing API: `apps/api/src/index.ts` (deployed at `https://trailheadapi-production.up.railway.app`)
- Existing VS Code ext (score-card source for extraction): `apps/vscode-ext/src/webview.ts`
- Sibling lane (MCP / Hook / VS Code): `docs/roadmaps/2026-04-25-roadmap-mcp-vscode-hook.md`
