# Improve-widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the score-card's deterministic `augmentAndSend()` flow with a Gemini-driven multi-turn chat widget that drops the polished prompt into Claude's composer (no auto-send).

**Architecture:** New stateless `POST /improve` endpoint on the Hono API wraps Gemini with a discriminated-union response (`{kind:'question'}` or `{kind:'final'}`). New browser-ext widget `improve-chat.ts` swaps the score-card body with a chat thread, calls `/improve` per turn, ends by writing the polished prompt into Claude's Tiptap composer via the existing `writePrompt()` helper.

**Tech Stack:** TypeScript (strict), Hono, `@google/genai` (gemini-2.5-flash with responseSchema), vanilla DOM (no framework), Node `--test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-04-26-improve-widget-design.md`

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/shared/types.ts` | MOD | Add `ImproveRequest`, `ImproveResponse`, `ImproveTurn` |
| `apps/api/src/gemini.ts` | MOD | Add `improveCoach()` wrapper (gemini-2.5-flash + oneOf schema) |
| `apps/api/src/index.ts` | MOD | Register `POST /improve` handler |
| `apps/browser-ext/src/api.ts` | MOD | Add `improve()` helper |
| `apps/browser-ext/src/api.test.mts` | MOD | Add fetch-stubbed tests for `improve()` |
| `apps/browser-ext/src/widgets/improve-chat.ts` | NEW | Widget owning chat UI + state machine |
| `apps/browser-ext/src/widgets/improve-chat.test.mts` | NEW | Pure-function tests on the state machine |
| `apps/browser-ext/src/score-card.ts` | MOD | Re-wire Improve button to `openImproveChat()`; track `lastMissing` |
| `apps/browser-ext/src/styles.ts` | MOD | Chat-thread / bubble / input styles |
| `apps/browser-ext/scripts/smoke.sh` | MOD | Add `/improve` smoke call |
| `apps/browser-ext/README.md` | MOD | Document the new flow + replaced behavior |
| `apps/browser-ext/package.json` | MOD | Add the new test files to the `test` script |

---

### Task 1: Add shared types for the improve endpoint

**Files:**
- Modify: `packages/shared/types.ts`

- [ ] **Step 1: Add the new interfaces at the bottom of the existing file**

Open `packages/shared/types.ts` and append (after the `OnboardRepoResponse` block):

```ts
// POST /improve — Gemini-driven multi-turn prompt coaching (spec
// 2026-04-26-improve-widget-design.md). Stateless: extension carries the
// full conversation each turn; server holds no session state.
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

- [ ] **Step 2: Typecheck**

Run: `npm --workspace=@trailhead/shared run typecheck` (or `npx tsc -p packages/shared --noEmit` if the workspace doesn't define a typecheck script — check `packages/shared/package.json` first).

Expected: clean exit (no type errors).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/types.ts
git commit -m "shared: add ImproveRequest/ImproveResponse types"
```

---

### Task 2: Add `improveCoach()` Gemini wrapper

**Files:**
- Modify: `apps/api/src/gemini.ts`

- [ ] **Step 1: Read the existing scoring file to understand the wrapper pattern**

Open `apps/api/src/gemini.ts` and locate:
- `withRetry()` (the retry/timeout wrapper, lines ~47-84)
- `extractAnswer()` and `tryParseJson()` (response parsing, lines ~95-118)
- `scorePrompt()` (the `/score` Gemini call, search for it as a model)

You will mirror `scorePrompt`'s structure for the new function.

- [ ] **Step 2: Add the system prompt constant near the top of the file**

After the existing imports, add:

```ts
const IMPROVE_SYSTEM_PROMPT = `You are a senior engineer's prompt coach. The user is about to send a prompt to Claude. Your job is to ask one focused follow-up question that would meaningfully raise the prompt's quality on the listed weak dimensions, OR — if you already have enough information — return the polished prompt.

Rules:
- One question per turn. Keep it concrete: file path, expected output shape, constraints, current code location.
- Stop asking once you have enough to write a strong final prompt. Don't pad the conversation.
- The polished prompt must preserve the user's original intent. Add specificity, do not invent requirements the user didn't imply.
- Output JSON matching the schema exactly. No prose outside the JSON.

If the command is "finalize", you MUST return kind="final" regardless of how much information you have. Synthesize the best polished prompt you can from what's available.`;
```

- [ ] **Step 3: Add the `improveCoach()` function at the bottom of the file**

Append after the last existing exported function:

```ts
export interface ImproveCoachInput {
  original_prompt: string;
  missing: MissingHints;
  history: { role: 'assistant' | 'user'; text: string }[];
  command: 'next' | 'finalize';
}

export type ImproveCoachOutput =
  | { kind: 'question'; text: string }
  | { kind: 'final'; polished: string; rationale?: string };

export async function improveCoach(input: ImproveCoachInput): Promise<ImproveCoachOutput> {
  const dimList = Object.keys(input.missing).map((d) => d.replace(/_/g, ' '));
  const weak = dimList.length === 0 ? '(none flagged)' : dimList.join(', ');
  const transcript = input.history.length === 0
    ? '(no turns yet)'
    : input.history.map((t, i) => `${i + 1}. ${t.role === 'assistant' ? 'Coach' : 'User'}: ${t.text}`).join('\n');

  const userMessage = `Original prompt:
"""
${input.original_prompt}
"""

Weak dimensions: ${weak}

Conversation so far:
${transcript}

Command: ${input.command}`;

  const responseSchema = {
    type: Type.OBJECT,
    required: ['kind'],
    properties: {
      kind: { type: Type.STRING, enum: ['question', 'final'] },
      text: { type: Type.STRING },
      polished: { type: Type.STRING },
      rationale: { type: Type.STRING },
    },
  };

  const resp = await withRetry(
    () =>
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: userMessage,
        config: {
          systemInstruction: IMPROVE_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    'improve',
    20_000,
  );

  const raw = extractAnswer(resp as GenResp);
  const parsed = tryParseJson<{ kind?: string; text?: string; polished?: string; rationale?: string }>(raw);
  if (!parsed || (parsed.kind !== 'question' && parsed.kind !== 'final')) {
    throw new Error('improveCoach: unparseable response');
  }
  if (parsed.kind === 'question') {
    if (typeof parsed.text !== 'string' || !parsed.text.trim()) {
      throw new Error('improveCoach: question missing text');
    }
    return { kind: 'question', text: parsed.text.trim() };
  }
  if (typeof parsed.polished !== 'string' || !parsed.polished.trim()) {
    throw new Error('improveCoach: final missing polished');
  }
  return {
    kind: 'final',
    polished: parsed.polished.trim(),
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : undefined,
  };
}
```

Note: `MissingHints` is already imported at line 13.

- [ ] **Step 4: Typecheck the api workspace**

Run: `npm --workspace=@trailhead/api run typecheck`

Expected: clean exit. If you get an error about `Type` not being exported, verify line 12 of `gemini.ts` already has `import { GoogleGenAI, Type } from '@google/genai';`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/gemini.ts
git commit -m "api: add improveCoach gemini wrapper for /improve endpoint"
```

---

### Task 3: Register `POST /improve` handler

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Add the new types to the existing import block**

In `apps/api/src/index.ts`, locate the `import type { ... } from '@trailhead/shared';` block (lines ~6-29) and add three names:

```ts
  ImproveRequest,
  ImproveResponse,
  ImproveTurn,
```

(Keep the alphabetical order if the existing block is sorted; otherwise just add them.)

- [ ] **Step 2: Add `improveCoach` to the gemini import**

Update line ~33 from:

```ts
import { extractTopic, overallScore, scorePrompt, synthesizeDiff } from './gemini.ts';
```

to:

```ts
import { extractTopic, improveCoach, overallScore, scorePrompt, synthesizeDiff } from './gemini.ts';
```

- [ ] **Step 3: Add the handler before the `/onboard/repo` block**

Locate `// ----- POST /onboard/repo (SCAFFOLDING)` (around line 596). Insert the following block IMMEDIATELY ABOVE it:

```ts
// ----- POST /improve ---------------------------------------------------------
// Gemini-driven multi-turn prompt coach. Stateless — caller carries the full
// conversation each turn. Spec: 2026-04-26-improve-widget-design.md
const IMPROVE_TURN_CAP = 5; // user replies; history.length cap is 2 * cap

app.post('/improve', async (c) => {
  const body = await c.req.json<ImproveRequest>().catch(() => null);
  if (
    !body ||
    typeof body.original_prompt !== 'string' ||
    typeof body.user_id !== 'string' ||
    !Array.isArray(body.history) ||
    (body.command !== 'next' && body.command !== 'finalize')
  ) {
    return c.json({ error: 'bad_request' }, 400);
  }

  // Validate every history entry; reject anything malformed so we never
  // hand garbage to Gemini.
  for (const t of body.history as ImproveTurn[]) {
    if (
      !t ||
      (t.role !== 'assistant' && t.role !== 'user') ||
      typeof t.text !== 'string'
    ) {
      return c.json({ error: 'bad_request' }, 400);
    }
  }

  // Server-side cap: if the user has already replied IMPROVE_TURN_CAP times,
  // force finalize regardless of the client-supplied command. The client
  // also enforces this; the server check is a safety net.
  const userReplies = body.history.filter((t) => t.role === 'user').length;
  const command = userReplies >= IMPROVE_TURN_CAP ? 'finalize' : body.command;

  try {
    const out = await improveCoach({
      original_prompt: body.original_prompt,
      missing: body.missing ?? {},
      history: body.history,
      command,
    });
    if (out.kind === 'question') {
      const res: ImproveResponse = {
        kind: 'question',
        text: out.text,
        turn: userReplies + 1,
      };
      return c.json(res);
    }
    const res: ImproveResponse = {
      kind: 'final',
      polished: out.polished,
      rationale: out.rationale,
    };
    return c.json(res);
  } catch (err) {
    console.warn('[api] /improve failed', err);
    return c.json({ error: 'improve_failed' }, 502);
  }
});
```

- [ ] **Step 4: Add `'POST /improve'` to the `/` health endpoint listing**

Locate the array that holds the endpoint list (search for `'POST /score'`, around line 69). Add `'POST /improve'` to it. Order doesn't matter functionally — match the existing style.

- [ ] **Step 5: Typecheck the api**

Run: `npm --workspace=@trailhead/api run typecheck`

Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "api: register POST /improve handler with turn cap"
```

---

### Task 4: Add `improve()` to the browser-ext API helper

**Files:**
- Modify: `apps/browser-ext/src/api.ts`

- [ ] **Step 1: Update the EndpointKey union to include `'improve'`**

In `apps/browser-ext/src/api.ts`, change line 21 from:

```ts
type EndpointKey = 'score' | 'capture' | 'diff' | 'wiki';
```

to:

```ts
type EndpointKey = 'score' | 'capture' | 'diff' | 'wiki' | 'improve';
```

- [ ] **Step 2: Add `ImproveRequest` and `ImproveResponse` to the type imports**

At the top of `api.ts`, extend the existing `import type { ... } from '@trailhead/shared';` block to include `ImproveRequest` and `ImproveResponse`.

- [ ] **Step 3: Add the `improve()` exported function at the bottom of the file**

Append:

```ts
export async function improve(body: ImproveRequest): Promise<ImproveResponse | null> {
  return call<ImproveResponse>('improve', '/improve', { method: 'POST', body });
}
```

- [ ] **Step 4: Typecheck**

Run: `npm --workspace=@trailhead/browser-ext run typecheck`

Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add apps/browser-ext/src/api.ts
git commit -m "browser-ext: add improve() api helper"
```

---

### Task 5: Add fetch-stubbed tests for `improve()`

**Files:**
- Modify: `apps/browser-ext/src/api.test.mts`

- [ ] **Step 1: Read the existing tests to learn the stubbing pattern**

Open `apps/browser-ext/src/api.test.mts`. Note how `score()` / `capture()` / `diff()` are tested with `globalThis.fetch = ...` mocks. Mirror that style.

- [ ] **Step 2: Add tests at the bottom of the file**

```ts
import { improve } from './api.ts';
import type { ImproveRequest } from '@trailhead/shared';

const baseRequest: ImproveRequest = {
  original_prompt: 'fix the retry',
  missing: { specificity: 'name the file' },
  history: [],
  command: 'next',
  user_id: 'u1',
};

test('improve: success returns parsed body (question)', async () => {
  const expected = { kind: 'question', text: 'What file?', turn: 1 };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(expected), { status: 200 })) as typeof fetch;
  const got = await improve(baseRequest);
  assert.deepStrictEqual(got, expected);
});

test('improve: success returns parsed body (final)', async () => {
  const expected = { kind: 'final', polished: 'Polished prompt', rationale: 'because reasons' };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(expected), { status: 200 })) as typeof fetch;
  const got = await improve(baseRequest);
  assert.deepStrictEqual(got, expected);
});

test('improve: 502 returns null', async () => {
  globalThis.fetch = (async () =>
    new Response('{"error":"improve_failed"}', { status: 502 })) as typeof fetch;
  const got = await improve(baseRequest);
  assert.strictEqual(got, null);
});

test('improve: network error returns null', async () => {
  globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
  const got = await improve(baseRequest);
  assert.strictEqual(got, null);
});

test('improve: malformed JSON returns null', async () => {
  globalThis.fetch = (async () =>
    new Response('not json {{{', { status: 200 })) as typeof fetch;
  const got = await improve(baseRequest);
  assert.strictEqual(got, null);
});
```

If the file's existing tests don't already import `test` and `assert`, add at the top:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
```

(Check the existing file — these imports are likely already present.)

- [ ] **Step 3: Run the test file**

Run: `node --test --experimental-strip-types apps/browser-ext/src/api.test.mts`

Expected: all five new tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/browser-ext/src/api.test.mts
git commit -m "browser-ext: test improve() helper (success, error, parse paths)"
```

---

### Task 6: Write the `improve-chat` state machine + tests (no DOM)

**Files:**
- Create: `apps/browser-ext/src/widgets/improve-chat.ts`
- Create: `apps/browser-ext/src/widgets/improve-chat.test.mts`

We start with the pure state-machine layer — DOM mounting comes in Task 7.

- [ ] **Step 1: Create the file with the state machine and a render-free reducer**

Write `apps/browser-ext/src/widgets/improve-chat.ts`:

```ts
// Improve-chat widget — Gemini-driven multi-turn prompt coach.
// Spec: 2026-04-26-improve-widget-design.md
//
// This module exports two surfaces:
//   - `reduce(state, event)` — pure state-machine reducer; tested in isolation
//   - `openImproveChat(sel, prompt, missing)` — wires the reducer to DOM + API
//
// Keeping the reducer pure lets us cover the cap, finalize, error, and
// preview transitions without spinning up a JSDOM.

import type { ImproveResponse, ImproveTurn, MissingHints } from '@trailhead/shared';

export const IMPROVE_TURN_CAP = 5;

export type ImproveState =
  | { stage: 'idle' }
  | { stage: 'asking'; history: ImproveTurn[]; pending: false }
  | { stage: 'asking'; history: ImproveTurn[]; pending: true; command: 'next' | 'finalize' }
  | { stage: 'preview'; history: ImproveTurn[]; polished: string; rationale?: string }
  | { stage: 'error'; history: ImproveTurn[]; message: string }
  | { stage: 'cancelled' }
  | { stage: 'done' };

export type ImproveEvent =
  | { type: 'open' }
  | { type: 'send_user_reply'; text: string }
  | { type: 'click_im_done' }
  | { type: 'click_cancel' }
  | { type: 'click_use_this' }
  | { type: 'click_edit_further' }
  | { type: 'click_use_template' }
  | { type: 'api_response'; res: ImproveResponse | null };

export function userReplies(history: ImproveTurn[]): number {
  return history.filter((t) => t.role === 'user').length;
}

export function reduce(state: ImproveState, event: ImproveEvent): ImproveState {
  switch (event.type) {
    case 'open':
      return { stage: 'asking', history: [], pending: true, command: 'next' };

    case 'send_user_reply': {
      if (state.stage !== 'asking' || state.pending) return state;
      const text = event.text.trim();
      if (!text) return state;
      const history = [...state.history, { role: 'user' as const, text }];
      const replies = userReplies(history);
      // Server enforces the cap too, but flagging client-side keeps the
      // request's intent explicit.
      const command: 'next' | 'finalize' = replies >= IMPROVE_TURN_CAP ? 'finalize' : 'next';
      return { stage: 'asking', history, pending: true, command };
    }

    case 'click_im_done': {
      if (state.stage !== 'asking' || state.pending) return state;
      // Force a finalize call with no new user text.
      return { stage: 'asking', history: state.history, pending: true, command: 'finalize' };
    }

    case 'click_cancel':
      if (state.stage === 'preview' || state.stage === 'asking' || state.stage === 'error') {
        return { stage: 'cancelled' };
      }
      return state;

    case 'click_use_template':
      if (state.stage !== 'error') return state;
      // Caller is responsible for actually invoking augmentAndSend(); the
      // state machine just transitions to done so the widget unmounts.
      return { stage: 'done' };

    case 'click_use_this':
      if (state.stage !== 'preview') return state;
      return { stage: 'done' };

    case 'click_edit_further':
      if (state.stage !== 'preview') return state;
      return { stage: 'asking', history: state.history, pending: false };

    case 'api_response': {
      if (state.stage !== 'asking' || !state.pending) return state;
      const res = event.res;
      if (!res) {
        return {
          stage: 'error',
          history: state.history,
          message: 'Couldn’t reach the coach.',
        };
      }
      if (res.kind === 'question') {
        const history = [...state.history, { role: 'assistant' as const, text: res.text }];
        return { stage: 'asking', history, pending: false };
      }
      // res.kind === 'final'
      return {
        stage: 'preview',
        history: state.history,
        polished: res.polished,
        rationale: res.rationale,
      };
    }
  }
}

// DOM-mounting + API-calling code — added in Task 7. Stub for now so
// other callers can import the symbol if they need to.
export function openImproveChat(_sel: unknown, _prompt: string, _missing: MissingHints): void {
  throw new Error('openImproveChat: not implemented yet (Task 7)');
}
```

- [ ] **Step 2: Create the test file**

Write `apps/browser-ext/src/widgets/improve-chat.test.mts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce, type ImproveState } from './improve-chat.ts';

const idle: ImproveState = { stage: 'idle' };

test('open: transitions idle → asking pending=true command=next', () => {
  const next = reduce(idle, { type: 'open' });
  assert.deepStrictEqual(next, { stage: 'asking', history: [], pending: true, command: 'next' });
});

test('api_response question: appends assistant turn, pending=false', () => {
  const opened = reduce(idle, { type: 'open' });
  const next = reduce(opened, {
    type: 'api_response',
    res: { kind: 'question', text: 'What file?', turn: 1 },
  });
  assert.deepStrictEqual(next, {
    stage: 'asking',
    history: [{ role: 'assistant', text: 'What file?' }],
    pending: false,
  });
});

test('send_user_reply: appends user turn and goes pending command=next when under cap', () => {
  const ready: ImproveState = {
    stage: 'asking',
    history: [{ role: 'assistant', text: 'What file?' }],
    pending: false,
  };
  const next = reduce(ready, { type: 'send_user_reply', text: 'src/api/handler.ts' });
  assert.deepStrictEqual(next, {
    stage: 'asking',
    history: [
      { role: 'assistant', text: 'What file?' },
      { role: 'user', text: 'src/api/handler.ts' },
    ],
    pending: true,
    command: 'next',
  });
});

test('send_user_reply: command becomes finalize on the 5th user reply', () => {
  // Build a history with 4 user replies already in it.
  const history = [
    { role: 'assistant' as const, text: 'q1' }, { role: 'user' as const, text: 'a1' },
    { role: 'assistant' as const, text: 'q2' }, { role: 'user' as const, text: 'a2' },
    { role: 'assistant' as const, text: 'q3' }, { role: 'user' as const, text: 'a3' },
    { role: 'assistant' as const, text: 'q4' }, { role: 'user' as const, text: 'a4' },
    { role: 'assistant' as const, text: 'q5' },
  ];
  const ready: ImproveState = { stage: 'asking', history, pending: false };
  const next = reduce(ready, { type: 'send_user_reply', text: 'a5' });
  assert.strictEqual(next.stage, 'asking');
  if (next.stage === 'asking' && next.pending) {
    assert.strictEqual(next.command, 'finalize');
  } else {
    assert.fail('expected pending=true');
  }
});

test('send_user_reply: empty text is ignored', () => {
  const ready: ImproveState = { stage: 'asking', history: [], pending: false };
  const next = reduce(ready, { type: 'send_user_reply', text: '   ' });
  assert.deepStrictEqual(next, ready);
});

test('click_im_done: forces finalize on next call, no new user turn', () => {
  const ready: ImproveState = {
    stage: 'asking',
    history: [{ role: 'assistant', text: 'q1' }, { role: 'user', text: 'a1' }],
    pending: false,
  };
  const next = reduce(ready, { type: 'click_im_done' });
  assert.deepStrictEqual(next, {
    stage: 'asking',
    history: ready.history,
    pending: true,
    command: 'finalize',
  });
});

test('api_response final: transitions to preview', () => {
  const pending: ImproveState = {
    stage: 'asking',
    history: [{ role: 'user', text: 'a1' }],
    pending: true,
    command: 'next',
  };
  const next = reduce(pending, {
    type: 'api_response',
    res: { kind: 'final', polished: 'P', rationale: 'R' },
  });
  assert.deepStrictEqual(next, {
    stage: 'preview',
    history: [{ role: 'user', text: 'a1' }],
    polished: 'P',
    rationale: 'R',
  });
});

test('api_response null: transitions to error', () => {
  const pending: ImproveState = {
    stage: 'asking',
    history: [],
    pending: true,
    command: 'next',
  };
  const next = reduce(pending, { type: 'api_response', res: null });
  assert.strictEqual(next.stage, 'error');
});

test('click_use_this: preview → done', () => {
  const preview: ImproveState = {
    stage: 'preview',
    history: [],
    polished: 'P',
  };
  assert.strictEqual(reduce(preview, { type: 'click_use_this' }).stage, 'done');
});

test('click_edit_further: preview → asking pending=false', () => {
  const preview: ImproveState = {
    stage: 'preview',
    history: [{ role: 'assistant', text: 'q' }],
    polished: 'P',
  };
  const next = reduce(preview, { type: 'click_edit_further' });
  assert.deepStrictEqual(next, {
    stage: 'asking',
    history: preview.history,
    pending: false,
  });
});

test('click_cancel: from any non-terminal stage → cancelled', () => {
  const asking: ImproveState = { stage: 'asking', history: [], pending: false };
  const preview: ImproveState = { stage: 'preview', history: [], polished: 'P' };
  const error: ImproveState = { stage: 'error', history: [], message: 'm' };
  for (const s of [asking, preview, error]) {
    assert.strictEqual(reduce(s, { type: 'click_cancel' }).stage, 'cancelled');
  }
});

test('click_use_template: from error → done', () => {
  const error: ImproveState = { stage: 'error', history: [], message: 'm' };
  assert.strictEqual(reduce(error, { type: 'click_use_template' }).stage, 'done');
});
```

- [ ] **Step 3: Run the new test file**

Run: `node --test --experimental-strip-types apps/browser-ext/src/widgets/improve-chat.test.mts`

Expected: all 12 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/browser-ext/src/widgets/improve-chat.ts apps/browser-ext/src/widgets/improve-chat.test.mts
git commit -m "browser-ext: improve-chat reducer + 12 state-machine tests"
```

---

### Task 7: Mount the chat widget on the DOM

**Files:**
- Modify: `apps/browser-ext/src/widgets/improve-chat.ts`

- [ ] **Step 1: Replace the stub `openImproveChat` with the real implementation**

In `apps/browser-ext/src/widgets/improve-chat.ts`, replace the stub at the bottom (the function that throws) with:

```ts
import { improve as apiImprove } from '../api.ts';
import { USER_ID } from '../config.ts';
import { writePrompt, type Selectors } from '../selectors.ts';
import { hideCard } from '../score-card.ts';
import { augmentAndSend } from '../send-intercept.ts';

interface ChatRefs {
  root: HTMLDivElement;
  header: HTMLDivElement;
  thread: HTMLDivElement;
  inputRow: HTMLDivElement;
  input: HTMLTextAreaElement;
  sendBtn: HTMLButtonElement;
  doneBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  preview: HTMLDivElement;
  previewBody: HTMLPreElement;
  useThisBtn: HTMLButtonElement;
  editFurtherBtn: HTMLButtonElement;
  errorBody: HTMLDivElement;
  useTemplateBtn: HTMLButtonElement;
  cancelErrBtn: HTMLButtonElement;
}

export function openImproveChat(
  sel: Selectors,
  originalPrompt: string,
  missing: MissingHints,
): void {
  // Mount inside the score-card slot — we call hideCard() at the end to
  // tear it down. The card itself stays parented; we just swap children.
  const cardEl = document.getElementById('trailhead-score-card') as HTMLDivElement | null;
  if (!cardEl) return;
  const refs = buildChatDom(cardEl);

  let state: ImproveState = { stage: 'idle' };

  const dispatch = (event: ImproveEvent): void => {
    const next = reduce(state, event);
    state = next;
    render(refs, state);
    onTransition(state);
  };

  const onTransition = (s: ImproveState): void => {
    if (s.stage === 'asking' && s.pending) {
      void apiImprove({
        original_prompt: originalPrompt,
        missing,
        history: s.history,
        command: s.command,
        user_id: USER_ID,
      }).then((res) => dispatch({ type: 'api_response', res }));
    }
    if (s.stage === 'done') {
      // Either the user picked "Use this" (write polished prompt) or
      // "Use template" (delegate to legacy augmentAndSend).
      // We track which by inspecting the prior stage via the polished field.
      teardown(refs);
    }
    if (s.stage === 'cancelled') {
      teardown(refs);
    }
  };

  // Wire all buttons & input.
  refs.sendBtn.addEventListener('click', () => {
    dispatch({ type: 'send_user_reply', text: refs.input.value });
    refs.input.value = '';
  });
  refs.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      dispatch({ type: 'send_user_reply', text: refs.input.value });
      refs.input.value = '';
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dispatch({ type: 'click_cancel' });
    }
  });
  refs.doneBtn.addEventListener('click', () => dispatch({ type: 'click_im_done' }));
  refs.cancelBtn.addEventListener('click', () => dispatch({ type: 'click_cancel' }));
  refs.cancelErrBtn.addEventListener('click', () => dispatch({ type: 'click_cancel' }));
  refs.useThisBtn.addEventListener('click', () => {
    // Capture polished BEFORE state transitions to 'done'.
    if (state.stage === 'preview') {
      const polished = state.polished;
      writePrompt(sel.textarea, polished);
      sel.textarea.focus();
    }
    dispatch({ type: 'click_use_this' });
  });
  refs.editFurtherBtn.addEventListener('click', () => dispatch({ type: 'click_edit_further' }));
  refs.useTemplateBtn.addEventListener('click', () => {
    dispatch({ type: 'click_use_template' });
    void augmentAndSend();
  });

  cardEl.hidden = false;
  dispatch({ type: 'open' });
  refs.input.focus();
}

function buildChatDom(card: HTMLDivElement): ChatRefs {
  // Wipe existing children — the score-card body is being repurposed.
  card.replaceChildren();
  card.dataset.mode = 'improve';

  const header = document.createElement('div');
  header.className = 'trailhead-improve-header';
  header.textContent = 'Improving your prompt';

  const thread = document.createElement('div');
  thread.className = 'trailhead-improve-thread';

  const inputRow = document.createElement('div');
  inputRow.className = 'trailhead-improve-input-row';
  const input = document.createElement('textarea');
  input.className = 'trailhead-improve-input';
  input.rows = 2;
  input.placeholder = 'Type your answer…';
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'is-primary';
  sendBtn.textContent = 'Send';
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.textContent = 'I’m done';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  inputRow.append(input, sendBtn, doneBtn, cancelBtn);

  const preview = document.createElement('div');
  preview.className = 'trailhead-improve-preview';
  preview.hidden = true;
  const previewBody = document.createElement('pre');
  previewBody.className = 'trailhead-improve-preview-body';
  const previewActions = document.createElement('div');
  previewActions.className = 'trailhead-improve-preview-actions';
  const useThisBtn = document.createElement('button');
  useThisBtn.type = 'button';
  useThisBtn.className = 'is-primary';
  useThisBtn.textContent = 'Use this';
  const editFurtherBtn = document.createElement('button');
  editFurtherBtn.type = 'button';
  editFurtherBtn.textContent = 'Edit further';
  previewActions.append(useThisBtn, editFurtherBtn);
  preview.append(previewBody, previewActions);

  const errorBody = document.createElement('div');
  errorBody.className = 'trailhead-improve-error';
  errorBody.hidden = true;
  const errMsg = document.createElement('div');
  errMsg.className = 'trailhead-improve-error-msg';
  const errActions = document.createElement('div');
  errActions.className = 'trailhead-improve-error-actions';
  const useTemplateBtn = document.createElement('button');
  useTemplateBtn.type = 'button';
  useTemplateBtn.className = 'is-primary';
  useTemplateBtn.textContent = 'Use template instead';
  const cancelErrBtn = document.createElement('button');
  cancelErrBtn.type = 'button';
  cancelErrBtn.textContent = 'Cancel';
  errActions.append(useTemplateBtn, cancelErrBtn);
  errorBody.append(errMsg, errActions);

  card.append(header, thread, inputRow, preview, errorBody);

  return {
    root: card, header, thread, inputRow, input,
    sendBtn, doneBtn, cancelBtn,
    preview, previewBody, useThisBtn, editFurtherBtn,
    errorBody, useTemplateBtn, cancelErrBtn,
  };
}

function render(refs: ChatRefs, state: ImproveState): void {
  // Render the thread bubbles (only the trailing tail differs each call,
  // but a full re-render keeps the DOM logic trivial — chat is short).
  refs.thread.replaceChildren();
  if (state.stage === 'asking' || state.stage === 'preview' || state.stage === 'error') {
    for (const t of state.history) {
      const bubble = document.createElement('div');
      bubble.className = `trailhead-bubble trailhead-bubble--${t.role}`;
      bubble.textContent = (t.role === 'assistant' ? '🤖 ' : '👤 ') + t.text;
      refs.thread.appendChild(bubble);
    }
    if (state.stage === 'asking' && state.pending) {
      const bubble = document.createElement('div');
      bubble.className = 'trailhead-bubble trailhead-bubble--assistant trailhead-bubble--pending';
      bubble.textContent = '…';
      refs.thread.appendChild(bubble);
    }
  }

  const isAsking = state.stage === 'asking';
  const pending = isAsking && state.pending;
  refs.inputRow.hidden = state.stage !== 'asking';
  refs.preview.hidden = state.stage !== 'preview';
  refs.errorBody.hidden = state.stage !== 'error';

  refs.input.disabled = pending;
  refs.sendBtn.disabled = pending;
  refs.doneBtn.disabled = pending || (isAsking && state.history.length === 0);

  if (state.stage === 'preview') {
    refs.previewBody.textContent = state.polished;
    refs.header.textContent = 'Polished prompt ready';
  } else if (state.stage === 'error') {
    (refs.errorBody.querySelector('.trailhead-improve-error-msg') as HTMLDivElement).textContent = state.message;
    refs.header.textContent = 'Coach unavailable';
  } else {
    refs.header.textContent = 'Improving your prompt';
  }
}

function teardown(refs: ChatRefs): void {
  delete refs.root.dataset.mode;
  hideCard();
}
```

Note: `MissingHints` is already imported on the existing types-import line at the top of the file (added in Task 6). If for some reason it isn't, add it.

- [ ] **Step 2: Re-run the existing tests**

Run: `node --test --experimental-strip-types apps/browser-ext/src/widgets/improve-chat.test.mts`

Expected: still 12 passes (the reducer didn't change).

- [ ] **Step 3: Typecheck the browser-ext workspace**

Run: `npm --workspace=@trailhead/browser-ext run typecheck`

Expected: clean.

If you get an error about `hideCard` not being exported from `score-card.ts`, verify it is — it should be (used by send-intercept). If not, add `export` in front of it.

- [ ] **Step 4: Commit**

```bash
git add apps/browser-ext/src/widgets/improve-chat.ts
git commit -m "browser-ext: openImproveChat DOM mount + render"
```

---

### Task 8: Re-wire the score-card Improve button + track lastMissing

**Files:**
- Modify: `apps/browser-ext/src/score-card.ts`

- [ ] **Step 1: Add a module-level `lastMissing` variable**

Near the existing module-level state declarations (around line 39-42 in `apps/browser-ext/src/score-card.ts`), add:

```ts
let lastMissing: MissingHints = {};
```

If `MissingHints` is not yet imported, add it to the existing `import type { ScoreResponse } from '@trailhead/shared';` line:

```ts
import type { MissingHints, ScoreResponse } from '@trailhead/shared';
```

- [ ] **Step 2: Update `lastMissing` whenever a score lands**

Locate `showResult(res: ScoreResponse): void` (around line 122). At the top of that function, add:

```ts
lastMissing = res.missing ?? {};
```

This ensures the latest score's missing hints are always available for the Improve widget.

- [ ] **Step 3: Re-wire the Improve button**

Locate the `improve.addEventListener('click', () => { void augmentAndSend(); });` block (around line 62). Replace it with:

```ts
improve.addEventListener('click', () => {
  // Pull the just-scored prompt straight from the textarea since the
  // user hasn't had a chance to type since seeing the card.
  const prompt = (sel.textarea instanceof HTMLTextAreaElement
    ? sel.textarea.value
    : sel.textarea.innerText).trim();
  if (!prompt) return;
  openImproveChat(sel, prompt, lastMissing);
});
```

- [ ] **Step 4: Add the import**

At the top of `score-card.ts`, add:

```ts
import { openImproveChat } from './widgets/improve-chat.ts';
```

- [ ] **Step 5: Typecheck**

Run: `npm --workspace=@trailhead/browser-ext run typecheck`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/browser-ext/src/score-card.ts
git commit -m "browser-ext: wire Improve button to openImproveChat with lastMissing"
```

---

### Task 9: Add chat widget styles

**Files:**
- Modify: `apps/browser-ext/src/styles.ts`

- [ ] **Step 1: Append chat-thread styles**

In `apps/browser-ext/src/styles.ts`, after the existing `.trailhead-actions` rules, append the following to the same CSS string (or template literal — match the existing pattern):

```css
/* Improve chat widget (spec 2026-04-26-improve-widget-design.md) */
#trailhead-score-card[data-mode="improve"] {
  border-color: rgba(177, 185, 249, 0.4);
}
.trailhead-improve-header {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 6px;
  color: rgba(255,255,255,0.85);
}
.trailhead-improve-thread {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
  padding: 6px;
  background: rgba(0,0,0,0.18);
  border-radius: 6px;
  margin-bottom: 8px;
}
.trailhead-bubble {
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.35;
  white-space: pre-wrap;
}
.trailhead-bubble--assistant { background: rgba(177,185,249,0.10); }
.trailhead-bubble--user      { background: rgba(255,255,255,0.06); align-self: flex-end; }
.trailhead-bubble--pending   { opacity: 0.55; font-style: italic; }
.trailhead-improve-input-row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 6px;
  align-items: stretch;
}
.trailhead-improve-input {
  resize: vertical;
  min-height: 32px;
  background: rgba(0,0,0,0.25);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 6px;
  color: inherit;
  font: inherit;
  padding: 6px 8px;
}
.trailhead-improve-input:disabled { opacity: 0.5; }
.trailhead-improve-input-row button {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 6px;
  color: inherit;
  font: inherit;
  padding: 6px 10px;
  cursor: pointer;
}
.trailhead-improve-input-row button:hover:not(:disabled) { background: rgba(255,255,255,0.10); }
.trailhead-improve-input-row button.is-primary { background: #4762e7; border-color: transparent; }
.trailhead-improve-input-row button.is-primary:hover:not(:disabled) { background: #3a5be0; }
.trailhead-improve-input-row button:disabled { opacity: 0.45; cursor: not-allowed; }
.trailhead-improve-preview, .trailhead-improve-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.trailhead-improve-preview-body {
  background: rgba(0,0,0,0.25);
  padding: 8px;
  border-radius: 6px;
  white-space: pre-wrap;
  font: 12px/1.4 ui-monospace, "SF Mono", Menlo, monospace;
  max-height: 200px;
  overflow-y: auto;
  margin: 0;
}
.trailhead-improve-preview-actions, .trailhead-improve-error-actions {
  display: flex;
  gap: 6px;
}
.trailhead-improve-preview-actions button,
.trailhead-improve-error-actions button {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 6px;
  color: inherit;
  font: inherit;
  padding: 6px 10px;
  cursor: pointer;
}
.trailhead-improve-preview-actions button.is-primary,
.trailhead-improve-error-actions button.is-primary {
  background: #4762e7;
  border-color: transparent;
}
.trailhead-improve-error-msg { color: rgba(255,140,140,0.9); font-size: 12px; }
```

- [ ] **Step 2: Build and verify the bundle compiles**

Run: `npm --workspace=@trailhead/browser-ext run build`

Expected: `dist/content.js` rebuilds without error.

- [ ] **Step 3: Commit**

```bash
git add apps/browser-ext/src/styles.ts
git commit -m "browser-ext: chat widget styles (thread, bubbles, preview, error)"
```

---

### Task 10: Wire new tests into the package script + smoke

**Files:**
- Modify: `apps/browser-ext/package.json`
- Modify: `apps/browser-ext/scripts/smoke.sh`

- [ ] **Step 1: Add `improve-chat.test.mts` to the package's `test` script**

In `apps/browser-ext/package.json`, locate the `"test"` script (currently lists every `.test.mts` file). Add `src/widgets/improve-chat.test.mts` to the list. Final form:

```json
"test": "npm run build && node --test --experimental-strip-types src/hash.test.mts src/augment.test.mts src/api.test.mts src/diff-parse.test.mts src/widgets/wiki-toast.test.mts src/widgets/improve-chat.test.mts test/bundle-load.test.mjs"
```

- [ ] **Step 2: Run the full test suite**

Run: `npm --workspace=@trailhead/browser-ext run test`

Expected: all tests pass (including the 5 new `improve()` API tests + 12 reducer tests).

- [ ] **Step 3: Add `/improve` to the smoke script**

Open `apps/browser-ext/scripts/smoke.sh`. After the `=== POST /diff ===` block (around line 39), insert:

```bash
echo "=== POST /improve (next, empty history) ==="
curl -sS -X POST "${API_URL}/improve" "${H_JSON[@]}" \
  -d '{"original_prompt":"fix the retry","missing":{"specificity":"name the file"},"history":[],"command":"next","user_id":"demo"}' | $JQ
echo

echo "=== POST /improve (finalize) ==="
curl -sS -X POST "${API_URL}/improve" "${H_JSON[@]}" \
  -d '{"original_prompt":"fix the retry","missing":{"specificity":"name the file"},"history":[{"role":"assistant","text":"What file?"},{"role":"user","text":"src/api/handler.ts"}],"command":"finalize","user_id":"demo"}' | $JQ
echo
```

- [ ] **Step 4: Smoke (against live Railway)**

Run: `bash apps/browser-ext/scripts/smoke.sh`

Expected: prints every block including the two new `/improve` ones, ending with `smoke ok`. The first /improve call returns `{"kind":"question",...}`; the second returns `{"kind":"final",...}`.

(The Railway API needs the new `/improve` endpoint deployed for the live smoke to pass. If you haven't deployed yet, this step verifies wiring locally — start the API with `npm --workspace=@trailhead/api run dev` first and re-run with `--local`.)

- [ ] **Step 5: Commit**

```bash
git add apps/browser-ext/package.json apps/browser-ext/scripts/smoke.sh
git commit -m "browser-ext: register improve-chat test + smoke /improve"
```

---

### Task 11: Update README

**Files:**
- Modify: `apps/browser-ext/README.md`

- [ ] **Step 1: Update the "Behavior" section**

In `apps/browser-ext/README.md`, locate the "Behavior (spec §6)" block (lines ~17-23). Replace it with:

```markdown
## Behavior

- Every send (Enter or send-button click) is intercepted; the score-card
  always shows for an explicit user choice (`Improve` / `Send as-is` /
  `Edit`). The earlier "≥7 → no friction" bypass is removed.
- **Improve** opens a Gemini-driven chat widget in the same card slot
  (spec `2026-04-26-improve-widget-design.md`). The user answers up to
  5 follow-up questions, then the polished prompt is dropped into the
  composer — **never auto-sent**. The user hits Enter when ready.
- **Send as-is** fires the original prompt unchanged via Claude's send
  path (button click → form submit → synthetic Enter, in that order).
- **Edit** hides the card and re-focuses the composer.
- **Fail-open:** any API error in `/score` or `/improve` falls back to a
  template (`Use template instead`) or a direct send so the user is
  never blocked.
- **Kill-switch:** `chrome.storage.local.set({'trailhead.disabled': true})`
  halts the extension on next load (spec §6.6).
```

- [ ] **Step 2: Update the "Surface" table to mention the chat slot**

The first row of the table currently says "Score-card with 5 dimension rows…". Add a note:

```markdown
| Below the textarea | Score-card with 5 dimension rows + 3 buttons; the same slot also hosts the Gemini-driven Improve chat widget when `Improve` is clicked |
```

- [ ] **Step 3: Commit**

```bash
git add apps/browser-ext/README.md
git commit -m "browser-ext: README documents always-intercept + Improve chat flow"
```

---

### Task 12: Manual smoke on Claude.ai

This is the final acceptance check before the work is shippable. There are no automated DOM tests for the widget (spec §7.5 — DOM smoke is a manual deliverable).

- [ ] **Step 1: Reload the extension**

`chrome://extensions/` → Trailhead → click ↻ reload. Refresh the Claude.ai tab.

- [ ] **Step 2: Walk through the happy path**

1. Type `fix the retry` and hit Enter
2. Score-card appears with three buttons → click **Improve**
3. Chat widget replaces the card body with a spinner
4. Gemini's first question appears
5. Type an answer, hit Enter (or click Send) — repeat for 1-2 more turns
6. Click **I'm done**
7. Polished prompt appears in the preview pane → click **Use this**
8. Polished prompt is now in Claude's composer; widget is gone; **no message is sent yet**
9. Hit Enter manually → message goes to Claude

- [ ] **Step 3: Walk through error / cancel paths**

- Click **Cancel** mid-conversation → card disappears, original prompt still in composer
- Force a network failure (DevTools → Network → Throttling: Offline) → click Improve → "Couldn't reach the coach" appears with **Use template instead** / **Cancel**
- Click **Use template instead** → falls back to current `augmentAndSend()` template

- [ ] **Step 4: Confirm console is clean**

In the Claude.ai DevTools console, no `[trailhead]` errors should appear during normal use. The only acceptable warnings are network failures during the deliberate offline test.

- [ ] **Step 5: Commit nothing — this is verification only**

If anything in steps 2-4 fails, file the regression in the next plan iteration; do not paper over it with code changes here without a fresh test.

---

## Self-review

- ✅ **Spec coverage:** every section of the spec maps to a task — types (Task 1), backend (Tasks 2-3), frontend API (Tasks 4-5), state machine (Task 6), DOM (Task 7), score-card integration (Task 8), styles (Task 9), tests + smoke (Task 10), docs (Task 11), manual verification (Task 12).
- ✅ **No placeholders:** every step has the actual code, file path, command, or expected output.
- ✅ **Type consistency:** `ImproveRequest`/`ImproveResponse`/`ImproveTurn` shapes are identical across Tasks 1, 2, 4, and 5. `IMPROVE_TURN_CAP = 5` enforced both client-side (Task 6) and server-side (Task 3). The reducer's stage names match the render switch in Task 7.
- ✅ **TDD:** state-machine tests (Task 6) precede DOM mount (Task 7); API helper tests (Task 5) precede widget integration (Task 7).
- ✅ **Frequent commits:** every task ends with a commit; intermediate steps don't leave the repo in a half-broken state.
