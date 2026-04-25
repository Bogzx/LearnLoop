// Sticky reminder shown right above the composer whenever a wiki context
// is active. The user picked a node in the popup once; without a visual
// reminder, every send afterward silently inflates with the team context
// and they wouldn't know why their token usage jumped. The pill is the
// at-a-glance "yes, this is on" + a one-click escape hatch.
//
// Mounted as a sibling to the score-card so it lives inside the composer
// flow and follows it across SPA navigation. Subscribes to context-state
// so popup edits, team switches, and clears reflect live.

import { CONTEXT_PATH_KEY, getContextPath, subscribeContext } from '../context-state.ts';
import type { Selectors } from '../selectors.ts';

const PILL_ID = 'trailhead-context-pill';

let pillEl: HTMLDivElement | null = null;
let labelEl: HTMLSpanElement | null = null;
let unsubscribe: (() => void) | null = null;

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
  labelEl.textContent = path;
  pillEl.hidden = false;
}

export function mountContextPill(sel: Selectors): () => void {
  // Already mounted? (Re-init can fire during health-check recoveries.)
  // Detach the old node before rebuilding so we don't leave orphans in the DOM.
  if (pillEl && pillEl.isConnected) pillEl.remove();
  pillEl = buildPill();
  // Mount just before the score-card anchor — the pill sits at the top of
  // the composer area, above any score-card output.
  sel.scoreCardAnchor.insertAdjacentElement('beforebegin', pillEl);
  refresh();

  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeContext(refresh);

  return () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (pillEl && pillEl.isConnected) pillEl.remove();
    pillEl = null;
    labelEl = null;
  };
}
