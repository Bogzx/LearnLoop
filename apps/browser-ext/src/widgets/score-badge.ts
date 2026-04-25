// Widget A — score badge on every user bubble. Looks up store.getScore(hash)
// keyed by the bubble text. If we have a score, render a colored pill;
// click expands a 5-dim breakdown via @trailhead/score-card. Otherwise
// silent. No extra network call (spec §4.2).
import { renderScoreCard, colorForScore } from '@trailhead/score-card';
import { simpleHash } from '../hash.ts';
import { readBubbleText } from '../selectors.ts';
import { store } from '../store.ts';

export function mountScoreBadge(bubble: HTMLElement): void {
  if (bubble.dataset.trailheadBadge === '1') return;
  bubble.dataset.trailheadBadge = '1';

  const text = readBubbleText(bubble);
  if (!text) return;
  const hash = simpleHash(text);
  const entry = store.getScore(hash);
  if (!entry) return;

  const pill = document.createElement('span');
  pill.className = `trailhead-badge is-${colorForScore(entry.overall)}`;
  pill.dataset.role = 'score-badge';
  pill.textContent = `Score ${entry.overall}/10`;

  const tooltip = document.createElement('div');
  tooltip.className = 'trailhead-badge-tooltip';
  tooltip.hidden = true;
  tooltip.appendChild(
    renderScoreCard({
      overall: entry.overall,
      dimensions: entry.dimensions,
      missing: entry.missing,
    }),
  );

  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    tooltip.hidden = !tooltip.hidden;
  });

  bubble.prepend(pill);
  bubble.appendChild(tooltip);
}
