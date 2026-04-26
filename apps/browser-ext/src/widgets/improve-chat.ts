// Improve-chat widget — drives the multi-round educational score arc
// against the API's POST /coach endpoint.
//
// Why /coach (not /improve): /coach uses the project's polished MCP-server
// tactic — curated DIMENSION_TEACH blocks per round (single lowest dim
// targeted at a time), server-side no-progress detection, success and skip
// reveals showing the score arc. The user *writes* the better prompt
// themselves by appending to it across rounds; this is the educational
// path the rest of Trailhead uses. /improve was a one-off LLM rewrite
// that bypassed that learning loop.
//
// Card layout (single, persistent close button):
//
//   ┌─────────────────────────────────────────┐
//   │ <stage header>                       [×] │
//   ├─────────────────────────────────────────┤
//   │ <choice | thread+input | reveal+prompt> │
//   └─────────────────────────────────────────┘
//
// Stages:
//   1. choice     — "Start coaching" intro screen.
//   2. coaching   — chat thread of teach-blocks + user replies, input row,
//                   actions row with disabled "Use this prompt" affordance
//                   plus "I'm done" bail-out.
//   3. done       — success or skip reveal text in the rationale block,
//                   the user's evolved prompt in the preview body, and an
//                   enabled "Use this prompt" + "I'm done" action row.
//   4. error      — coach unreachable; "I'm done" + "Use template instead".

import type {
  CoachNextRoundInputs,
  CoachResponse,
  MissingHints,
} from '@trailhead/shared';
import { coach as apiCoach } from '../api.ts';
import { USER_ID } from '../config.ts';
import { writePrompt, type Selectors } from '../selectors.ts';
import { resetCard } from '../score-card.ts';
import { augmentAndSend, markApproved } from '../send-intercept.ts';

interface ChatTurn {
  role: 'user' | 'coach';
  text: string;
}

type CoachState =
  | { stage: 'choice' }
  | {
      stage: 'coaching';
      bubbles: ChatTurn[];
      currentPrompt: string;
      next: CoachNextRoundInputs | null;
      pending: false;
    }
  | {
      stage: 'coaching';
      bubbles: ChatTurn[];
      currentPrompt: string;
      next: CoachNextRoundInputs | null;
      pending: true;
    }
  | {
      stage: 'done';
      bubbles: ChatTurn[];
      currentPrompt: string;
      revealText: string;
      mode: 'score' | 'skip_reveal' | 'augment';
    }
  | {
      stage: 'error';
      bubbles: ChatTurn[];
      currentPrompt: string;
      message: string;
    }
  | { stage: 'cancelled' }
  | { stage: 'finished' };

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
  // Done — reveal text shown above the user's evolved prompt
  previewRationale: HTMLDivElement;
  previewBody: HTMLPreElement;
  // Universal action wrap. useThisRow holds primary "Use this prompt" (enabled
  // only in done). previewActionsRow holds secondary "I'm done" (enabled
  // throughout coaching + done).
  useThisRow: HTMLDivElement;
  useThisBtn: HTMLButtonElement;
  previewActionsRow: HTMLDivElement;
  previewImDoneBtn: HTMLButtonElement;
  // Error
  errorBody: HTMLDivElement;
  errorMsg: HTMLDivElement;
  errImDoneBtn: HTMLButtonElement;
  useTemplateBtn: HTMLButtonElement;
}

export function openImproveChat(
  sel: Selectors,
  originalPrompt: string,
  // missing is no longer used — /coach figures out the lowest dim itself.
  // Kept in the signature so score-card.ts callers don't break.
  _missing: MissingHints,
): void {
  console.info('[trailhead] openImproveChat: originalPrompt=', originalPrompt.slice(0, 60));
  const cardEl = document.getElementById('trailhead-score-card') as HTMLDivElement | null;
  if (!cardEl) {
    console.warn('[trailhead] openImproveChat: no #trailhead-score-card in DOM');
    return;
  }

  const refs = buildChatDom(cardEl);
  let state: CoachState = { stage: 'choice' };

  const setState = (next: CoachState): void => {
    state = next;
    render(refs, state);
    if (state.stage === 'coaching' && state.pending) {
      void runCoachCall(state.currentPrompt, state.next);
    }
    if (state.stage === 'cancelled' || state.stage === 'finished') {
      teardown(refs);
    }
  };

  const runCoachCall = async (
    prompt: string,
    nextInputs: CoachNextRoundInputs | null,
  ): Promise<void> => {
    const body = nextInputs
      ? {
          prompt,
          user_id: USER_ID,
          mode: 'score' as const,
          original_prompt: nextInputs.original_prompt,
          original_dimensions: nextInputs.original_dimensions,
          previous_dimensions: nextInputs.previous_dimensions,
          round: nextInputs.round,
        }
      : { prompt, user_id: USER_ID, mode: 'score' as const };
    const res = await apiCoach(body);
    handleCoachResponse(res);
  };

  const handleCoachResponse = (res: CoachResponse | null): void => {
    if (state.stage !== 'coaching' || !state.pending) return;
    if (!res) {
      setState({
        stage: 'error',
        bubbles: state.bubbles,
        currentPrompt: state.currentPrompt,
        message: 'Couldn’t reach the coach.',
      });
      return;
    }
    // proceed=false → another teaching round. Append the coach's text as an
    // assistant bubble and wait for the user's reply.
    if (!res.proceed) {
      const bubbles: ChatTurn[] = res.text.trim()
        ? [...state.bubbles, { role: 'coach', text: res.text.trim() }]
        : state.bubbles;
      setState({
        stage: 'coaching',
        bubbles,
        currentPrompt: state.currentPrompt,
        next: res.next_round_inputs ?? null,
        pending: false,
      });
      return;
    }
    // proceed=true → reached an exit (success, skip_reveal, or already-strong
    // first-round). Move to the done state with the reveal text and the
    // user's evolved prompt as the result.
    setState({
      stage: 'done',
      bubbles: state.bubbles,
      currentPrompt: state.currentPrompt,
      revealText: res.text.trim(),
      mode: res.mode,
    });
  };

  const sendUserReply = (): void => {
    if (state.stage !== 'coaching' || state.pending) return;
    const text = refs.input.value.trim();
    if (!text) return;
    refs.input.value = '';
    // Concatenate the user's reply onto their prompt (the MCP coaching
    // pattern — the user's own writing becomes the final prompt). A single
    // space separator keeps the prompt readable and matches the directive's
    // "user's reply concatenated to the previous prompt" instruction.
    const newPrompt = `${state.currentPrompt} ${text}`;
    setState({
      stage: 'coaching',
      bubbles: [...state.bubbles, { role: 'user', text }],
      currentPrompt: newPrompt,
      next: state.next,
      pending: true,
    });
  };

  // "I'm done" — bail to the user's ORIGINAL prompt as it stands in the
  // composer. We mark it as approved so the next Enter sends straight to
  // Claude without re-opening the score card.
  const onImDone = (): void => {
    console.info('[trailhead] coach: I’m done clicked, originalPrompt=', originalPrompt.slice(0, 60));
    markApproved(originalPrompt);
    sel.textarea.focus();
    setState({ stage: 'finished' });
  };

  // ----- Header X (single cancel for the whole widget)
  refs.closeBtn.addEventListener('click', () => setState({ stage: 'cancelled' }));

  // ----- Choice screen
  refs.startBtn.addEventListener('click', () => {
    if (state.stage !== 'choice') return;
    setState({
      stage: 'coaching',
      bubbles: [],
      currentPrompt: originalPrompt,
      next: null,
      pending: true,
    });
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

  // ----- Done — "Use this prompt" writes the user's evolved prompt into
  // the composer and pre-approves it so the next Enter sends through.
  refs.useThisBtn.addEventListener('click', () => {
    if (state.stage !== 'done') return;
    const finalPrompt = state.currentPrompt;
    try {
      writePrompt(sel.textarea, finalPrompt);
      sel.textarea.focus();
      markApproved(finalPrompt);
    } catch (err) {
      console.warn('[trailhead] writePrompt failed', err);
    }
    setState({ stage: 'finished' });
  });
  refs.previewImDoneBtn.addEventListener('click', onImDone);

  // ----- Error
  refs.errImDoneBtn.addEventListener('click', onImDone);
  refs.useTemplateBtn.addEventListener('click', () => {
    setState({ stage: 'finished' });
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

  // Choice screen
  const choice = document.createElement('div');
  choice.className = 'trailhead-improve-choice';
  const choiceIntro = document.createElement('div');
  choiceIntro.className = 'trailhead-improve-choice-intro';
  choiceIntro.textContent =
    'Walk through a few targeted questions. Your replies build a stronger version of your own prompt — and you’ll learn the rubric the coach scores against.';
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

  // Reveal block — the success/skip reveal text rendered above the final
  // prompt. Shares the same accent-tinted style as the old rationale slot.
  const previewRationale = document.createElement('div');
  previewRationale.className = 'trailhead-improve-preview-rationale';
  previewRationale.hidden = true;

  // Final prompt (user's own evolved prompt, not an LLM rewrite). Shown in
  // the done stage so the user can see what they’ll send if they accept.
  const previewBody = document.createElement('pre');
  previewBody.className = 'trailhead-improve-preview-body';
  previewBody.hidden = true;

  // Action rows. useThisRow = primary "Use this prompt" (enabled only in
  // done). previewActionsRow = secondary "I'm done" (enabled in coaching +
  // done so the user can bail to the original prompt at any moment).
  const useThisRow = document.createElement('div');
  useThisRow.className = 'trailhead-improve-preview-actions';
  const useThisBtn = document.createElement('button');
  useThisBtn.type = 'button';
  useThisBtn.className = 'is-primary';
  useThisBtn.disabled = true;
  useThisBtn.title = 'Available once coaching wraps up.';
  useThisBtn.textContent = 'Use this prompt';
  useThisRow.append(useThisBtn);

  const previewActionsRow = document.createElement('div');
  previewActionsRow.className = 'trailhead-improve-preview-actions';
  previewActionsRow.hidden = true;
  const previewImDoneBtn = document.createElement('button');
  previewImDoneBtn.type = 'button';
  previewImDoneBtn.title =
    'Discard coaching changes — use my original prompt as I typed it.';
  previewImDoneBtn.textContent = 'Keep original';
  previewActionsRow.append(previewImDoneBtn);

  // Error stage actions: bail to original or accept the legacy template.
  const errorBody = document.createElement('div');
  errorBody.className = 'trailhead-improve-error';
  errorBody.hidden = true;
  const errorMsg = document.createElement('div');
  errorMsg.className = 'trailhead-improve-error-msg';
  const errActions = document.createElement('div');
  errActions.className = 'trailhead-improve-error-actions';
  const errImDoneBtn = document.createElement('button');
  errImDoneBtn.type = 'button';
  errImDoneBtn.title = 'Discard the coaching attempt and use my original prompt as-is.';
  errImDoneBtn.textContent = 'Keep original';
  const useTemplateBtn = document.createElement('button');
  useTemplateBtn.type = 'button';
  useTemplateBtn.className = 'is-primary';
  useTemplateBtn.textContent = 'Use template instead';
  errActions.append(errImDoneBtn, useTemplateBtn);
  errorBody.append(errorMsg, errActions);

  // Right-aligned wrapper for the two action rows. In coaching: only
  // "I'm done" is visible. In done: "I'm done" + enabled "Use this prompt"
  // sit side-by-side on a single horizontal line, primary on the right.
  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'trailhead-improve-actions-wrap';
  actionsWrap.append(previewActionsRow, useThisRow);

  card.append(
    header,
    choice,
    thread,
    inputRow,
    previewRationale,
    previewBody,
    actionsWrap,
    errorBody,
  );

  return {
    root: card, header, headerTitle, closeBtn,
    choice, startBtn,
    thread, inputRow, input, sendBtn,
    previewRationale, previewBody, useThisRow, useThisBtn, previewActionsRow, previewImDoneBtn,
    errorBody, errorMsg, errImDoneBtn, useTemplateBtn,
  };
}

function render(refs: ChatRefs, state: CoachState): void {
  const isCoaching = state.stage === 'coaching';
  const isDone = state.stage === 'done';

  refs.choice.hidden = state.stage !== 'choice';
  refs.thread.hidden = !isCoaching && !isDone;
  refs.inputRow.hidden = !isCoaching;
  refs.previewRationale.hidden = true;
  refs.previewBody.hidden = !isDone;
  refs.useThisRow.hidden = !isCoaching && !isDone;
  refs.previewActionsRow.hidden = !isCoaching && !isDone;
  refs.errorBody.hidden = state.stage !== 'error';

  // Header reflects the current stage so the user always knows where they
  // are in the flow.
  if (state.stage === 'choice') {
    refs.headerTitle.textContent = 'Improve your prompt';
  } else if (state.stage === 'coaching') {
    refs.headerTitle.textContent = state.pending ? 'Coaching…' : 'Your turn';
  } else if (state.stage === 'done') {
    refs.headerTitle.textContent =
      state.mode === 'skip_reveal' ? 'Coaching paused' : 'Coaching complete';
  } else if (state.stage === 'error') {
    refs.headerTitle.textContent = 'Coach unavailable';
  }

  // Render chat bubbles in coaching + done so the conversation stays visible
  // as a learning record even after the user reaches the reveal.
  if (isCoaching || isDone) {
    refs.thread.replaceChildren();
    const bubbles = state.stage === 'coaching' || state.stage === 'done' ? state.bubbles : [];
    for (const t of bubbles) {
      const bubble = document.createElement('div');
      const role = t.role === 'coach' ? 'assistant' : 'user';
      bubble.className = `trailhead-bubble trailhead-bubble--${role}`;
      bubble.textContent = (t.role === 'coach' ? '🧑‍🏫 ' : '👤 ') + t.text;
      refs.thread.appendChild(bubble);
    }
    if (isCoaching && state.pending) {
      const bubble = document.createElement('div');
      bubble.className = 'trailhead-bubble trailhead-bubble--assistant trailhead-bubble--pending';
      bubble.textContent = '…';
      refs.thread.appendChild(bubble);
    }
    refs.thread.scrollTop = refs.thread.scrollHeight;
  }

  if (isCoaching) {
    const pending = state.pending;
    refs.input.disabled = pending;
    refs.sendBtn.disabled = pending;
    refs.input.placeholder = pending ? 'Coach is thinking…' : 'Type your answer…';
    // Use this prompt is disabled until coaching reaches a reveal.
    refs.useThisBtn.disabled = true;
    refs.useThisBtn.title = 'Available once coaching wraps up.';
  }

  if (isDone) {
    // Reveal text (success or skip reveal) shown as the lesson recap above
    // the user's evolved prompt. Server may return empty text on a
    // first-round-already-strong shortcut; only render the block when there
    // is something to show.
    const text = state.revealText;
    if (text && text.trim()) {
      refs.previewRationale.replaceChildren();
      const label = document.createElement('span');
      label.className = 'trailhead-improve-preview-rationale-label';
      label.textContent = state.mode === 'skip_reveal' ? 'How you could have written it' : 'What changed';
      const body = document.createElement('span');
      body.className = 'trailhead-improve-preview-rationale-text';
      body.textContent = text;
      refs.previewRationale.append(label, body);
      refs.previewRationale.hidden = false;
    }
    refs.previewBody.textContent = state.currentPrompt;
    refs.useThisBtn.disabled = !state.currentPrompt.trim();
    refs.useThisBtn.title = 'Drop your evolved prompt into Claude’s composer.';
    refs.input.disabled = true;
    refs.sendBtn.disabled = true;
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
