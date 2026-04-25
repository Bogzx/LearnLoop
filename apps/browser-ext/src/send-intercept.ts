// Send-intercept logic. Hooks Enter on the textarea and click on the send
// button; both route through onSendAttempt.
//
// Architecture (post-2026-04-25 rewrite):
//
//   Enter / send-button click
//     → preventDefault + stopPropagation
//     → readPrompt(textarea)
//     → scoreAndShow(prompt)               // cache hit instant; miss ~2-4s
//     → on null (/score failed)            → triggerNativeSend (fail-open)
//     → on overall ≥ 7                     → hideCard + triggerNativeSend
//     → on overall < 7                     → card stays visible with three
//                                            buttons (Improve, Send as-is,
//                                            Edit). User picks. No timer.
//
// What's gone (vs the original):
//   - The 250ms keystroke debounce in score-card.ts (we don't pre-score).
//   - The 5-second auto-send nudge timer (the user is in control; we
//     never auto-fire the prompt).
//   - The `pendingNudge` promise machinery (no async coordination needed
//     once we removed the timer — buttons drive the flow directly).
import { capture as apiCapture } from './api.ts';
import { USER_ID } from './config.ts';
import { augment } from './augment.ts';
import { simpleHash } from './hash.ts';
import { readPrompt, writePrompt, type Selectors } from './selectors.ts';
import { store } from './store.ts';
import { hideCard, scoreAndShow } from './score-card.ts';

let activeSelectors: Selectors | null = null;
let sentOnce = false;
let inFlight = false;

export function attachSendIntercept(sel: Selectors): () => void {
  activeSelectors = sel;

  const onKeydown = (e: KeyboardEvent): void => {
    // Only Enter (no Shift, no IME composition) is "send" on Claude.ai.
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    onSendAttempt(e);
  };

  const onSendClick = (e: MouseEvent): void => {
    onSendAttempt(e);
  };

  sel.textarea.addEventListener('keydown', onKeydown, { capture: true });
  sel.sendButton?.addEventListener('click', onSendClick, { capture: true });

  return () => {
    sel.textarea.removeEventListener('keydown', onKeydown, { capture: true } as AddEventListenerOptions);
    sel.sendButton?.removeEventListener('click', onSendClick, { capture: true } as AddEventListenerOptions);
    activeSelectors = null;
  };
}

function onSendAttempt(e: Event): void {
  if (!activeSelectors) return;
  const text = readPrompt(activeSelectors.textarea).trim();
  if (!text) return; // empty composer → let native handler no-op

  // We can't decide whether to send until we have a score. Block the
  // native send unconditionally; we'll re-fire it programmatically if
  // the score clears the threshold or the user picks Send-as-is.
  e.preventDefault();
  e.stopPropagation();

  // Re-arm so the same composer state can be sent after this attempt.
  sentOnce = false;

  // Concurrent submits collapse: if a /score is already in flight for
  // an earlier Enter on the same prompt, the latest scoreAndShow will
  // abort the prior request via its own AbortController and supersede.
  if (inFlight) return;
  inFlight = true;
  void runIntercept(text).finally(() => {
    inFlight = false;
  });
}

async function runIntercept(text: string): Promise<void> {
  const res = await scoreAndShow(text);
  if (!res) {
    // /score failed (timeout, network, parse). Fail-open: send the
    // prompt unchanged. We never block the user on infrastructure.
    triggerNativeSend();
    return;
  }
  if (res.overall >= 7) {
    // High-quality prompts go through with no friction. The card was
    // briefly shown by scoreAndShow; hide it before firing the send so
    // the UI doesn't flash a result the user never had to read.
    hideCard();
    triggerNativeSend();
    return;
  }
  // <7: leave the card visible. Action buttons drive the next step:
  //   Improve   → augmentAndSend()
  //   Send as-is → triggerNativeSend()
  //   Edit      → hideCard() + focusComposer()
}

export function triggerNativeSend(): void {
  if (sentOnce) return;
  doNativeSend();
}

export function focusComposer(): void {
  if (!activeSelectors) return;
  try {
    activeSelectors.textarea.focus();
  } catch {
    /* swallow — focus is a nicety */
  }
}

// We remember the most-recently-scored prompt so the capture row carries the
// real dimensions even when the textarea has been overwritten by augment().
let lastScoredText = '';
export function rememberScoredPrompt(text: string): void {
  lastScoredText = text;
}

function fireSendOnce(sel: Selectors): boolean {
  // Path 1: programmatic click on the actual send button. `.click()` produces
  // an untrusted MouseEvent but Claude.ai's React onClick handler still runs
  // (only browser-action defaults like `<a target=_blank>` need trust).
  if (sel.sendButton && sel.sendButton.isConnected) {
    try {
      sel.sendButton.click();
      return true;
    } catch {
      /* fall through to form.requestSubmit */
    }
  }
  // Path 2: form.requestSubmit() — fires a real submit event the form's
  // onSubmit handler picks up. Only works if the textarea sits inside a form.
  const form = sel.textarea.closest('form');
  if (form && typeof form.requestSubmit === 'function') {
    try {
      form.requestSubmit();
      return true;
    } catch {
      /* fall through */
    }
  }
  return false;
}

async function doNativeSend(): Promise<void> {
  if (sentOnce) return;
  sentOnce = true;
  if (!activeSelectors) return;
  const sel = activeSelectors;
  const sentText = readPrompt(sel.textarea);
  hideCard();
  const fired = fireSendOnce(sel);
  if (!fired) {
    console.warn('[trailhead] send fallback failed — both button.click() and form.requestSubmit() unavailable');
  }
  // Best-effort capture write. We use the *originally-scored* prompt for
  // analytics so the augmentation doesn't pollute the row, and we look up
  // its dimensions from the store. Fail-open: we don't await the response.
  const promptForCapture = lastScoredText.trim() || sentText.trim();
  if (promptForCapture) {
    const hash = simpleHash(promptForCapture);
    const entry = store.getScore(hash);
    const res = await apiCapture({
      surface: 'browser',
      user_prompt: promptForCapture,
      scored_dimensions: entry?.dimensions,
      user_id: USER_ID,
    });
    if (res) store.setCaptureId(hash, res.id);
  }
}

export async function augmentAndSend(): Promise<void> {
  if (!activeSelectors || sentOnce) return;
  const sel = activeSelectors;
  const original = readPrompt(sel.textarea);
  if (!original.trim()) return;
  // Remember the original so the capture row uses the un-augmented text.
  rememberScoredPrompt(original);
  const hash = simpleHash(original);
  const entry = store.getScore(hash);
  const augmented = augment(original, entry?.missing ?? {});
  writePrompt(sel.textarea, augmented);
  // Yield once so Claude.ai's controlled input registers the new value
  // before the synthetic send fires.
  await Promise.resolve();
  void doNativeSend();
}
