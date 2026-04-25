// Improve-chat widget — Gemini-driven multi-turn prompt coach.
// Spec: docs/superpowers/specs/2026-04-26-improve-widget-design.md
//
// Replaces the score-card body with a chat thread when "Improve" is
// clicked. The user has up to 5 turns; the conversation collapses into a
// polished prompt that gets dropped into Claude's composer (no auto-send).

import type { ImproveResponse, ImproveTurn, MissingHints } from '@trailhead/shared';
import { improve as apiImprove } from '../api.ts';
import { USER_ID } from '../config.ts';
import { writePrompt, type Selectors } from '../selectors.ts';
import { hideCard } from '../score-card.ts';
import { augmentAndSend } from '../send-intercept.ts';

export const IMPROVE_TURN_CAP = 5;

type ImproveState =
  | { stage: 'idle' }
  | { stage: 'asking'; history: ImproveTurn[]; pending: false }
  | { stage: 'asking'; history: ImproveTurn[]; pending: true; command: 'next' | 'finalize' }
  | { stage: 'preview'; history: ImproveTurn[]; polished: string; rationale?: string }
  | { stage: 'error'; history: ImproveTurn[]; message: string }
  | { stage: 'cancelled' }
  | { stage: 'done' };

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
  errorMsg: HTMLDivElement;
  useTemplateBtn: HTMLButtonElement;
  cancelErrBtn: HTMLButtonElement;
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
  let state: ImproveState = { stage: 'idle' };

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

  // Wire interactions.
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
  refs.doneBtn.addEventListener('click', () => {
    if (state.stage !== 'asking' || state.pending) return;
    setState({ stage: 'asking', history: state.history, pending: true, command: 'finalize' });
  });
  refs.cancelBtn.addEventListener('click', () => setState({ stage: 'cancelled' }));
  refs.cancelErrBtn.addEventListener('click', () => setState({ stage: 'cancelled' }));
  refs.useThisBtn.addEventListener('click', () => {
    if (state.stage !== 'preview') return;
    const polished = state.polished;
    try {
      writePrompt(sel.textarea, polished);
      sel.textarea.focus();
    } catch (err) {
      console.warn('[trailhead] writePrompt failed', err);
    }
    setState({ stage: 'done' });
  });
  refs.editFurtherBtn.addEventListener('click', () => {
    if (state.stage !== 'preview') return;
    setState({ stage: 'asking', history: state.history, pending: false });
  });
  refs.useTemplateBtn.addEventListener('click', () => {
    setState({ stage: 'done' });
    void augmentAndSend();
  });

  cardEl.hidden = false;
  setState({ stage: 'asking', history: [], pending: true, command: 'next' });
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
  const errorMsg = document.createElement('div');
  errorMsg.className = 'trailhead-improve-error-msg';
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
  errorBody.append(errorMsg, errActions);

  card.append(header, thread, inputRow, preview, errorBody);

  return {
    root: card, header, thread, inputRow, input,
    sendBtn, doneBtn, cancelBtn,
    preview, previewBody, useThisBtn, editFurtherBtn,
    errorBody, errorMsg, useTemplateBtn, cancelErrBtn,
  };
}

function render(refs: ChatRefs, state: ImproveState): void {
  // Re-render the thread bubbles. Conversations are short (≤ 5 turns), so
  // a full replace is cheaper than a diff.
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
    refs.thread.scrollTop = refs.thread.scrollHeight;
  }

  const isAsking = state.stage === 'asking';
  const pending = isAsking && state.pending;
  refs.inputRow.hidden = state.stage !== 'asking';
  refs.preview.hidden = state.stage !== 'preview';
  refs.errorBody.hidden = state.stage !== 'error';

  refs.input.disabled = pending;
  refs.input.placeholder = pending ? 'Coach is thinking…' : 'Type your answer…';
  refs.sendBtn.disabled = pending;
  refs.doneBtn.disabled = pending || (isAsking && state.history.length === 0);

  if (state.stage === 'preview') {
    refs.previewBody.textContent = state.polished;
    refs.header.textContent = 'Polished prompt ready';
  } else if (state.stage === 'error') {
    refs.errorMsg.textContent = state.message;
    refs.header.textContent = 'Coach unavailable';
  } else {
    refs.header.textContent = 'Improving your prompt';
  }
}

function teardown(refs: ChatRefs): void {
  delete refs.root.dataset.mode;
  hideCard();
}
