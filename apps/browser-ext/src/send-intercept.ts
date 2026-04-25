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
import { isCoachingEnabled } from './coaching-state.ts';
import { getCachedContextBundle } from './context-bundle.ts';

let activeSelectors: Selectors | null = null;
let sentOnce = false;
let inFlight = false;
// Set briefly while we dispatch our own synthetic Enter keydown so the
// capture-phase listener on the textarea lets it through to Claude.ai
// instead of re-running the intercept.
let bypassIntercept = false;
// The most recent prompt the user explicitly approved via the Improve
// chat widget's "Use this" button. When the next send-attempt's textarea
// content matches this verbatim, we skip the intercept so the polished
// prompt flows straight to Claude without re-scoring or re-opening the
// score-card. User edits invalidate the match (and re-trigger the
// intercept), which is the correct behavior — they asked for coaching
// on the new wording.
let approvedPrompt: string | null = null;

export function markApproved(prompt: string): void {
  approvedPrompt = prompt;
  console.info('[trailhead] markApproved:', prompt.slice(0, 60));
}

export function attachSendIntercept(sel: Selectors): () => void {
  activeSelectors = sel;

  // Listen at window with capture — fires BEFORE any element-level listener
  // (Tiptap / ProseMirror attach keydown directly on the contenteditable).
  // Filter to events whose target is inside our textarea so we don't
  // intercept Enter on unrelated parts of the page.
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const target = e.target as Node | null;
    // Node.contains() returns true for the node itself plus any descendant,
    // so a single check covers both "Enter on the textarea root" and "Enter
    // inside a Tiptap-rendered child element".
    if (!target || !sel.textarea.contains(target)) return;
    console.info('[trailhead] enter intercepted on', location.pathname);
    onSendAttempt(e);
  };

  const onSendClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // Ignore clicks on our own score-card buttons.
    if (target.closest('#trailhead-score-card')) return;
    // Match any send-button-shaped element (re-resolved live since the
    // cached sel.sendButton is often null at attach time).
    const btn = target.closest('button');
    if (!btn) return;
    const aria = btn.getAttribute('aria-label') || '';
    const testid = btn.getAttribute('data-testid') || '';
    const isSend =
      /send/i.test(aria) ||
      /send/i.test(testid) ||
      btn.type === 'submit';
    if (!isSend) return;
    console.info('[trailhead] send-button click intercepted');
    onSendAttempt(e);
  };

  // Use stopImmediatePropagation in onSendAttempt to also stop sibling
  // listeners on the same element (Tiptap registers multiple keydowns).
  window.addEventListener('keydown', onKeydown, { capture: true });
  window.addEventListener('click', onSendClick, { capture: true });

  return () => {
    window.removeEventListener('keydown', onKeydown, { capture: true } as AddEventListenerOptions);
    window.removeEventListener('click', onSendClick, { capture: true } as AddEventListenerOptions);
    activeSelectors = null;
  };
}

// Re-resolves the live composer text instead of trusting the cached
// activeSelectors.textarea. On claude.ai/chat/<id> the composer can be
// re-rendered between sends — the cached element ends up disconnected
// and either returns empty or stale text, which would either block the
// send (mismatch with approvedPrompt → preventDefault) or open a card
// for the wrong prompt. Reading live keeps the bypass honest.
function readLiveCompactText(): string {
  const candidates = [
    'div[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    'textarea[data-testid="composer"]',
    'textarea',
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el && el.isConnected) return readPrompt(el).trim();
  }
  return '';
}

function onSendAttempt(e: Event): void {
  console.group('[trailhead] onSendAttempt');
  try {
    // Our own programmatic dispatch (Path 3 in fireSendOnce) — let the event
    // through untouched so Claude.ai's own handler picks it up.
    if (bypassIntercept) {
      console.info('  → bypassIntercept set, letting event through');
      return;
    }
    // Popup-controlled coaching toggle: when the user has flipped Coaching
    // off, the chat behaves as if Trailhead weren't installed for sends —
    // EXCEPT for context injection, which is independent of coaching. If a
    // wiki context is active, we still preventDefault and re-fire after
    // augmenting the composer.
    if (!isCoachingEnabled()) {
      if (getCachedContextBundle() && activeSelectors) {
        console.info('  → coaching off but context active — injecting then re-firing');
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        bypassWithContextInjection();
      } else {
        console.info('  → coaching disabled, letting event through');
      }
      return;
    }
    if (!activeSelectors) {
      console.warn('  → activeSelectors null, letting event through');
      return;
    }
    // Read live, not from the (possibly stale) cached selector.
    const text = readLiveCompactText();
    console.info('  text:', text.slice(0, 60), '(len', text.length, ')');
    console.info('  approvedPrompt:', approvedPrompt ? approvedPrompt.slice(0, 60) : 'null');
    if (!text) {
      console.info('  → empty text, letting event through');
      return;
    }

    // Approved-prompt bypass: the user just clicked "Use this" or "I'm done"
    // in the Improve widget; the textarea content was approved by them.
    // The next native send should go straight through. We clear after one
    // hit so a later edit-and-resend resumes normal coaching.
    if (approvedPrompt && text === approvedPrompt.trim()) {
      console.info('  → text matches approved prompt — bypassing');
      approvedPrompt = null;
      // Same context-injection rule: if a context is active, intercept and
      // re-fire with augmented text so Claude.ai sees the team context.
      if (getCachedContextBundle()) {
        console.info('  → context active, injecting before re-fire');
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        bypassWithContextInjection();
      }
      return;
    }
    if (approvedPrompt) {
      console.warn('  → approved present but text MISMATCH; will intercept');
    }
    console.info('  → intercepting (preventDefault + runIntercept)');

  // We can't decide whether to send until we have a score. Block the
  // native send unconditionally; we'll re-fire it programmatically if
  // the user picks Send-as-is or Improve. stopImmediatePropagation also
  // blocks sibling listeners on the same element (Tiptap registers more
  // than one keydown, and Claude.ai's send button has its own onClick).
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();

    // Re-arm so the same composer state can be sent after this attempt.
    sentOnce = false;

    // Concurrent submits collapse: if a /score is already in flight for
    // an earlier Enter on the same prompt, the latest scoreAndShow will
    // abort the prior request via its own AbortController and supersede.
    if (inFlight) {
      console.info('  → another /score already in flight; collapsing');
      return;
    }
    inFlight = true;
    void runIntercept(text).finally(() => {
      inFlight = false;
    });
  } finally {
    console.groupEnd();
  }
}

async function runIntercept(text: string): Promise<void> {
  console.info('[trailhead] runIntercept: scoreAndShow', text.slice(0, 60));
  const res = await scoreAndShow(text);
  if (!res) {
    // scoreAndShow returned null — either the API call failed OR the
    // card couldn't even be mounted. Fail-open: try a programmatic send
    // so the user isn't stranded.
    console.warn('[trailhead] runIntercept: scoreAndShow null → triggerNativeSend (fail-open)');
    triggerNativeSend();
    return;
  }
  console.info('[trailhead] runIntercept: score', res.overall, '— card visible, awaiting user');
  // Always leave the card visible and let the user choose. The three
  // action buttons drive the next step:
  //   Improve   → openImproveChat()
  //   Send as-is → triggerNativeSend()
  //   Edit      → hideCard() + focusComposer()
  // No auto-send on high scores — every send is an explicit user choice.
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

// Re-resolve the send button at fire time. Claude.ai mounts the button
// lazily (only after the textarea has content), and on chat pages it
// gets re-rendered after navigation, so the cached `sel.sendButton`
// from attach time is often null or disconnected by now.
function findLiveSendButton(): HTMLElement | null {
  const candidates = [
    'button[aria-label="Send Message"]',
    'button[aria-label="Send message"]',
    'button[aria-label*="Send"]',
    'button[data-testid*="send"]',
    'fieldset button[type="submit"]',
    'button[type="submit"]',
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el instanceof HTMLElement && el.isConnected && !(el as HTMLButtonElement).disabled) {
      return el;
    }
  }
  return null;
}

function fireSendOnce(sel: Selectors): boolean {
  // Wrap every fire path in bypassIntercept so the click() / submit / Enter
  // we dispatch can't re-trigger our own capture-phase listeners. Without
  // this, path 1 (button click) would re-enter onSendAttempt, see the
  // (now context-augmented) text, and intercept again.
  bypassIntercept = true;
  try {
    // Path 1: programmatic click on the actual send button. `.click()`
    // produces an untrusted MouseEvent but Claude.ai's React onClick
    // handler still runs (only browser-action defaults like
    // `<a target=_blank>` need trust). Re-resolve fresh — the cached
    // one may be stale after SPA navigation.
    const liveButton = findLiveSendButton() ?? sel.sendButton;
    if (liveButton && liveButton.isConnected) {
      try {
        liveButton.click();
        return true;
      } catch {
        /* fall through */
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
    // Path 3: dispatch a synthetic Enter keydown on the textarea. Tiptap /
    // ProseMirror (claude.ai/chat) has no <form> and the send button can be
    // unmounted, so this is the last-resort path.
    try {
      sel.textarea.focus();
      const enter = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      });
      return sel.textarea.dispatchEvent(enter);
    } catch {
      return false;
    }
  } finally {
    bypassIntercept = false;
  }
}

// Sticky wiki context: the popup picker writes a node path to chrome.storage,
// context-bundle.ts fetches the subtree and renders it as a markdown blob,
// and we prepend that blob to the composer text right before firing the
// native send. The user's bare prompt is what /score sees (we forward
// context_path separately), so the score never gets inflated by the
// context bundle.
function maybePrependContextToComposer(sel: Selectors): boolean {
  const bundle = getCachedContextBundle();
  if (!bundle) return false;
  const bareText = readPrompt(sel.textarea);
  if (!bareText.trim()) return false;
  // Defensive — if a bypass path re-enters with already-augmented text we
  // don't want to nest <team_context> wrappers.
  if (bareText.startsWith('<team_context>')) return false;
  console.info('[trailhead] prepending context bundle (', bundle.length, 'chars) to composer');
  writePrompt(sel.textarea, `${bundle}\n\n${bareText}`);
  return true;
}

// Used by the bypass paths in onSendAttempt — when we want to let Claude.ai
// receive the prompt without our coaching, but we DO still want to inject
// the active context. preventDefault on the original event, augment, then
// fire programmatically.
function bypassWithContextInjection(): void {
  if (!activeSelectors) return;
  const sel = activeSelectors;
  void (async () => {
    maybePrependContextToComposer(sel);
    // Yield once so the editor's onChange sees the new content before we
    // fire the synthetic send.
    await Promise.resolve();
    fireSendOnce(sel);
  })();
}

async function doNativeSend(): Promise<void> {
  if (sentOnce) return;
  sentOnce = true;
  if (!activeSelectors) return;
  const sel = activeSelectors;
  // Capture the BARE text first — captures table should reflect what the
  // user actually wrote, not the (potentially huge) augmented blob we send
  // to Claude.ai. lastScoredText is the canonical source for the same
  // reason; this branch covers the fail-open fallback when scoring failed.
  const sentText = readPrompt(sel.textarea);
  hideCard();
  // Inject sticky context (if any) right before firing — covers the
  // fail-open path (scoreAndShow returned null) and keeps the user's
  // selected wiki subtree in front of every send.
  if (maybePrependContextToComposer(sel)) {
    // Yield once so the editor's onChange registers the augmented
    // content before fireSendOnce reads from it (form.requestSubmit
    // path) or before React's controlled-input round-trips.
    await Promise.resolve();
  }
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
