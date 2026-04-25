// Send-intercept logic. Hooks Enter on the textarea and click on the send
// button; both route through onSendAttempt. Spec §5.3:
//
//   overall = store.get(currentHash)?.overall ?? 10   (optimistic on missing)
//   if overall ≥ 7 → return; native send fires; no card highlight
//   else → preventDefault
//          pulse card 5s
//          wait for one of: clarify | as-is | timeout
//          clarify → augment + send
//          as-is   → native send
//          timeout → native send
//
// We never block the user. The 5s timeout fallback is the contract.
import { capture as apiCapture } from './api.ts';
import { SEND_NUDGE_MS, USER_ID } from './config.ts';
import { augment } from './augment.ts';
import { simpleHash } from './hash.ts';
import { readPrompt, writePrompt, type Selectors } from './selectors.ts';
import { store } from './store.ts';
import { currentPromptHash, pulseCard } from './score-card.ts';

let activeSelectors: Selectors | null = null;
let pendingNudge: { resolve: (action: 'clarify' | 'as-is' | 'timeout') => void } | null = null;
let sentOnce = false;

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
  const hash = currentPromptHash(activeSelectors);
  const entry = store.getScore(hash);
  // Optimistic-on-missing: an unknown score means we never block.
  const overall = entry?.overall ?? 10;
  if (overall >= 7) return;

  // <7 → preventDefault for SEND_NUDGE_MS, then auto-send unchanged.
  e.preventDefault();
  e.stopPropagation();

  pulseCard(SEND_NUDGE_MS);
  sentOnce = false;

  // Resolve the previous nudge as a no-op so a second Enter inside the window
  // immediately auto-sends rather than queuing a second timer (spec §6.3).
  if (pendingNudge) {
    pendingNudge.resolve('as-is');
    pendingNudge = null;
  }

  let timeoutId: number | null = null;
  const decision = new Promise<'clarify' | 'as-is' | 'timeout'>((resolve) => {
    pendingNudge = { resolve };
    timeoutId = window.setTimeout(() => {
      if (pendingNudge) {
        const r = pendingNudge.resolve;
        pendingNudge = null;
        r('timeout');
      }
    }, SEND_NUDGE_MS);
  });

  void decision.then((action) => {
    if (timeoutId !== null) clearTimeout(timeoutId);
    if (action === 'clarify') void augmentAndSend();
    else triggerNativeSend();
  });
}

export function triggerNativeSend(): void {
  if (sentOnce) return;
  if (pendingNudge) {
    pendingNudge.resolve('as-is');
    pendingNudge = null;
    return;
  }
  doNativeSend();
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
  if (pendingNudge) {
    pendingNudge.resolve('clarify');
    pendingNudge = null;
  }
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
