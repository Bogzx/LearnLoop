// Widget D — wiki toasts. Polls /wiki/recent every WIKI_POLL_MS while the tab
// is visible (Page Visibility API) and surfaces a toast on:
//   - first sight of an item
//   - draft → durable transition
//   - reinforcement_count increment
// Toasts mount in a Trailhead-owned fixed-position container appended to
// document.body (Option β from spec §9.3). Mounting outside Claude.ai's
// React tree means reconciliation cannot tear our toasts down mid-animation.
// They auto-dismiss after TOAST_LIFETIME_MS or on click. Spec §4.5 / §5.5.
import {
  TOAST_LIFETIME_MS,
  WIKI_BACKOFF_MS,
  WIKI_FAILURE_THRESHOLD,
  WIKI_POLL_MS,
} from '../config.ts';
import { wikiRecent as apiWikiRecent } from '../api.ts';
import { store } from '../store.ts';
import type { Selectors } from '../selectors.ts';
import type { WikiRecentItem } from '@trailhead/shared';

const TOAST_STACK_ID = 'trailhead-toast-stack';

function ensureToastStack(): HTMLElement {
  let stack = document.getElementById(TOAST_STACK_ID);
  if (stack) return stack;
  stack = document.createElement('div');
  stack.id = TOAST_STACK_ID;
  document.body.appendChild(stack);
  return stack;
}

interface ToastInfo {
  kind: 'created' | 'reinforced' | 'promoted';
  text: string;
}

export function diffWikiItem(
  prev: WikiRecentItem | undefined,
  next: WikiRecentItem,
): ToastInfo | null {
  if (!prev) {
    return { kind: 'created', text: `Wiki created: «${next.body}»` };
  }
  if (next.status === 'durable' && prev.status === 'draft') {
    return { kind: 'promoted', text: `«${next.body}» — promoted to durable` };
  }
  if (next.reinforcement_count > prev.reinforcement_count) {
    return {
      kind: 'reinforced',
      text: `«${next.body}» — reinforced ${next.reinforcement_count}/3`,
    };
  }
  return null;
}

function showToast(info: ToastInfo): void {
  const stack = ensureToastStack();
  const el = document.createElement('div');
  el.className = `trailhead-toast${info.kind === 'promoted' ? ' is-promoted' : ''}`;
  el.dataset.role = 'wiki-toast';
  el.textContent = info.text;

  let dismissed = false;
  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    el.classList.add('is-leaving');
    // Wait the CSS animation duration (200ms) before removing the node so the
    // exit animation actually plays.
    window.setTimeout(() => el.remove(), 220);
  };
  el.addEventListener('click', dismiss);
  window.setTimeout(dismiss, TOAST_LIFETIME_MS);
  stack.appendChild(el);
}

function maxIso(items: readonly WikiRecentItem[], current: string): string {
  let best = current;
  for (const it of items) {
    if (it.last_seen_at > best) best = it.last_seen_at;
  }
  return best;
}

export function startWikiToastLoop(_sel: Selectors): () => void {
  let stopped = false;
  let consecutiveFailures = 0;
  let timer: number | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (document.visibilityState !== 'visible') {
      schedule(WIKI_POLL_MS);
      return;
    }
    const res = await apiWikiRecent(store.lastSeenIso);
    if (!res) {
      consecutiveFailures++;
      const next = consecutiveFailures >= WIKI_FAILURE_THRESHOLD ? WIKI_BACKOFF_MS : WIKI_POLL_MS;
      schedule(next);
      return;
    }
    consecutiveFailures = 0;
    for (const item of res.items) {
      const prev = store.getWikiItem(item.id);
      const info = diffWikiItem(prev, item);
      if (info) showToast(info);
      store.setWikiItem(item);
    }
    store.setLastSeenIso(maxIso(res.items, store.lastSeenIso));
    schedule(WIKI_POLL_MS);
  };

  const schedule = (ms: number): void => {
    if (stopped) return;
    timer = window.setTimeout(() => void tick(), ms);
  };

  void tick();

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    // Clear any toasts still on screen when the loop is detached (e.g. on
    // SPA re-init). The stack itself stays so animation keyframes are reused.
    const stack = document.getElementById(TOAST_STACK_ID);
    if (stack) stack.replaceChildren();
  };
}
