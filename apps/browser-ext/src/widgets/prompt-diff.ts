// Widget C — "Compare to team" link on every user bubble. Click → /diff,
// render an inline panel below the bubble: user prompt vs team prompt,
// score deltas, narrative. Re-clicks toggle the cached panel without a
// refetch (spec §4.4).
import { renderScoreCard } from '@trailhead/score-card';
import { diff as apiDiff } from '../api.ts';
import { USER_ID } from '../config.ts';
import { parseDiffResponse } from '../diff-parse.ts';
import { simpleHash } from '../hash.ts';
import { readBubbleText } from '../selectors.ts';
import { store } from '../store.ts';

export function mountPromptDiff(bubble: HTMLElement): void {
  if (bubble.dataset.trailheadDiff === '1') return;
  bubble.dataset.trailheadDiff = '1';

  const text = readBubbleText(bubble);
  if (!text) return;
  const hash = simpleHash(text);

  const link = document.createElement('span');
  link.className = 'trailhead-diff-link';
  link.textContent = 'Compare to team';
  link.dataset.role = 'prompt-diff-link';

  const panel = document.createElement('div');
  panel.className = 'trailhead-diff-panel';
  panel.hidden = true;

  let loading = false;

  const renderPanel = (parsed: ReturnType<typeof parseDiffResponse>): void => {
    panel.replaceChildren();
    if (!parsed) {
      const err = document.createElement('div');
      err.className = 'trailhead-diff-error';
      err.textContent = "Couldn't reach the team comparison — try again.";
      panel.appendChild(err);
      return;
    }
    const cols = document.createElement('div');
    cols.className = 'trailhead-diff-cols';

    const yours = document.createElement('div');
    yours.className = 'trailhead-diff-col';
    const yoursH = document.createElement('h4');
    yoursH.textContent = `Yours · ${parsed.user.overall}/10`;
    const yoursP = document.createElement('div');
    yoursP.className = 'trailhead-diff-prompt';
    yoursP.textContent = parsed.user.prompt;
    yours.appendChild(yoursH);
    yours.appendChild(yoursP);
    yours.appendChild(
      renderScoreCard({
        overall: parsed.user.overall,
        dimensions: parsed.user.dimensions,
        missing: {},
      }),
    );

    const team = document.createElement('div');
    team.className = 'trailhead-diff-col';
    const teamH = document.createElement('h4');
    teamH.textContent = `Team · ${parsed.team.overall}/10 @ ${parsed.team.node_path}${parsed.team.topic ? ` · ${parsed.team.topic}` : ''}`;
    const teamP = document.createElement('div');
    teamP.className = 'trailhead-diff-prompt';
    teamP.textContent = parsed.team.prompt;
    team.appendChild(teamH);
    team.appendChild(teamP);
    team.appendChild(
      renderScoreCard({
        overall: parsed.team.overall,
        dimensions: parsed.team.dimensions,
        missing: {},
      }),
    );

    cols.appendChild(yours);
    cols.appendChild(team);
    panel.appendChild(cols);

    if (parsed.narrative) {
      const narrative = document.createElement('div');
      narrative.className = 'trailhead-diff-narrative';
      narrative.textContent = parsed.narrative;
      panel.appendChild(narrative);
    }
  };

  link.addEventListener('click', async (e) => {
    e.stopPropagation();
    const cached = store.getDiff(hash);
    if (cached) {
      panel.hidden = !panel.hidden;
      if (!panel.hidden && panel.childElementCount === 0) {
        renderPanel(parseDiffResponse(cached.data));
      }
      return;
    }
    if (loading) return;
    loading = true;
    panel.hidden = false;
    panel.replaceChildren();
    const placeholder = document.createElement('div');
    placeholder.className = 'trailhead-diff-error';
    placeholder.textContent = 'Comparing…';
    panel.appendChild(placeholder);

    const res = await apiDiff({ user_prompt: text, user_id: USER_ID });
    loading = false;
    if (res) store.setDiff(hash, { data: res });
    renderPanel(parseDiffResponse(res));
  });

  bubble.appendChild(link);
  bubble.appendChild(panel);
}
