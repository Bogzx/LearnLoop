# @trailhead/score-card

Pure DOM render function for the 5-dimension prompt score card. Used by the
browser extension (Claude.ai content script) and intended for the VS Code
webview (the inline render in `apps/vscode-ext/src/webview.ts` is the
extraction target — see spec §9 question 5).

## API

```ts
import { renderScoreCard, buildScoreCardModel, colorForScore } from '@trailhead/score-card';
```

- `renderScoreCard(scoreResponse)` → `HTMLElement` — theme-agnostic tree with
  `trailhead-sc-*` classes and `is-low/med/high` color modifiers
- `buildScoreCardModel(scoreResponse)` → pure data shape; what the tests cover
- `colorForScore(n)` → `'low' | 'med' | 'high'`

The caller owns the styles. See `apps/browser-ext/src/styles.ts` for the
canonical stylesheet.
