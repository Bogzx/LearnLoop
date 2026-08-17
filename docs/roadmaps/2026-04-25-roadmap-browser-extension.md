# Roadmap — Browser Extension on Claude.ai (Person B)

> **Historical document.** The host `trailheadapi-production.up.railway.app`
> referenced below is DELETED and returns 404. Trailhead is self-hosted now:
> bring an API up with `docker compose up` (see `SELFHOSTING.md`) and use
> `http://localhost:3000`. Do not copy the URLs below into a config.

**Date:** 2026-04-25 (PoliHack 24h hackathon)
**Spec:** [`docs/superpowers/specs/2026-04-25-trailhead-design.md`](../superpowers/specs/2026-04-25-trailhead-design.md) — read §6 (Socratic Mode) first
**Status as of writing:** unblocker complete (shared types locked, Hono stub deployed at `https://trailheadapi-production.up.railway.app`, CORS verified open)

---

## 1. What you own

A single Plasmo browser extension targeting **Claude.ai**. This is the **headline demo artifact** — the visceral cross-platform "wow" moment in the §13 storyboard.

The flow:

1. User types a prompt; extension live-scores it (250ms debounce → POST /score)
2. A score-card renders below the textarea: 5 dimensions + missing hints
3. On send:
   - **Score ≥ 7** → no friction. Native send fires. No card highlight. Power users see zero interruption.
   - **Score < 7** → extension `preventDefault`s for **5 seconds**. Card pulses: *"Send as-is or have Claude clarify?"* If the user does nothing, the send goes through unchanged. **We never block the user.**
4. Clicking "Have Claude clarify" augments the prompt with a coaching addendum and sends.
5. Every send writes a real `skill_observation` row — the dashboard's skill arc is real, not seeded.

**The score-card is the pedagogy** (the user explicitly sees what they're missing — that is L1→L2). **The augmentation is the optional accelerator.** Never block the user.

---

## 2. The single most-important early task: DOM SMOKE TEST AT HOUR 6

Spec §19 calls this the highest-leverage risk mitigation in the entire build. **By hour 6**:

- **Pin the exact Chrome (or Edge) build** you'll demo with — note the version from `chrome://version` and lock it. Use a **separate Chrome profile** for the demo to prevent extension/setting conflicts.
- Verify these selectors are stable on Claude.ai:
  - The textarea / contenteditable element
  - The send button (and its `aria-label` / `data-testid` if any)
  - The DOM that holds rendered messages (for capture, later)
- Test the selectors across:
  - First message in a conversation
  - Subsequent messages
  - With files attached
  - With multiline input (Shift+Enter)
  - With paste events
- **Record a fallback screen recording at hour 18, refresh at hour 22.**

If Claude.ai's DOM has changed since the spec was written, you have 16 hours to adapt. If you discover this at hour 22, the demo dies.

This is your single biggest risk. Do it at hour 6, not hour 22.

---

## 3. Integration handshake (locked — do not change)

The unblocker phase already settled the API URL, the team token, and the request/response shapes. Wire to these directly.

```ts
const API_URL = "https://trailheadapi-production.up.railway.app";
const TEAM_TOKEN = "trailhead_demo_acme_2026";

// Every request:
// fetch(`${API_URL}/score`, {
//   method: 'POST',
//   headers: { 'Content-Type': 'application/json', 'X-Team-Token': TEAM_TOKEN },
//   body: JSON.stringify({ prompt, file_path, user_id: 'demo' }),
// })
```

**CORS is verified open**: `Access-Control-Allow-Origin: *`, allows `X-Team-Token` and `Content-Type`, allows GET/POST/OPTIONS. The extension can call the API directly from the content script — no proxy, no background-script bouncing required.

Types from `packages/shared/types.ts` (import as `@trailhead/shared`):

```ts
interface ScoreRequest  { prompt: string; file_path?: string; user_id: string; }
interface ScoreResponse { overall: number; dimensions: DimensionScores; missing: MissingHints; }

interface CaptureRequest {
  surface: 'browser' | 'vscode' | 'mcp';   // use 'browser' here
  user_prompt: string;
  ai_response?: string;
  file_path?: string;
  outcome?: 'helpful' | 'mixed' | 'not';
  scored_dimensions?: DimensionScores;
  user_id: string;
}
interface CaptureResponse { id: string; }

type Dimension =
  | 'goal_clarity' | 'specificity' | 'context_loading'
  | 'constraint_articulation' | 'output_specification';
type DimensionScores = Record<Dimension, number>;
type MissingHints    = Partial<Record<Dimension, string>>;
```

For the browser surface, set `surface: 'browser'` and `user_id: 'demo'` (no real auth in v1).

---

## 4. The roadmap (22 hours, hours 2–24 of the build)

You're starting at hour 2. The unblocker is done. Five phases.

### Phase 1 · Plasmo scaffold + DOM smoke test (hours 2–6)

**This phase's deliverable is "we know we can build the rest."**

#### 1A. Plasmo scaffold (~1 h)

```bash
cd apps/browser-ext
pnpm create plasmo --with-typescript .   # or `npm create plasmo`
```

Edit the manifest contributions in `package.json` so Plasmo emits the correct manifest:

```json
"manifest": {
  "host_permissions": [
    "https://claude.ai/*",
    "https://trailheadapi-production.up.railway.app/*"
  ],
  "permissions": ["storage"]
}
```

Add a content script `contents/claude-ai.ts` that runs on `https://claude.ai/*` and just logs `[trailhead] loaded on ` + location.href. Build with `pnpm dev`, load unpacked into Chrome (`chrome://extensions/` → Developer mode → Load unpacked → `build/chrome-mv3-dev`), visit `claude.ai`, confirm the console log.

**Milestone:** content script runs on Claude.ai, console log visible.

#### 1B. DOM smoke test (~2–4 h, expand to fit)

This is the make-or-break work of Phase 1.

1. Open Claude.ai with DevTools.
2. Identify and document selectors. Likely candidates:
   - **Input:** `[contenteditable="true"]` inside the composer; or a `<textarea>` with `data-testid` or aria attributes
   - **Send button:** `button[aria-label="Send Message"]` or similar
   - **Message list root:** for later DOM-observer-based capture
3. Write the selector list at the top of `contents/claude-ai.ts` as `const SELECTORS = { ... }`. If any selector breaks across the test cases, document a fallback chain.
4. **Test cases** (run each manually, document what you see):
   - Fresh conversation, first message
   - Reply within an existing conversation
   - With one or more file attachments
   - Multiline input via Shift+Enter
   - Paste event (large clipboard content)
   - Slow / fast typing
5. **Pin the browser version.** Note the Chrome build in `chrome://version`. Lock the demo machine to this version. Use a separate Chrome profile (`chrome://settings/manageProfile`) so demo state doesn't drift.

**Milestone:** all DOM selectors confirmed working across cases; selectors documented in code; browser version pinned.

#### 1C. Hello-world score-card placeholder (~1 h)

Inject a fixed `<div id="trailhead-card">` below the input element. For now, just the static text *"Trailhead loaded — score will appear here."* This proves DOM injection works in the right place without breaking Claude.ai's layout. No fetch yet.

**End of Phase 1:** scaffold runs, DOM selectors stable, browser pinned, placeholder card visible on Claude.ai.

---

### Phase 2 · Score-card live + send interception (hours 6–10)

This is where the L1→L2 demo moment becomes real.

#### 2A. Detect input + debounced /score (~1.5 h)

```ts
const TEXTAREA = document.querySelector(SELECTORS.input);
let lastPromptHash: string | null = null;
let inFlightAbort: AbortController | null = null;

const score = debounce(async (prompt: string) => {
  const hash = simpleHash(prompt);
  if (hash === lastPromptHash) return;   // dedup: same prompt → skip
  lastPromptHash = hash;

  inFlightAbort?.abort();
  inFlightAbort = new AbortController();

  try {
    const res = await fetch(`${API_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Team-Token': TEAM_TOKEN },
      body: JSON.stringify({ prompt, user_id: 'demo' }),
      signal: inFlightAbort.signal,
    });
    if (!res.ok) return;   // fail open
    const data: ScoreResponse = await res.json();
    renderCard(data);
  } catch (e) {
    // Aborted or network error — fail open, no card highlight
  }
}, 250);

TEXTAREA.addEventListener('input', () => score(TEXTAREA.value));
```

**Fail-open is non-negotiable:** if `/score` returns 500 or times out, hide the card and let the user send unchanged.

#### 2B. Render the score-card (~2 h)

The card sits below the textarea. Render rows:

```
Score: 4/10  ⓘ
  ✓ goal_clarity        8
  ✓ specificity         6
  ✗ context_loading     2  — no file or function referenced
  ✗ constraints         1  — no constraints stated
  ✗ output_spec         3  — no return shape requested

[ Send as-is ]   [ Have Claude clarify (auto-improve) ]
```

Color rules:
- ≥ 7 = green
- 4–6 = yellow
- < 4 = red
- The card **does not highlight** when overall ≥ 7 (passive coaching for power users)

**Coordinate with Person C (VS Code ext):** the score JSON is identical. Write a vanilla DOM render function in `packages/score-card` and import it from both surfaces. Do NOT each implement it independently.

#### 2C. Send interception (~1.5 h)

Hook both Enter-to-send and click-on-send-button. The logic:

```ts
function onSendAttempt(e: Event) {
  const overall = currentScore?.overall ?? 10;   // optimistic on failure
  if (overall >= 7) return;   // ≥7 → no friction, native send fires

  // <7 → preventDefault for 5 seconds
  e.preventDefault();
  pulseCard();   // visual cue
  let userActed = false;

  const onClarify = () => { userActed = true; sendAugmented(); };
  const onSendAsIs = () => { userActed = true; sendNative(); };
  bindCardButtons(onClarify, onSendAsIs);

  setTimeout(() => {
    if (!userActed) sendNative();   // auto-send unchanged after 5s
  }, 5000);
}
```

The `/score` call already wrote the `skill_observation` rows server-side, so the dashboard's skill arc updates regardless of which path the user takes.

#### 2D. Fail-open verification (~30 min)

Manually break the API URL (e.g., point at a 500-returning route). Confirm:
- No card visible
- Native send works
- No errors in Claude.ai's console that block the user

**End of Phase 2:** live score-card on Claude.ai, working ≥7/<7 threshold, fail-open verified.

---

### Phase 3 · "Have Claude clarify" augmentation (hours 10–14)

The accelerator path. Transforms the user's prompt into a coaching-augmented version that asks clarifying questions before answering.

#### 3A. Augmentation template (~30 min)

Lock the template by hour 6 — coordinate with Person D for the canonical wording. From spec §6:

```
<original prompt>

---
[Trailhead coaching: This prompt is missing <missing_dim_1> and <missing_dim_2>.
Before answering, please ask the user 2-3 clarifying questions:
- Which file/folder is the <topic> in?
- What library or helper is currently used (e.g. <example>)?
- What constraints apply (max attempts, idempotency, jitter)?
Only proceed once these are clarified.]
```

Fill the placeholders dynamically based on the score response's `missing` field.

#### 3B. Augmentation flow (~1.5 h)

When "Have Claude clarify" is clicked:

1. Build the augmented string from the original textarea content + the template.
2. Replace the textarea content. **Important:** Claude.ai may use a controlled input — set the value AND dispatch an `input` event, or for contenteditable elements, replace innerHTML and dispatch a synthetic event.
3. Trigger send (programmatic click on the send button, or dispatch a Keyboard Enter event).

Test against actual Claude responses to make sure Claude obeys the augmentation (asks the questions rather than answering directly). If Claude ignores the addendum, tune the wording.

#### 3C. Capture writeback (~1 h, can defer)

After send, observe the DOM for the AI response. POST `/capture` with surface=`browser`, user_prompt, ai_response, scored_dimensions. This is for later analytics — not required for the demo, but improves the reuse-rate KPI on the dashboard.

**End of Phase 3:** full flow — typing → score-card → "Have Claude clarify" → augmented prompt → Claude asks clarifying questions → better answer.

---

### Phase 4 · Polish + edge cases + fallback recording (hours 14–18)

#### 4A. Edge cases (~2 h)

- **Multiline prompts:** Shift+Enter inserts a newline; the score should keep updating, the score-card should not visually break
- **Paste events:** large pastes (e.g., a 200-line code snippet) must score quickly. Test: paste, score returns within ~1s.
- **Rapid typing:** the 250ms debounce should hide most score requests; `same-prompt-hash` dedup catches the rest
- **Stale scores:** if a request is in flight when the user changes the prompt, the old response should be ignored (use `AbortController`)
- **First-load latency:** when the extension first injects, defer the card render until after the first input event — don't show "Score: 0/10" on a fresh page

#### 4B. UX polish (~1 h)

- Smooth in/out animation on the card (CSS transitions, not JS)
- The pulse animation when score < 7 on send attempt
- Hide the card when the textarea is empty
- Card width matches the textarea width

#### 4C. Fallback recording (~30 min)

Screen-record the full §13 demo flow:
- Open Claude.ai
- Type "fix the retry" → score 3/10 with red rows
- Iterate to "in src/api/webhooks/handler.ts, fix the retry" → score climbs to 6/10
- Click "Have Claude clarify" → Claude asks clarifying questions
- Answer them → Claude gives a perfect answer

Save the file. Refresh at hour 22. If anything breaks live during the pitch, play the recording.

**End of Phase 4:** edge cases polished, fallback recording ready.

---

### Phase 5 · Rehearsal (hours 18–24)

- Rehearse the §13 storyboard 3+ times in a row with the actual demo machine, browser pinned, network conditions matching the venue.
- Refresh fallback recording at hour 22.
- Bug-fix only. **No new features after hour 18.**

---

## 5. Risks specific to this lane

1. **Claude.ai DOM changes mid-build.** Daily risk during a 24h hackathon — they could ship a UI change at any point. Smoke-test daily; pin the demo browser; record a fallback at hour 18 and hour 22. **This is your #1 risk.**
2. **Score-card layout breaks Claude.ai's UI.** Use absolute positioning carefully; respect the existing layout flow. Test on multiple viewport widths.
3. **Augmentation template ignored by Claude.** The model might just answer instead of asking clarifying questions. Test against real Claude responses; tune the wording until compliance is reliable. Lock by hour 6.
4. **Send interception timing race.** The user could press Enter between the score response landing and the `<7` decision. Always prefer optimistic non-interception (treat unknown score as ≥7).
5. **`/score` slow → laggy textarea.** Keep the input handler async-only; never await on the input event. Cache last 5 prompt-hash → score pairs locally.
6. **Plasmo build issues on Windows.** Plasmo occasionally has Windows path bugs. Allocate buffer time; consider WSL if blocked.

---

## 6. Cuts (in priority order if behind)

1. **`/capture` writeback** — score-card + send is enough for the L1→L2 story; capture is analytics
2. **Augmentation flow** — the score-card alone tells the L1→L2 story; augmentation is the bonus accelerator
3. **Multi-line / paste polish** — most demo text is short; degrade gracefully
4. **Animation polish** — instant show/hide is fine

**Don't cut:** the score-card itself or the ≥7 / <7 threshold logic. Those are the demo.

---

## 7. Definition of done

- [ ] Plasmo extension builds, loads unpacked into pinned Chrome, runs on Claude.ai
- [ ] Score-card renders live as user types on Claude.ai (250ms debounce)
- [ ] Score-card matches the visual spec from §6 (5 dimensions, color-coded, missing hints)
- [ ] Score ≥ 7 sends with zero friction — no card highlight, no nudge
- [ ] Score < 7 shows 5-second nudge with two buttons; auto-sends unchanged after 5s if user does nothing
- [ ] "Have Claude clarify" augments the prompt and sends; Claude responds by asking clarifying questions
- [ ] Every send writes `skill_observation` rows visible on the dashboard
- [ ] Browser version pinned; fallback recording exists; refreshed at hour 22
- [ ] §13 demo runs flawlessly 3 times in a row on the demo machine
- [ ] Fail-open verified: API down → no card, native send works

---

## 8. Reference: useful files in this repo

- **Spec:** `docs/superpowers/specs/2026-04-25-trailhead-design.md` (read §6 first, then §13)
- **Shared types:** `packages/shared/types.ts`
- **API stub source (live shape reference):** `apps/api/src/index.ts`
- **Env template:** `.env.example`
- **VS Code / MCP / Hook lane (your sibling):** `docs/roadmaps/2026-04-25-roadmap-mcp-vscode-hook.md`

---

## 9. Quick smoke-test of the live API

You can verify the API shape now from any terminal:

```bash
curl -s -X POST https://trailheadapi-production.up.railway.app/score \
  -H "Content-Type: application/json" \
  -H "X-Team-Token: trailhead_demo_acme_2026" \
  -d '{"prompt":"fix the retry","user_id":"demo"}'
```

Expected response (the stub returns this exact shape until Person D wires Haiku in around hour 6):

```json
{
  "overall": 4,
  "dimensions": {
    "goal_clarity": 8,
    "specificity": 4,
    "context_loading": 2,
    "constraint_articulation": 1,
    "output_specification": 3
  },
  "missing": {
    "context_loading": "no file or function referenced",
    "constraint_articulation": "no constraints stated",
    "output_specification": "no return shape requested"
  }
}
```

When the real Haiku-backed `/score` lands, the shape is identical — only the numbers and hints become dynamic. Your code keeps working.
