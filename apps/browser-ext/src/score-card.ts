// Score-card mount + the live-scoring loop. Owns the only DOM tree below
// the textarea (#trailhead-score-card) and the two action buttons. Send
// interception lives in send-intercept.ts but reads the same store entry.
//
// The loop (spec §5.2):
//   input → 250ms debounce → hash → dedup against store.lastHash
//        → abort prior /score → call api.score
//        → on success: store + render
//        → on null   : hide card (fail-open)
import { renderScoreCard } from '@trailhead/score-card';
import { score as apiScore } from './api.ts';
import { SCORE_DEBOUNCE_MS, USER_ID } from './config.ts';
import { simpleHash } from './hash.ts';
import { readPrompt, type Selectors } from './selectors.ts';
import { store } from './store.ts';
import { augmentAndSend, rememberScoredPrompt, triggerNativeSend } from './send-intercept.ts';

const CARD_ID = 'trailhead-score-card';

let cardEl: HTMLDivElement | null = null;
let bodyEl: HTMLDivElement | null = null;
let actionsEl: HTMLDivElement | null = null;
let pulseTimer: number | null = null;

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
  const asIs = document.createElement('button');
  asIs.type = 'button';
  asIs.textContent = 'Send as-is';
  asIs.dataset.role = 'send-as-is';
  asIs.addEventListener('click', () => triggerNativeSend());

  const clarify = document.createElement('button');
  clarify.type = 'button';
  clarify.className = 'is-primary';
  clarify.textContent = 'Have Claude clarify';
  clarify.dataset.role = 'clarify';
  clarify.addEventListener('click', () => augmentAndSend());

  actions.appendChild(asIs);
  actions.appendChild(clarify);
  card.appendChild(actions);

  // Anchor: just below the composer wrapper.
  const anchor = sel.scoreCardAnchor;
  anchor.insertAdjacentElement('afterend', card);

  cardEl = card;
  bodyEl = body;
  actionsEl = actions;
  return card;
}

function hide(): void {
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

export function pulseCard(durationMs: number): void {
  if (!cardEl) return;
  cardEl.classList.add('is-pulsing');
  if (pulseTimer !== null) clearTimeout(pulseTimer);
  pulseTimer = window.setTimeout(() => {
    cardEl?.classList.remove('is-pulsing');
    pulseTimer = null;
  }, durationMs);
}

export function getActionsEl(): HTMLDivElement | null {
  return actionsEl;
}

/** Best-effort hash for whatever is currently in the textarea. Used by
 * send-intercept to look up the most recent score (spec §5.3). */
export function currentPromptHash(sel: Selectors): string {
  return simpleHash(readPrompt(sel.textarea));
}

export function attachScoreCard(sel: Selectors): () => void {
  ensureCardMounted(sel);

  let debounceId: number | null = null;
  let activeAbort: AbortController | null = null;

  const onInput = (): void => {
    if (debounceId !== null) clearTimeout(debounceId);
    debounceId = window.setTimeout(runScore, SCORE_DEBOUNCE_MS);
  };

  async function runScore(): Promise<void> {
    if (!cardEl || !bodyEl) return;
    const text = readPrompt(sel.textarea).trim();
    if (!text) {
      hide();
      return;
    }
    const hash = simpleHash(text);
    if (hash === store.lastHash && store.getScore(hash)) {
      // Same prompt as last successful score — nothing to do.
      return;
    }
    store.setLastHash(hash);

    // Abort any prior /score initiated by *this* loop. api.ts also dedups
    // per-endpoint, but keeping a local handle lets us discard the response
    // if a faster keystroke supersedes it.
    if (activeAbort) activeAbort.abort();
    const ac = new AbortController();
    activeAbort = ac;

    const res = await apiScore({ prompt: text, user_id: USER_ID });
    if (ac.signal.aborted) return;
    if (!res) {
      hide();
      return;
    }
    store.setScore(hash, {
      overall: res.overall,
      dimensions: res.dimensions,
      missing: res.missing,
    });
    rememberScoredPrompt(text);

    // Re-render in place.
    const tree = renderScoreCard(res);
    bodyEl.replaceChildren(tree);
    cardEl.hidden = false;
    cardEl.dataset.bucket = bucketFor(res.overall);

    // Spec §6: ≥7 is the "no friction" path — power users see neither
    // border highlight (handled by [data-bucket="high"] CSS) nor the
    // action buttons. Buttons only matter below the threshold where
    // send-intercept has held the send and is offering a choice.
    if (actionsEl) actionsEl.hidden = res.overall >= 7;
  }

  sel.textarea.addEventListener('input', onInput);

  return () => {
    if (debounceId !== null) clearTimeout(debounceId);
    if (pulseTimer !== null) {
      clearTimeout(pulseTimer);
      pulseTimer = null;
    }
    sel.textarea.removeEventListener('input', onInput);
    if (cardEl && cardEl.isConnected) cardEl.remove();
    cardEl = null;
    bodyEl = null;
    actionsEl = null;
    activeAbort?.abort();
  };
}
