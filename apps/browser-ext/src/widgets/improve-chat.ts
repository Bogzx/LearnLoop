// Improve-chat widget — Gemini-driven multi-turn prompt coach.
// Spec: docs/superpowers/specs/2026-04-26-improve-widget-design.md
//
// Card layout (single, persistent close button):
//
//   ┌─────────────────────────────────────────┐
//   │ <stage header>                       [×] │  ← X always cancels
//   ├─────────────────────────────────────────┤
//   │ <choice | thread+input | preview | err> │  ← stage-specific body
//   └─────────────────────────────────────────┘
//
// Stages:
//   1. choice  — opening screen with a single "Start coaching" button.
//                (The wiki-context option lives in the extension popup,
//                not here.)
//   2. asking  — chat thread + input row, Send only.
//   3. preview — polished prompt + Use this. Use this writes the prompt
//                into Claude's composer and marks it approved so the
//                user's next Enter goes straight to Claude.
//   4. error   — coach unreachable; "Use template instead" fallback.

import type { ImproveResponse, ImproveTurn, MissingHints } from '@trailhead/shared';
import { improve as apiImprove } from '../api.ts';
import { USER_ID } from '../config.ts';
import { writePrompt, type Selectors } from '../selectors.ts';
import { resetCard } from '../score-card.ts';
import { augmentAndSend, markApproved } from '../send-intercept.ts';

export const IMPROVE_TURN_CAP = 5;

type ImproveState =
  | { stage: 'choice' }
  | { stage: 'asking'; history: ImproveTurn[]; pending: false }
  | { stage: 'asking'; history: ImproveTurn[]; pending: true; command: 'next' | 'finalize' }
  | { stage: 'preview'; history: ImproveTurn[]; polished: string; rationale?: string }
  | { stage: 'error'; history: ImproveTurn[]; message: string }
  | { stage: 'cancelled' }
  | { stage: 'done' };

interface ChatRefs {
  root: HTMLDivElement;
  // Header (always visible)
  header: HTMLDivElement;
  headerTitle: HTMLDivElement;
  closeBtn: HTMLButtonElement;
  // Choice screen
  choice: HTMLDivElement;
  startBtn: HTMLButtonElement;
  // Chat thread
  thread: HTMLDivElement;
  inputRow: HTMLDivElement;
  input: HTMLTextAreaElement;
  sendBtn: HTMLButtonElement;
  // Preview body (the polished prompt — preview stage only)
  previewBody: HTMLPreElement;
  // Universal "Use AI prompt" row: visible in asking + preview, disabled
  // until a polished prompt arrives.
  useThisRow: HTMLDivElement;
  useThisBtn: HTMLButtonElement;
  // I'm done lives in its own row, visible in preview only.
  previewActionsRow: HTMLDivElement;
  previewImDoneBtn: HTMLButtonElement;
  // Error
  errorBody: HTMLDivElement;
  errorMsg: HTMLDivElement;
  useTemplateBtn: HTMLButtonElement;
}

function userReplyCount(history: ImproveTurn[]): number {
  return history.filter((t) => t.role === 'user').length;
}

export function openImproveChat(
  sel: Selectors,
  originalPrompt: string,
  missing: MissingHints,
): void {
  console.info('[trailhead] openImproveChat: originalPrompt=', originalPrompt.slice(0, 60), 'missing=', Object.keys(missing));
  const cardEl = document.getElementById('trailhead-score-card') as HTMLDivElement | null;
  if (!cardEl) {
    console.warn('[trailhead] openImproveChat: no #trailhead-score-card in DOM');
    return;
  }

  const refs = buildChatDom(cardEl);
  let state: ImproveState = { stage: 'choice' };

  const setState = (next: ImproveState): void => {
    state = next;
    render(refs, state);
    if (state.stage === 'asking' && state.pending) {
      void runImproveCall(state.history, state.command);
    }
    if (state.stage === 'cancelled' || state.stage === 'done') {
      teardown(refs);
    }
  };

  const runImproveCall = async (history: ImproveTurn[], command: 'next' | 'finalize'): Promise<void> => {
    const res = await apiImprove({
      original_prompt: originalPrompt,
      missing,
      history,
      command,
      user_id: USER_ID,
    });
    handleApiResponse(res);
  };

  const handleApiResponse = (res: ImproveResponse | null): void => {
    if (state.stage !== 'asking' || !state.pending) return;
    if (!res) {
      setState({ stage: 'error', history: state.history, message: 'Couldn’t reach the coach.' });
      return;
    }
    if (res.kind === 'question') {
      const history = [...state.history, { role: 'assistant' as const, text: res.text }];
      setState({ stage: 'asking', history, pending: false });
      return;
    }
    setState({
      stage: 'preview',
      history: state.history,
      polished: res.polished,
      rationale: res.rationale,
    });
  };

  const sendUserReply = (): void => {
    if (state.stage !== 'asking' || state.pending) return;
    const text = refs.input.value.trim();
    if (!text) return;
    const history = [...state.history, { role: 'user' as const, text }];
    refs.input.value = '';
    const replies = userReplyCount(history);
    const command: 'next' | 'finalize' = replies >= IMPROVE_TURN_CAP ? 'finalize' : 'next';
    setState({ stage: 'asking', history, pending: true, command });
  };

  // "I'm done" — bail out of the widget and use the user's ORIGINAL
  // prompt as it stands in the composer. We mark it as approved so the
  // next Enter sends straight to Claude without re-opening the score
  // card. Used from the chat (asking) and preview stages.
  const onImDone = (): void => {
    console.info('[trailhead] improve: I\'m done clicked, originalPrompt=', originalPrompt.slice(0, 60));
    markApproved(originalPrompt);
    sel.textarea.focus();
    setState({ stage: 'done' });
  };

  // ----- Header X (single cancel for the whole widget)
  refs.closeBtn.addEventListener('click', () => setState({ stage: 'cancelled' }));

  // ----- Choice screen
  refs.startBtn.addEventListener('click', () => {
    if (state.stage !== 'choice') return;
    setState({ stage: 'asking', history: [], pending: true, command: 'next' });
    requestAnimationFrame(() => refs.input.focus());
  });

  // ----- Chat
  refs.sendBtn.addEventListener('click', sendUserReply);
  refs.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      sendUserReply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setState({ stage: 'cancelled' });
    }
  });

  // ----- Preview
  refs.useThisBtn.addEventListener('click', () => {
    if (state.stage !== 'preview') return;
    const polished = state.polished;
    try {
      writePrompt(sel.textarea, polished);
      sel.textarea.focus();
      // Tell send-intercept this exact text is pre-approved so the user's
      // next Enter sends straight to Claude (no score-card, no widget).
      markApproved(polished);
    } catch (err) {
      console.warn('[trailhead] writePrompt failed', err);
    }
    setState({ stage: 'done' });
  });
  refs.previewImDoneBtn.addEventListener('click', onImDone);

  // ----- Error
  refs.useTemplateBtn.addEventListener('click', () => {
    setState({ stage: 'done' });
    void augmentAndSend();
  });

  cardEl.hidden = false;
  render(refs, state);
}

function buildChatDom(card: HTMLDivElement): ChatRefs {
  card.replaceChildren();
  card.dataset.mode = 'improve';

  // Header with title + persistent X
  const header = document.createElement('div');
  header.className = 'trailhead-improve-header';
  const headerTitle = document.createElement('div');
  headerTitle.className = 'trailhead-improve-header-title';
  headerTitle.textContent = 'Improve your prompt';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'trailhead-improve-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  header.append(headerTitle, closeBtn);

  // Choice screen — single Start button now that wiki context lives in
  // the popup.
  const choice = document.createElement('div');
  choice.className = 'trailhead-improve-choice';
  const choiceIntro = document.createElement('div');
  choiceIntro.className = 'trailhead-improve-choice-intro';
  choiceIntro.textContent = 'Want me to coach this prompt with a few quick questions?';
  const choiceActions = document.createElement('div');
  choiceActions.className = 'trailhead-improve-choice-actions';
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'is-primary';
  startBtn.textContent = 'Start coaching';
  choiceActions.append(startBtn);
  choice.append(choiceIntro, choiceActions);

  // Chat
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
  inputRow.append(input, sendBtn);

  // Preview body (the polished prompt) — preview stage only.
  const previewBody = document.createElement('pre');
  previewBody.className = 'trailhead-improve-preview-body';
  previewBody.hidden = true;

  // Universal "Use AI prompt" row — visible across asking + preview so
  // the action is always discoverable. Stays disabled until polished
  // arrives, then lights up.
  const useThisRow = document.createElement('div');
  useThisRow.className = 'trailhead-improve-preview-actions';
  const useThisBtn = document.createElement('button');
  useThisBtn.type = 'button';
  useThisBtn.className = 'is-primary';
  useThisBtn.disabled = true;
  useThisBtn.title = 'Available once the coach has polished your prompt.';
  useThisBtn.textContent = 'Use AI prompt';
  useThisRow.append(useThisBtn);

  // Preview-only actions row (currently just I'm done).
  const previewActionsRow = document.createElement('div');
  previewActionsRow.className = 'trailhead-improve-preview-actions';
  previewActionsRow.hidden = true;
  const previewImDoneBtn = document.createElement('button');
  previewImDoneBtn.type = 'button';
  previewImDoneBtn.title = 'Discard the polished version — use the prompt I originally typed.';
  previewImDoneBtn.textContent = 'I’m done';
  previewActionsRow.append(previewImDoneBtn);

  // Error
  const errorBody = document.createElement('div');
  errorBody.className = 'trailhead-improve-error';
  errorBody.hidden = true;
  const errorMsg = document.createElement('div');
  errorMsg.className = 'trailhead-improve-error-msg';
  const errActions = document.createElement('div');
  errActions.className = 'trailhead-improve-error-actions';
  const useTemplateBtn = document.createElement('button');
  useTemplateBtn.type = 'button';
  useTemplateBtn.className = 'is-primary';
  useTemplateBtn.textContent = 'Use template instead';
  errActions.append(useTemplateBtn);
  errorBody.append(errorMsg, errActions);

  card.append(
    header,
    choice,
    thread,
    inputRow,
    previewBody,
    useThisRow,
    previewActionsRow,
    errorBody,
  );

  return {
    root: card, header, headerTitle, closeBtn,
    choice, startBtn,
    thread, inputRow, input, sendBtn,
    previewBody, useThisRow, useThisBtn, previewActionsRow, previewImDoneBtn,
    errorBody, errorMsg, useTemplateBtn,
  };
}

function render(refs: ChatRefs, state: ImproveState): void {
  refs.choice.hidden = state.stage !== 'choice';
  refs.thread.hidden = state.stage !== 'asking';
  refs.inputRow.hidden = state.stage !== 'asking';
  refs.previewBody.hidden = state.stage !== 'preview';
  // Use AI prompt row is visible across asking + preview.
  refs.useThisRow.hidden = state.stage !== 'asking' && state.stage !== 'preview';
  // I'm done row stays preview-only.
  refs.previewActionsRow.hidden = state.stage !== 'preview';
  refs.errorBody.hidden = state.stage !== 'error';

  if (state.stage === 'choice') {
    refs.headerTitle.textContent = 'Improve your prompt';
  } else if (state.stage === 'asking') {
    refs.headerTitle.textContent = 'Coaching…';
  } else if (state.stage === 'preview') {
    refs.headerTitle.textContent = 'Polished prompt ready';
  } else if (state.stage === 'error') {
    refs.headerTitle.textContent = 'Coach unavailable';
  }

  if (state.stage === 'asking') {
    refs.thread.replaceChildren();
    for (const t of state.history) {
      const bubble = document.createElement('div');
      bubble.className = `trailhead-bubble trailhead-bubble--${t.role}`;
      bubble.textContent = (t.role === 'assistant' ? '🤖 ' : '👤 ') + t.text;
      refs.thread.appendChild(bubble);
    }
    if (state.pending) {
      const bubble = document.createElement('div');
      bubble.className = 'trailhead-bubble trailhead-bubble--assistant trailhead-bubble--pending';
      bubble.textContent = '…';
      refs.thread.appendChild(bubble);
    }
    refs.thread.scrollTop = refs.thread.scrollHeight;

    const pending = state.pending;
    refs.input.disabled = pending;
    refs.sendBtn.disabled = pending;
    // "I'm done" stays enabled even while a request is in flight — the
    // user is allowed to bail at any moment. Pending API responses are
    // ignored once we transition to 'done'.
    refs.input.placeholder = pending ? 'Coach is thinking…' : 'Type your answer…';
  }

  if (state.stage === 'preview') {
    refs.previewBody.textContent = state.polished;
    // Enable Use AI prompt now that we have a polished prompt to use.
    // Defensive empty-check stays in case the API ever returns "".
    refs.useThisBtn.disabled = !state.polished?.trim();
    refs.useThisBtn.title = 'Drop the AI-polished prompt into Claude’s composer.';
  } else {
    // Asking (and any pre-preview state) — keep the button disabled
    // until the coach finalizes.
    refs.useThisBtn.disabled = true;
    refs.useThisBtn.title = 'Available once the coach has polished your prompt.';
  }
  if (state.stage === 'error') {
    refs.errorMsg.textContent = state.message;
  }
}

function teardown(refs: ChatRefs): void {
  delete refs.root.dataset.mode;
  // buildChatDom wiped cardEl's children and replaced them with chat
  // DOM, so the score-card module's bodyEl/actionsEl references are now
  // stale. Tear cardEl all the way down so the next scoreAndShow
  // rebuilds a fresh card with live refs — otherwise the next send
  // would reveal the leftover chat DOM ("widget opens again" bug).
  resetCard();
}
