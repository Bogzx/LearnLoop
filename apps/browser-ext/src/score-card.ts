// Score-card mount + the on-submit scoring flow. Owns the only DOM tree
// below the textarea (#trailhead-score-card) and the three action buttons.
// Send interception lives in send-intercept.ts and drives this card.
//
// Architecture (post-2026-04-25 rewrite — keystroke debounce removed):
//   user hits Enter / clicks send
//        ↓ send-intercept.preventDefault
//        ↓ scoreAndShow(prompt)
//             ↓ cache hit?  → show card immediately
//             ↓ cache miss? → show "scoring…" placeholder
//                              → POST /score
//                              → render breakdown
//        ↓ overall ≥ 7  → hideCard + triggerNativeSend (no friction)
//        ↓ overall < 7  → card stays visible with three buttons; user
//                          picks Improve / Send as-is / Edit
//
// We do NOT score on every keystroke. Doing so caused the 2026-04-25
// repetition-loop incident (the volume of vague-fragment scoring is what
// turned a single bad model output into a 32K-token cost spike), and it
// scored half-formed thoughts as if they were final drafts. Scoring at
// the submit decision-point is both cheaper and more pedagogically
// honest — we coach committed prompts, not typing fragments.
import { renderScoreCard } from '@trailhead/score-card';
import type { MissingHints, ScoreResponse } from '@trailhead/shared';
import { score as apiScore } from './api.ts';
import { USER_ID } from './config.ts';
import { simpleHash } from './hash.ts';
import { readPrompt, type Selectors } from './selectors.ts';
import { store } from './store.ts';
import {
  focusComposer,
  markApproved,
  rememberScoredPrompt,
} from './send-intercept.ts';
import { openImproveChat } from './widgets/improve-chat.ts';

const CARD_ID = 'trailhead-score-card';

let cardEl: HTMLDivElement | null = null;
let bodyEl: HTMLDivElement | null = null;
let actionsEl: HTMLDivElement | null = null;
let activeAbort: AbortController | null = null;
// Tracks the latest score's missing hints so the Improve widget can pass
// them to /improve. Updated on every showResult().
let lastMissing: MissingHints = {};
// Tracks the prompt that was most recently scored so the Improve widget
// can use it as the conversation seed instead of re-reading the textarea
// (which augmentAndSend may have already mutated).
let lastPrompt = '';
// Cached selectors so scoreAndShow can lazy-rebuild the card after the
// Improve widget has called resetCard. Without this, the next send
// after an "I'm done" click would early-return null (cardEl gone) and
// fail the user.
let lastSel: Selectors | null = null;

function ensureCardMounted(sel: Selectors): HTMLDivElement {
  if (cardEl && cardEl.isConnected) return cardEl;
  const card = document.createElement('div');
  card.id = CARD_ID;
  card.hidden = true;

  const body = document.createElement('div');
  body.id = 'trailhead-score-card-body';
  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'trailhead-actions';

  const improve = document.createElement('button');
  improve.type = 'button';
  improve.className = 'is-primary';
  improve.textContent = 'Improve';
  improve.dataset.role = 'clarify';
  improve.addEventListener('click', () => {
    const prompt = lastPrompt || readPrompt(sel.textarea).trim();
    if (!prompt) return;
    openImproveChat(sel, prompt, lastMissing);
  });

  const asIs = document.createElement('button');
  asIs.type = 'button';
  asIs.textContent = 'Keep as-is';
  asIs.dataset.role = 'keep-as-is';
  asIs.title = 'Close the card and use the prompt I already typed. Hit Enter to send.';
  asIs.addEventListener('click', () => {
    const prompt = lastPrompt || readPrompt(sel.textarea).trim();
    if (!prompt) {
      hideCard();
      return;
    }
    console.info('[trailhead] Keep as-is clicked — marking approved, hiding card');
    markApproved(prompt);
    hideCard();
    focusComposer();
  });

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.textContent = 'Edit';
  edit.dataset.role = 'edit';
  edit.addEventListener('click', () => {
    hideCard();
    focusComposer();
  });

  actions.appendChild(improve);
  actions.appendChild(asIs);
  actions.appendChild(edit);
  card.appendChild(actions);

  // Anchor: just below the composer wrapper.
  const anchor = sel.scoreCardAnchor;
  anchor.insertAdjacentElement('afterend', card);

  cardEl = card;
  bodyEl = body;
  actionsEl = actions;
  return card;
}

export function hideCard(): void {
  if (!cardEl) return;
  cardEl.hidden = true;
  cardEl.removeAttribute('data-bucket');
  if (bodyEl) bodyEl.replaceChildren();
  if (actionsEl) actionsEl.hidden = true;
}

// Tears the card all the way down — used when something else has
// repurposed the card's children (the Improve widget wipes them) so the
// stale bodyEl/actionsEl references must be cleared. Next scoreAndShow
// triggers ensureCardMounted to rebuild a fresh card from scratch.
export function resetCard(): void {
  console.info('[trailhead] resetCard: removing cardEl, nulling refs');
  if (cardEl) {
    cardEl.remove();
    cardEl = null;
  }
  bodyEl = null;
  actionsEl = null;
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
}

function bucketFor(overall: number): 'low' | 'med' | 'high' {
  if (overall >= 7) return 'high';
  if (overall >= 4) return 'med';
  return 'low';
}

function showLoading(): void {
  if (!cardEl || !bodyEl || !actionsEl) return;
  bodyEl.replaceChildren();
  const placeholder = document.createElement('div');
  placeholder.className = 'trailhead-loading';
  placeholder.textContent = 'Scoring…';
  bodyEl.appendChild(placeholder);
  actionsEl.hidden = true;
  cardEl.removeAttribute('data-bucket');
  cardEl.hidden = false;
}

function showResult(res: ScoreResponse): void {
  if (!cardEl || !bodyEl || !actionsEl) return;
  lastMissing = res.missing ?? {};
  const tree = renderScoreCard(res);
  bodyEl.replaceChildren(tree);
  cardEl.hidden = false;
  cardEl.dataset.bucket = bucketFor(res.overall);
  // Buttons appear for every result the user lands on; the Improve flow
  // now opens an in-card chat widget instead of auto-sending, so the
  // card is always a "you choose what happens next" surface.
  actionsEl.hidden = false;
}

/**
 * Score the given prompt and render the card. Returns the score so the
 * caller (send-intercept) can decide whether to short-circuit to a
 * native send (≥7) or wait for a user choice (<7). On API failure
 * returns null and hides the card; the caller's contract is fail-open
 * (send the prompt unchanged).
 *
 * Cache hit shortcut: a previously-seen identical prompt renders
 * instantly with no network call. This is what makes double-Enter and
 * "Send as-is after a brief Edit-then-resubmit" feel snappy.
 */
export async function scoreAndShow(prompt: string): Promise<ScoreResponse | null> {
  // Lazy re-mount: if the Improve widget called resetCard last time
  // through, cardEl is null. Rebuild it now using the cached selectors
  // from attachScoreCard so the card surface is always available when a
  // send is intercepted.
  if ((!cardEl || !cardEl.isConnected) && lastSel) {
    console.info('[trailhead] scoreAndShow: rebuilding card (cardEl was null/disconnected)');
    ensureCardMounted(lastSel);
  }
  if (!cardEl || !bodyEl) {
    console.warn('[trailhead] scoreAndShow: no cardEl/bodyEl after lazy mount — aborting');
    return null;
  }
  const text = prompt.trim();
  if (!text) {
    hideCard();
    return null;
  }
  console.info('[trailhead] scoreAndShow:', text.slice(0, 60));
  const hash = simpleHash(text);
  const cached = store.getScore(hash);
  if (cached) {
    const res: ScoreResponse = {
      overall: cached.overall,
      dimensions: cached.dimensions,
      missing: cached.missing,
    };
    rememberScoredPrompt(text);
    lastPrompt = text;
    showResult(res);
    return res;
  }

  // Abort any in-flight prior /score (the SDK also dedups per-endpoint
  // on api.ts, but a local handle lets us discard a stale response if
  // a faster resubmit supersedes it).
  if (activeAbort) activeAbort.abort();
  const ac = new AbortController();
  activeAbort = ac;

  showLoading();
  const res = await apiScore({ prompt: text, user_id: USER_ID });
  if (ac.signal.aborted) return null;
  if (!res) {
    hideCard();
    return null;
  }
  store.setScore(hash, {
    overall: res.overall,
    dimensions: res.dimensions,
    missing: res.missing,
  });
  store.setLastHash(hash);
  rememberScoredPrompt(text);
  showResult(res);
  return res;
}

/**
 * Mount the card DOM and wire a passive input listener that hides the
 * card when the user starts editing. We do NOT score on input; the
 * listener exists only so a stale score doesn't sit on screen while the
 * user types a different prompt.
 */
export function attachScoreCard(sel: Selectors): () => void {
  lastSel = sel;
  ensureCardMounted(sel);

  const onInput = (): void => {
    if (!cardEl || cardEl.hidden) return;
    hideCard();
  };

  sel.textarea.addEventListener('input', onInput);

  return () => {
    lastSel = null;
    sel.textarea.removeEventListener('input', onInput);
    if (cardEl && cardEl.isConnected) cardEl.remove();
    cardEl = null;
    bodyEl = null;
    actionsEl = null;
    activeAbort?.abort();
    activeAbort = null;
  };
}
