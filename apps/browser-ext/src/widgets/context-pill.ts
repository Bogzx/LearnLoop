// Sticky reminder shown at the top-right of Claude.ai's chat column whenever
// a wiki context is active. The user picked a node in the popup once;
// without a visual reminder, every send afterward silently inflates with
// the team context and they wouldn't know why their token usage jumped.
// The pill is the at-a-glance "yes, this is on" + a one-click escape hatch.
//
// Mounted on document.body with `position: fixed` so Claude's React
// reconciliation cannot tear it down. The right offset is computed from
// the composer's bounding rect — its right edge is the most reliable proxy
// for the visible chat column's right edge across Claude.ai's varying
// layouts (sidebar open vs. closed, narrow vs. wide window). A
// ResizeObserver on the composer keeps the offset accurate as the user
// resizes the window or toggles the sidebar.

import { CONTEXT_PATH_KEY, getContextPath, subscribeContext } from '../context-state.ts';
import type { Selectors } from '../selectors.ts';

const PILL_ID = 'trailhead-context-pill';

let pillEl: HTMLDivElement | null = null;
let labelEl: HTMLSpanElement | null = null;
let unsubscribe: (() => void) | null = null;
let resizeObs: ResizeObserver | null = null;
let onWindowResize: (() => void) | null = null;

function buildPill(): HTMLDivElement {
  const pill = document.createElement('div');
  pill.id = PILL_ID;
  pill.hidden = true;

  const icon = document.createElement('span');
  icon.className = 'trailhead-context-pill-icon';
  icon.textContent = '📎';
  pill.appendChild(icon);

  const prefix = document.createElement('span');
  prefix.className = 'trailhead-context-pill-prefix';
  prefix.textContent = 'Context: ';
  pill.appendChild(prefix);

  const label = document.createElement('span');
  label.className = 'trailhead-context-pill-label';
  pill.appendChild(label);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'trailhead-context-pill-clear';
  clear.textContent = '✕';
  clear.title = 'Clear active context';
  clear.addEventListener('click', () => {
    try {
      (chrome as any).storage.local.remove(CONTEXT_PATH_KEY);
    } catch {
      /* swallow — chrome.* unavailable */
    }
  });
  pill.appendChild(clear);

  labelEl = label;
  return pill;
}

function refresh(): void {
  if (!pillEl || !labelEl) return;
  const path = getContextPath();
  if (!path) {
    pillEl.hidden = true;
    return;
  }
  // Root-context sentinel: the popup persists '/' for the repo-root node
  // (its real wiki path is the empty string, which clashes with our
  // truthy "is context active?" check). Render it as "Root" so the pill
  // doesn't show a bare slash.
  labelEl.textContent = path === '/' ? 'Root' : path;
  pillEl.hidden = false;
}

// Align the pill's right edge with the composer's right edge (with a small
// 8px inset). Composer width === visible chat column width on every
// Claude.ai layout we've seen, so this anchors the pill to the chat without
// hard-coding any selector for the column itself.
function updateRightOffset(sel: Selectors): void {
  if (!pillEl) return;
  const composer = sel.scoreCardAnchor;
  const rect = composer?.getBoundingClientRect();
  if (!rect || rect.width === 0) {
    // Composer not measurable yet (detached / display:none) — fall back to
    // the page's right edge so the pill is still visible.
    pillEl.style.right = '16px';
    return;
  }
  const offset = Math.max(8, Math.round(window.innerWidth - rect.right + 8));
  pillEl.style.right = `${offset}px`;
}

export function mountContextPill(sel: Selectors): () => void {
  // Already mounted? (Re-init can fire during health-check recoveries.)
  // Detach the old node before rebuilding so we don't leave orphans in the DOM.
  if (pillEl && pillEl.isConnected) pillEl.remove();
  pillEl = buildPill();
  // Mount on body so Claude's React renderer can't sweep us away when it
  // reconciles the chat tree. The styles.ts rule for #trailhead-context-pill
  // sets position: fixed + top: 16px; the right offset is set inline below.
  document.body.appendChild(pillEl);
  updateRightOffset(sel);
  refresh();

  // Keep the right offset accurate when:
  // - The user resizes the browser window.
  // - Claude rearranges its layout (sidebar collapse, model switcher
  //   expand/collapse) — the composer's bounding rect changes accordingly.
  onWindowResize = () => updateRightOffset(sel);
  window.addEventListener('resize', onWindowResize);
  if (resizeObs) resizeObs.disconnect();
  resizeObs = new ResizeObserver(() => updateRightOffset(sel));
  if (sel.scoreCardAnchor) resizeObs.observe(sel.scoreCardAnchor);

  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeContext(refresh);

  return () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (resizeObs) {
      resizeObs.disconnect();
      resizeObs = null;
    }
    if (onWindowResize) {
      window.removeEventListener('resize', onWindowResize);
      onWindowResize = null;
    }
    if (pillEl && pillEl.isConnected) pillEl.remove();
    pillEl = null;
    labelEl = null;
  };
}
