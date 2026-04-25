// DOM mapper for the score card. Theme-agnostic: every node carries a
// `trailhead-sc-*` class and every color bucket carries a `is-low/med/high`
// modifier so consumers (browser-ext content script, VS Code webview) can
// style independently. The pure model lives in render-pure.ts so the tests
// don't need a DOM.
import type { ScoreResponse } from '@trailhead/shared';
import { buildScoreCardModel } from './render-pure.ts';

export interface RenderScoreCardOptions {
  /** Class prefix; default 'trailhead-sc'. */
  classPrefix?: string;
  /** Override document for non-browser hosts (rare; mostly for tests). */
  doc?: Document;
}

export function renderScoreCard(
  res: ScoreResponse,
  opts: RenderScoreCardOptions = {},
): HTMLElement {
  const prefix = opts.classPrefix ?? 'trailhead-sc';
  const doc = opts.doc ?? document;
  const model = buildScoreCardModel(res);

  const root = doc.createElement('div');
  root.className = `${prefix}-root`;
  root.setAttribute('data-testid', 'score-card-root');

  const head = doc.createElement('div');
  head.className = `${prefix}-overall is-${model.overallColor}`;
  head.setAttribute('data-testid', 'score-card-overall');
  head.textContent = `Score ${model.overall}/10`;
  root.appendChild(head);

  const list = doc.createElement('div');
  list.className = `${prefix}-rows`;

  for (const row of model.rows) {
    const r = doc.createElement('div');
    r.className = `${prefix}-row is-${row.color}`;
    r.setAttribute('data-dimension', row.dimension);

    const icon = doc.createElement('span');
    icon.className = `${prefix}-icon ${row.ok ? 'is-ok' : 'is-bad'}`;
    icon.textContent = row.ok ? '✓' : '✗';
    r.appendChild(icon);

    const name = doc.createElement('span');
    name.className = `${prefix}-name`;
    name.textContent = row.label;
    r.appendChild(name);

    const score = doc.createElement('span');
    score.className = `${prefix}-score`;
    score.textContent = String(row.score);
    r.appendChild(score);

    list.appendChild(r);

    if (row.hint) {
      const hint = doc.createElement('div');
      hint.className = `${prefix}-hint`;
      hint.textContent = `— ${row.hint}`;
      list.appendChild(hint);
    }
  }

  root.appendChild(list);
  return root;
}
