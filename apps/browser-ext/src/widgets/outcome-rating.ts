// Widget B — outcome rating chips beneath every assistant bubble. Click
// records via /capture (surface='browser'), then collapses the chips to a
// "Recorded" pill. On null response (fail-open) the chips revert to
// clickable (spec §6.1).
import { capture as apiCapture } from '../api.ts';
import { USER_ID } from '../config.ts';
import { simpleHash } from '../hash.ts';
import { readBubbleText, type Selectors } from '../selectors.ts';
import { store } from '../store.ts';
import type { Outcome } from '@trailhead/shared';

interface ChipDef {
  outcome: Outcome;
  label: string;
}
const CHIPS: readonly ChipDef[] = [
  { outcome: 'helpful', label: '👍 Helpful' },
  { outcome: 'mixed', label: '🤷 Mixed' },
  { outcome: 'not', label: '👎 Not' },
];

export function mountOutcomeRating(
  bubble: HTMLElement,
  prevUserBubble: HTMLElement | null,
): void {
  if (bubble.dataset.trailheadOutcome === '1') return;
  bubble.dataset.trailheadOutcome = '1';

  const ai = readBubbleText(bubble);
  if (!ai) return;

  const root = document.createElement('div');
  root.className = 'trailhead-outcome';
  root.dataset.role = 'outcome-rating';

  const renderChips = (): void => {
    root.replaceChildren();
    for (const def of CHIPS) {
      const chip = document.createElement('span');
      chip.className = 'trailhead-outcome-chip';
      chip.textContent = def.label;
      chip.addEventListener('click', () => onClick(def.outcome));
      root.appendChild(chip);
    }
  };

  const onClick = async (outcome: Outcome): Promise<void> => {
    // Optimistically swap to recorded pill so the user sees response even
    // if /capture is slow.
    const userPrompt = prevUserBubble ? readBubbleText(prevUserBubble) : '';
    const hash = userPrompt ? simpleHash(userPrompt) : '';
    const entry = hash ? store.getScore(hash) : undefined;

    root.replaceChildren();
    const recorded = document.createElement('span');
    recorded.className = 'trailhead-outcome-recorded';
    recorded.textContent = 'Recorded';
    root.appendChild(recorded);

    const res = await apiCapture({
      surface: 'browser',
      user_prompt: userPrompt || ai,
      ai_response: ai,
      outcome,
      scored_dimensions: entry?.dimensions,
      user_id: USER_ID,
    });
    if (!res) {
      // fail-open: revert to chips so the user can retry
      renderChips();
    } else if (hash) {
      store.setCaptureId(hash, res.id);
    }
  };

  renderChips();
  bubble.appendChild(root);
}

/** Walk back through `messageList`'s direct children to find the most recent
 * user bubble preceding `bubble`. Used for the user_prompt field on /capture. */
export function findPreviousUserBubble(
  sel: Selectors,
  bubble: HTMLElement,
): HTMLElement | null {
  let cur: Element | null = bubble.previousElementSibling;
  while (cur) {
    if (cur instanceof HTMLElement && cur.dataset.trailheadBubble === 'user') {
      return cur;
    }
    cur = cur.previousElementSibling;
  }
  // Fallback: search the entire message list for the last user bubble before
  // this one (sibling order isn't guaranteed across Claude.ai layouts).
  const all = sel.messageList.querySelectorAll<HTMLElement>('[data-trailhead-bubble="user"]');
  let last: HTMLElement | null = null;
  for (const el of all) {
    if (el === bubble) break;
    last = el;
  }
  return last;
}
