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
import { getTeamName, subscribeTeam } from '../team-state.ts';
import type { Selectors } from '../selectors.ts';

const PILL_ID = 'trailhead-context-pill';

let pillEl: HTMLDivElement | null = null;
let labelEl: HTMLSpanElement | null = null;
let unsubscribe: (() => void) | null = null;
let unsubscribeTeam: (() => void) | null = null;

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
  const pathLabel = path === '/' ? 'Root' : path;
  // Prepend the team's display name when available — disambiguates
  // ambiguous labels like "Root" across multiple projects. Falls back
  // to just the path when no team name has been cached yet (e.g.,
  // user is on the default demo team and never opened the team picker).
  const teamName = getTeamName();
  labelEl.textContent = teamName ? `${teamName} · ${pathLabel}` : pathLabel;
  pillEl.hidden = false;
}

// Position is now static (centered horizontally, bottom: 100px) — see
// styles.ts. No dynamic offset functions needed; CSS handles it.

export function mountContextPill(sel: Selectors): () => void {
  // Already mounted? (Re-init can fire during health-check recoveries.)
  // Detach the old node before rebuilding so we don't leave orphans in the DOM.
  if (pillEl && pillEl.isConnected) pillEl.remove();
  pillEl = buildPill();
  // Mount on body so Claude's React renderer can't sweep us away when it
  // reconciles the chat tree. The styles.ts rule for #trailhead-context-pill
  // sets position: fixed + top: 16px; the right offset is set inline below.
  document.body.appendChild(pillEl);
  refresh();
  // Position is fully static via CSS (centered horizontally, bottom: 100px)
  // — no resize observer or interval needed. `sel` is kept for API
  // compatibility with the mount call site.
  void sel;

  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeContext(refresh);
  if (unsubscribeTeam) unsubscribeTeam();
  unsubscribeTeam = subscribeTeam(refresh);

  return () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (unsubscribeTeam) {
      unsubscribeTeam();
      unsubscribeTeam = null;
    }
    if (pillEl && pillEl.isConnected) pillEl.remove();
    pillEl = null;
    labelEl = null;
  };
}
