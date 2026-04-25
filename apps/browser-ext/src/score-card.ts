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
import type { ScoreResponse } from '@trailhead/shared';
import { score as apiScore } from './api.ts';
import { USER_ID } from './config.ts';
import { simpleHash } from './hash.ts';
import type { Selectors } from './selectors.ts';
import { store } from './store.ts';
import {
  augmentAndSend,
  focusComposer,
  rememberScoredPrompt,
  triggerNativeSend,
} from './send-intercept.ts';

const CARD_ID = 'trailhead-score-card';

let cardEl: HTMLDivElement | null = null;
let bodyEl: HTMLDivElement | null = null;
let actionsEl: HTMLDivElement | null = null;
let activeAbort: AbortController | null = null;

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
    void augmentAndSend();
  });

  const asIs = document.createElement('button');
  asIs.type = 'button';
  asIs.textContent = 'Send as-is';
  asIs.dataset.role = 'send-as-is';
  asIs.addEventListener('click', () => triggerNativeSend());

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
  const tree = renderScoreCard(res);
  bodyEl.replaceChildren(tree);
  cardEl.hidden = false;
  cardEl.dataset.bucket = bucketFor(res.overall);
  // Buttons appear for every result the user lands on; even at ≥7 the
  // intercept hides the card and fires native send before we get here,
  // so any visible card is a "you should consider improving" surface.
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
  if (!cardEl || !bodyEl) return null;
  const text = prompt.trim();
  if (!text) {
    hideCard();
    return null;
  }
  const hash = simpleHash(text);
  const cached = store.getScore(hash);
  if (cached) {
    const res: ScoreResponse = {
      overall: cached.overall,
      dimensions: cached.dimensions,
      missing: cached.missing,
    };
    rememberScoredPrompt(text);
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
  ensureCardMounted(sel);

  const onInput = (): void => {
    if (!cardEl || cardEl.hidden) return;
    hideCard();
  };

  sel.textarea.addEventListener('input', onInput);

  return () => {
    sel.textarea.removeEventListener('input', onInput);
    if (cardEl && cardEl.isConnected) cardEl.remove();
    cardEl = null;
    bodyEl = null;
    actionsEl = null;
    activeAbort?.abort();
    activeAbort = null;
  };
}
