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
import { hideCard } from '../score-card.ts';
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
  chatImDoneBtn: HTMLButtonElement;
  // Preview
  preview: HTMLDivElement;
  previewBody: HTMLPreElement;
  useThisBtn: HTMLButtonElement;
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
  const cardEl = document.getElementById('trailhead-score-card') as HTMLDivElement | null;
  if (!cardEl) return;

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
  refs.chatImDoneBtn.addEventListener('click', onImDone);
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
  const chatImDoneBtn = document.createElement('button');
  chatImDoneBtn.type = 'button';
  chatImDoneBtn.title = 'Skip improving — use the prompt I already typed.';
  chatImDoneBtn.textContent = 'I’m done';
  inputRow.append(input, sendBtn, chatImDoneBtn);

  // Preview
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
  useThisBtn.title = 'Use the AI-polished prompt below.';
  useThisBtn.textContent = 'Use this';
  const previewImDoneBtn = document.createElement('button');
  previewImDoneBtn.type = 'button';
  previewImDoneBtn.title = 'Discard the polished version — use the prompt I originally typed.';
  previewImDoneBtn.textContent = 'I’m done';
  previewActions.append(useThisBtn, previewImDoneBtn);
  preview.append(previewBody, previewActions);

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

  card.append(header, choice, thread, inputRow, preview, errorBody);

  return {
    root: card, header, headerTitle, closeBtn,
    choice, startBtn,
    thread, inputRow, input, sendBtn, chatImDoneBtn,
    preview, previewBody, useThisBtn, previewImDoneBtn,
    errorBody, errorMsg, useTemplateBtn,
  };
}

function render(refs: ChatRefs, state: ImproveState): void {
  refs.choice.hidden = state.stage !== 'choice';
  refs.thread.hidden = state.stage !== 'asking';
  refs.inputRow.hidden = state.stage !== 'asking';
  refs.preview.hidden = state.stage !== 'preview';
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
  }
  if (state.stage === 'error') {
    refs.errorMsg.textContent = state.message;
  }
}

function teardown(refs: ChatRefs): void {
  delete refs.root.dataset.mode;
  hideCard();
}
