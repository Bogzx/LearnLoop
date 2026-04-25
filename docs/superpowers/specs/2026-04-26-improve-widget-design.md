# Improve-widget design — Gemini-driven interactive prompt coach

**Date:** 2026-04-26
**Surface:** browser extension (`apps/browser-ext`) + Hono API (`apps/api`)
**Replaces / extends:** the existing deterministic `augmentAndSend()` flow
behind the score-card's **Improve** button (spec §6 / `augment.ts`).

## 1. Goal

Today, clicking **Improve** wraps the user's prompt with a templated
"please ask 2-3 clarifying questions" instruction and ships it to Claude.
The clarifying conversation then happens *inside Claude*, not in the
extension.

The new design moves that conversation into the extension itself: a small
chat widget where Gemini asks the user follow-up questions, the user
answers in-place, and the conversation collapses into a polished prompt
that gets dropped into Claude's composer (without auto-sending). The user
hits Enter when they want to send.

## 2. Why

- The current flow gives Claude an instruction it sometimes ignores or
  half-follows. Driving the dialogue ourselves makes the coaching
  visible, demonstrable, and consistent across the team.
- The L1→L2 transition the spec is built around is about *teaching the
  user* what a good prompt asks for. A live back-and-forth in the
  browser surface is more pedagogically valuable than a one-shot
  augmentation.
- Demo headline: a Gemini-driven coach in the same surface as the
  score-card is a stronger story for the PoliHack judges than a static
  template.

## 3. UX flow

### 3.1 Trigger
User clicks **Improve** on the score-card. The card transitions from its
score-display state to its chat state in-place (no modal, no panel).

### 3.2 State A — Chat thread

- Header text changes from `Score: <n>` to `Improving your prompt`.
- The five dimension rows + three buttons (Improve / Send as-is / Edit)
  are replaced by:
  - A scrollable conversation area showing alternating bubbles:
    `🤖` Gemini turn, `👤` user turn.
  - An input row with: a text input, **Send**, **I'm done**, **Cancel**.
- Keybindings inside the input:
  - `Enter` → Send
  - `Shift+Enter` → newline
  - `Esc` → Cancel
- While Gemini is in flight, the input is disabled and shows a `…`
  placeholder. The Send / I'm done buttons are also disabled.
- **Turn cap = 5** (i.e., 5 user replies). After the 5th user reply, the
  next request is auto-sent with `command: 'finalize'` regardless of the
  user clicking "I'm done".

### 3.3 State B — Finalization

- Triggered when the server returns `{ kind: 'final', polished }` (either
  Gemini decided it had enough, or the user hit "I'm done", or the cap
  was reached).
- Header changes to `Polished prompt ready`.
- Body shows the polished prompt in a read-only textarea preview.
- Two buttons: **Use this** / **Edit further**.

### 3.4 State C — Drop & dismiss

- **Use this** → write the polished prompt into Claude's composer via
  the existing `writePrompt()` helper, hide the score-card, focus the
  composer. **No auto-send** — user hits Enter when they want to send.
- **Edit further** → returns to State A so the user can add more turns
  (turn cap counter is preserved across the round-trip).

### 3.5 Cancel

Cancel is available at any point in States A and B. It discards the
conversation, hides the card, and leaves the composer's content
untouched (the original prompt the user typed is still there).

## 4. API contract

### 4.1 New endpoint: `POST /improve`

Stateless. The extension carries the conversation history; the server
holds no session state.

**Request:**

```ts
POST /improve
Headers:
  Content-Type: application/json
  X-Team-Token: <team token>

Body:
{
  original_prompt: string;          // the prompt the user originally typed
  missing: MissingHints;            // from the prior /score response
  history: Array<{                  // empty on first turn
    role: 'assistant' | 'user';
    text: string;
  }>;
  command: 'next' | 'finalize';
  user_id: string;
}
```

**Response (one of two):**

```ts
// Mid-conversation
{ kind: 'question'; text: string; turn: number }

// End of conversation
{ kind: 'final'; polished: string; rationale?: string }
```

`turn` in the question response is `1`-indexed and reflects the count of
*user replies the server is asking for next* (i.e., on the very first
call with empty `history` and `command: 'next'`, the server returns
`turn: 1`).

### 4.2 Server logic

1. Validate the request shape; reject with 400 on malformed input.
2. Build a Gemini prompt:
   - System: "You are a senior engineer's prompt coach. The user is
     about to send a prompt to Claude. Ask one focused follow-up
     question that would meaningfully raise the prompt's quality on the
     listed weak dimensions. Keep questions concrete (file path, output
     shape, constraints). Stop asking once you have enough to write a
     strong final prompt."
   - User: original prompt + the `missing` dimensions (named) + the
     history transcript + the command.
3. Branch on `command`:
   - `'next'` and `history.length / 2 < 5`: Gemini decides — return
     either `{ kind: 'question', text }` or `{ kind: 'final', polished }`.
   - `'finalize'` OR `history.length / 2 >= 5`: force `kind: 'final'`.
4. Use `gemini-2.5-flash` (the same fast model `/score` uses) with a
   responseSchema enforcing the two response shapes — no parsing
   surprises.
5. **Timeout:** 12 s, no retries. Matches the existing `/score` policy
   in `apps/api/src/gemini.ts`. On timeout, respond 502.
6. **No DB writes.** No `/capture` row, no wiki impact. The endpoint is
   side-effect-free.

### 4.3 Shared types

Add the following to `packages/shared/types.ts`:

```ts
export interface ImproveTurn {
  role: 'assistant' | 'user';
  text: string;
}

export interface ImproveRequest {
  original_prompt: string;
  missing: MissingHints;
  history: ImproveTurn[];
  command: 'next' | 'finalize';
  user_id: string;
}

export type ImproveResponse =
  | { kind: 'question'; text: string; turn: number }
  | { kind: 'final'; polished: string; rationale?: string };
```

The browser extension imports these via `@trailhead/shared` (matching
the existing pattern for Score/Capture/etc.).

## 5. Frontend wiring

### 5.1 New widget module

`apps/browser-ext/src/widgets/improve-chat.ts` owns the chat UI and the
conversation state. Single closure per "Improve" click — no global
module state.

Public surface:

```ts
export function openImproveChat(
  sel: Selectors,
  originalPrompt: string,
  missing: MissingHints,
): void;
```

### 5.2 Score-card integration

`apps/browser-ext/src/score-card.ts` currently wires the Improve
button to `() => void augmentAndSend()`. Change to:

```ts
improve.addEventListener('click', () => {
  openImproveChat(sel, lastScoredText, lastMissing);
});
```

The `lastMissing` value is read from the most recent score result; the
score-card already tracks `lastScoredText` in `send-intercept.ts`
(`rememberScoredPrompt`). No new global state needed beyond exposing
the missing hints alongside it.

### 5.3 Internal state machine

```
idle → asking ──user types & Send→ asking ──/improve responds with question→ asking
                                                                   ──/improve responds with final→ preview
asking ──"I'm done" click→ finalizing
asking ──"Cancel" / Esc → cancelled
finalizing ──/improve returns final→ preview
preview ──"Use this"→ done (writePrompt + hideCard + focus composer)
preview ──"Edit further"→ asking
done | cancelled → card hidden, closure freed
```

Implementation detail: state lives in a `let state: State` variable
inside `openImproveChat`; transitions are pure functions on that
variable, then a `render(state)` function patches the DOM.

### 5.4 API helper

Add `improve()` to `apps/browser-ext/src/api.ts`, mirroring the existing
`score()` / `capture()` shape:

```ts
export async function improve(req: ImproveRequest): Promise<ImproveResponse | null>;
```

Behavior:
- 12 s `AbortController` timeout.
- On any error (network, 4xx/5xx, JSON parse, schema mismatch), return
  `null`. The caller is responsible for the user-visible error UX.
- No caching — improve responses are turn-specific and not cacheable.

### 5.5 Drop into composer

`writePrompt(sel.textarea, polished)` from `selectors.ts` already
handles both `<textarea>` and the Tiptap/ProseMirror contenteditable
correctly (via `execCommand('insertText')` + Lexical fallback). Reuse
unchanged.

## 6. Error handling

| Failure | Widget behavior |
|---|---|
| First `/improve` call returns `null` | Body shows: *"Couldn't reach the coach."* + two buttons: **Use template instead** (calls existing `augmentAndSend()`) and **Cancel** (drops chat, leaves composer untouched). |
| Mid-conversation `/improve` returns `null` | Same two buttons; "Use template instead" uses the **original** prompt + missing hints (the partial conversation is discarded). |
| Cap reached but server still returns `kind: 'question'` | Client treats as a server bug; logs `[trailhead] improve: server ignored cap` and forces a `command: 'finalize'` follow-up call. |
| User clicks "Use this" but `writePrompt` throws | Logs the error, leaves the polished prompt visible in the preview, surfaces a toast: *"Couldn't write to composer — copy manually?"* with a copy-to-clipboard button. |

The widget is fail-open in the same spirit as the rest of the
extension: never block the user, always offer an escape hatch back to a
working send.

## 7. Out of scope

- **Persistence.** Closing the card, navigating, or reloading discards
  the conversation. Demo state stays predictable.
- **Multi-prompt sessions.** Each "Improve" click starts fresh; Gemini
  has no memory across separate clicks.
- **`/capture` writes for improve sessions.** When the user eventually
  hits Enter on the polished prompt, the existing send-intercept fires
  `/capture` as it does today. The conversation transcript itself is
  not logged.
- **Analytics on improve usage.** Not a v1 concern; can be added by
  extending the `/improve` handler later.
- **Score recompute mid-conversation.** The score-card is hidden during
  the chat; we don't re-score after each user reply.
- **Multi-language UI.** English only.
- The earlier change "always intercept regardless of score" remains in
  place. This design assumes every Improve click is an intentional
  choice the user made on the score-card.

## 8. Testing

Per the existing browser-ext convention (pure functions tested with
`node --test`):

- `improve.ts` API helper — fetch-stubbed tests for: success
  (question), success (final), 500 → null, timeout → null, JSON parse
  error → null.
- `improve-chat.ts` state machine — pure-function tests on the
  transition table (no DOM mounting). Cover: cap enforcement, "I'm
  done" forces `finalize`, mid-conversation failure transitions.
- DOM smoke testing on Claude.ai is the existing spec §7.5 manual
  deliverable; this widget joins that checklist.

## 9. Files touched

- **NEW:** `apps/browser-ext/src/widgets/improve-chat.ts`
- **NEW:** `apps/browser-ext/src/widgets/improve-chat.test.mts`
- **NEW:** `apps/api/src/improve.ts` (Gemini wrapper for the new endpoint)
- **MOD:** `apps/api/src/index.ts` (register `POST /improve`)
- **MOD:** `apps/api/src/gemini.ts` (export the model + helper used by improve)
- **MOD:** `apps/browser-ext/src/api.ts` (add `improve()` helper + tests)
- **MOD:** `apps/browser-ext/src/score-card.ts` (re-wire Improve button,
  expose `lastMissing`)
- **MOD:** `apps/browser-ext/src/styles.ts` (chat thread, bubble, input
  styles)
- **MOD:** `packages/shared/types.ts` (`ImproveRequest`, `ImproveResponse`,
  `ImproveTurn`)
- **MOD:** `apps/browser-ext/scripts/smoke.sh` (add `/improve` smoke call)
- **MOD:** `apps/browser-ext/README.md` (document the new flow)
