// The only content-script entry. Lifecycle (spec §5.1):
//   1. chrome.storage kill-switch check ('trailhead.disabled' === true → exit)
//   2. resolveSelectors(); on null, schedule a SELECTOR_RETRY_MS retry
//   3. inject styles
//   4. mount the score-card root and the live /score loop
//   5. attach send-intercept on the textarea + send button
//   6. start the MutationObserver on the message-list root
//   7. start the wiki-toast 2s poll loop
//
// Top-level safety net: window 'error' / 'unhandledrejection' swallow only
// errors that originate inside our extension (we tag our stack frames with
// TRAILHEAD_ERROR_TAG via the api.ts console.warn line). Anything else
// bubbles to Claude.ai's own handler (spec §6.5).
import { SELECTOR_RETRY_MS, TRAILHEAD_ERROR_TAG } from './config.ts';
import { classifyBubble, resolveSelectors, type Selectors } from './selectors.ts';
import { injectStyles } from './styles.ts';
import { attachScoreCard } from './score-card.ts';
import { attachSendIntercept } from './send-intercept.ts';
import { startWikiToastLoop } from './widgets/wiki-toast.ts';
import { initCoachingState } from './coaching-state.ts';
import { mountScoreBadge } from './widgets/score-badge.ts';
import { mountPromptDiff } from './widgets/prompt-diff.ts';
import {
  findPreviousUserBubble,
  mountOutcomeRating,
} from './widgets/outcome-rating.ts';

declare const chrome: typeof globalThis extends { chrome: infer C } ? C : any;

interface ChromeStorageLocalGet {
  (key: string): Promise<Record<string, unknown>>;
}

async function isDisabled(): Promise<boolean> {
  try {
    const get: ChromeStorageLocalGet | undefined = (chrome as any)?.storage?.local?.get;
    if (!get) return false;
    const out = await get.call((chrome as any).storage.local, 'trailhead.disabled');
    return Boolean(out['trailhead.disabled']);
  } catch {
    return false;
  }
}

function attachGlobalGuard(): void {
  const filter = (e: Event): boolean => {
    const msg = (e as ErrorEvent).error?.stack ?? (e as ErrorEvent).message ?? '';
    return typeof msg === 'string' && msg.includes(TRAILHEAD_ERROR_TAG);
  };
  window.addEventListener('error', (e) => {
    if (filter(e)) e.preventDefault();
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = (e as PromiseRejectionEvent).reason;
    const stack = (reason && reason.stack) || String(reason);
    if (typeof stack === 'string' && stack.includes(TRAILHEAD_ERROR_TAG)) {
      e.preventDefault();
    }
  });
}

function tagBubble(node: HTMLElement, role: 'user' | 'assistant'): void {
  node.dataset.trailheadBubble = role;
}

function walkBubblesIn(root: Node, sel: Selectors): void {
  if (!(root instanceof Element)) return;
  const candidates = root.matches('[data-trailhead-bubble], div, article, li')
    ? [root]
    : [];
  for (const node of candidates) {
    handleNode(node as HTMLElement, sel);
  }
  for (const node of root.querySelectorAll<HTMLElement>('div, article, li')) {
    handleNode(node, sel);
  }
}

function handleNode(node: HTMLElement, sel: Selectors): void {
  if (node.dataset.trailheadBubble) return;
  const role = classifyBubble(node);
  if (role === 'unknown') return;
  // Only the *outermost* matching element wins — once we tag a node as a
  // bubble its descendants will inherit and be skipped.
  for (let p: HTMLElement | null = node.parentElement; p; p = p.parentElement) {
    if (p.dataset.trailheadBubble) return;
  }
  tagBubble(node, role);
  try {
    if (role === 'user') {
      mountScoreBadge(node);
      mountPromptDiff(node);
    } else {
      mountOutcomeRating(node, findPreviousUserBubble(sel, node));
    }
  } catch (err) {
    console.warn(`${TRAILHEAD_ERROR_TAG} widget mount failed`, err);
  }
}

function startMutationObserver(sel: Selectors): MutationObserver {
  // Walk what's already there once.
  walkBubblesIn(sel.messageList, sel);
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof Element) walkBubblesIn(node, sel);
      }
    }
  });
  obs.observe(sel.messageList, { childList: true, subtree: true });
  return obs;
}

let started = false;
let activeSel: Selectors | null = null;
let detachers: Array<() => void> = [];
let observer: MutationObserver | null = null;
let healthTimer: number | null = null;

function detachAll(): void {
  for (const off of detachers) {
    try { off(); } catch { /* swallow */ }
  }
  detachers = [];
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  activeSel = null;
}

function isStillHealthy(): boolean {
  if (!activeSel) return false;
  return activeSel.textarea.isConnected && activeSel.messageList.isConnected;
}

function startHealthCheck(): void {
  if (healthTimer !== null) return;
  // Every 5s check if the textarea or message-list got torn down by an SPA
  // navigation; if so, detach and re-init. Cheap; runs only when we are
  // already mounted.
  healthTimer = window.setInterval(() => {
    if (!started) return;
    if (isStillHealthy()) return;
    console.info(`${TRAILHEAD_ERROR_TAG} dom torn down — re-initialising`);
    detachAll();
    started = false;
    tryStart();
  }, 5000);
}

function tryStart(): void {
  if (started) return;
  const sel = resolveSelectors();
  if (!sel) {
    console.warn(`${TRAILHEAD_ERROR_TAG} dom-mismatch — retrying`);
    setTimeout(tryStart, SELECTOR_RETRY_MS);
    return;
  }
  started = true;
  activeSel = sel;
  injectStyles();
  detachers.push(attachScoreCard(sel));
  detachers.push(attachSendIntercept(sel));
  observer = startMutationObserver(sel);
  detachers.push(startWikiToastLoop(sel));
  startHealthCheck();
  console.info(`${TRAILHEAD_ERROR_TAG} mounted on`, location.href);
}

async function main(): Promise<void> {
  if (await isDisabled()) {
    console.info(`${TRAILHEAD_ERROR_TAG} disabled via storage flag`);
    return;
  }
  // Subscribe to the coaching toggle so the popup switch takes effect
  // live — no page reload needed.
  initCoachingState();
  attachGlobalGuard();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryStart);
  } else {
    tryStart();
  }
}

void main();
