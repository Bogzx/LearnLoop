// Pure render functions for the /coach pipeline. No I/O, no side effects.
//
// The /coach handler computes inputs (lowest dim, dim deltas, strong example
// source) and these helpers turn them into the user-facing text the LLM
// relays. Keep the wording in one place so iterating tone is a single-file
// change.
//
// Output format is GitHub-flavored markdown (tables, headers, code fences,
// emoji), tuned for Copilot Chat — VS Code's chat UI renders all of this
// natively. Claude Code TUI also renders the markdown subset.

import { DIMENSION_TEACH } from './teach-templates.mjs';

const DIMS = [
  'goal_clarity',
  'specificity',
  'context_loading',
  'constraint_articulation',
  'output_specification',
];

// Pretty labels for the dim table — underscores read poorly in chat output.
const DIM_LABEL = {
  goal_clarity:            'Goal clarity',
  specificity:             'Specificity',
  context_loading:         'Context loading',
  constraint_articulation: 'Constraint articulation',
  output_specification:    'Output specification',
};

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  return s.length <= n ? s : s.slice(0, Math.max(1, n - 3)) + '...';
}

// Render a multiline prompt as a single readable line for the success reveal.
// Hosts vary in how they format tool output: some preserve newlines, others
// (Gemini Antigravity as of 2026-04-26) escape them into literal \n which
// looks broken when echoed back inside quotes. Collapse to a separator so the
// before/after diff stays scannable regardless of host rendering.
function inlinePrompt(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/\s*\r?\n\s*/g, ' / ').trim();
}

function capitalizeFirst(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Traffic-light indicator. ≥7 = passing, 5-6 = soft, <5 = blocking. The 7
// threshold matches the /coach graduation gate so "all green" == "would
// graduate today".
function scoreEmoji(score) {
  if (score >= 7) return '🟢';
  if (score >= 5) return '🟡';
  return '🔴';
}

// Markdown table of all 5 dim scores. Optional `highlightDim` bolds the row
// the teach block is targeting so the reader sees which one is in focus.
// Used by all three render paths so the user always sees the full rubric.
function renderDimTable(dimensions, { highlightDim } = {}) {
  const rows = DIMS.map((d) => {
    const score = dimensions?.[d] ?? 0;
    const label = d === highlightDim ? `**${DIM_LABEL[d]}**` : DIM_LABEL[d];
    return `| ${label} | ${score}/10 | ${scoreEmoji(score)} |`;
  });
  return [
    '| Dimension | Score | |',
    '| --- | --- | --- |',
    ...rows,
  ].join('\n');
}

// Two-snapshot variant used by the success reveal. Same DIMS order; emoji
// reflects the AFTER score so the reader sees where the prompt landed.
function renderDimDeltaTable(originalDimensions, finalDimensions) {
  const rows = DIMS.map((d) => {
    const before = originalDimensions?.[d] ?? 0;
    const after = finalDimensions?.[d] ?? 0;
    const delta = after - before;
    const deltaStr = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '—';
    return `| ${DIM_LABEL[d]} | ${before}/10 | ${after}/10 | ${deltaStr} | ${scoreEmoji(after)} |`;
  });
  return [
    '| Dimension | Before | After | Δ | |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function dimensionDeltas(originalDimensions, finalDimensions) {
  return DIMS.map((d) => ({
    d,
    delta: (finalDimensions?.[d] ?? 0) - (originalDimensions?.[d] ?? 0),
    finalScore: finalDimensions?.[d] ?? 0,
    originalScore: originalDimensions?.[d] ?? 0,
  }));
}

function topImprovedDims(originalDimensions, finalDimensions, { minDelta = 2, take = 3 } = {}) {
  return dimensionDeltas(originalDimensions, finalDimensions)
    .filter((x) => x.delta >= minDelta)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, take);
}

// =============================================================================
// renderTeachBlock — round 1 (no `previousLowestDim`) or round 2+ when the
// lowest dim CHANGED (`previousLowestDim !== targetDim`). The pipeline does
// not call this for the "same lowest dim, no progress" case — that triggers
// renderSkipReveal instead.
// =============================================================================

export function renderTeachBlock({
  targetDim,
  targetScore,
  strongExample,
  previousLowestDim,
  acknowledgment,
  tip,
  dimensions,
  overall,
}) {
  const tpl = DIMENSION_TEACH[targetDim];
  if (!tpl) {
    return `Coach: cannot render block for unknown dimension "${targetDim}".`;
  }

  const lines = [];

  // Header banner with the overall score's emoji so the user gets a
  // single-glance read on where they are.
  if (typeof overall === 'number') {
    lines.push(`### ${scoreEmoji(overall)} Coach — overall ${overall}/10`);
    lines.push('');
  }

  // Always-on dim table. The dim being taught this round is bolded so the
  // user sees which row the rest of the block is talking about.
  if (dimensions) {
    lines.push(renderDimTable(dimensions, { highlightDim: targetDim }));
    lines.push('');
  }

  // Round 2+ acknowledgment of the user's last edit. Gemini-generated, so
  // it can specifically name what they added; falls back to the static
  // "You addressed X" line if the helper failed (empty string).
  if (acknowledgment && acknowledgment.trim()) {
    lines.push(`> ${acknowledgment.trim()}`);
    lines.push('');
  } else if (previousLowestDim && previousLowestDim !== targetDim) {
    const prevTpl = DIMENSION_TEACH[previousLowestDim];
    const prevLabel = prevTpl ? prevTpl.title.toLowerCase() : previousLowestDim.replace(/_/g, ' ');
    const nextLabel = capitalizeFirst(tpl.title.toLowerCase());
    lines.push(`> You addressed ${prevLabel}. ${nextLabel} is the next gap.`);
    lines.push('');
  }

  lines.push(`**${tpl.title}** (yours: ${targetScore}/10) — ${tpl.definition}`);
  lines.push('');
  lines.push(tpl.why);
  if (strongExample && strongExample.trim()) {
    lines.push('');
    lines.push('**Strong example:**');
    lines.push('```');
    lines.push(strongExample.trim());
    lines.push('```');
    if (tip && tip.trim()) {
      lines.push(`_Why it works: ${tip.trim()}_`);
    }
  }
  lines.push('');
  lines.push(`👉 ${tpl.question}`);
  return lines.join('\n');
}

// =============================================================================
// renderSuccessReveal — fires when round >= 2 AND overall >= 7, OR when the
// pipeline forcibly exits at COACH_MAX_ROUNDS (set `maxRoundsHit: true`).
// =============================================================================

export function renderSuccessReveal({
  originalPrompt,
  finalPrompt,
  originalOverall,
  finalOverall,
  originalDimensions,
  finalDimensions,
  maxRoundsHit,
  summary,
}) {
  const improved = topImprovedDims(originalDimensions, finalDimensions);
  const calloutLine = improved.length
    ? `**Improved on:** ${improved.map((x) => `${DIM_LABEL[x.d]} (+${x.delta})`).join(', ')}`
    : '_No dimension moved by 2+ — your final prompt was already fairly strong on most._';

  const headerEmoji = maxRoundsHit ? '⏱️' : '🎉';
  const headerSuffix = maxRoundsHit ? ' (max rounds reached)' : '';
  const header = `### ${headerEmoji} Coached ${originalOverall}/10 → ${finalOverall}/10${headerSuffix}`;

  const lines = [
    header,
    '',
    renderDimDeltaTable(originalDimensions, finalDimensions),
    '',
    '**Before:**',
    '```',
    truncate(inlinePrompt(originalPrompt), 200),
    '```',
    '**After:**',
    '```',
    truncate(inlinePrompt(finalPrompt), 400),
    '```',
    calloutLine,
  ];
  // Gemini-written closing recap. Fail-open: when the helper returned "",
  // the static block above is still informative on its own.
  if (summary && summary.trim()) {
    lines.push('');
    lines.push(summary.trim());
  }
  return lines.join('\n');
}

// =============================================================================
// renderSkipReveal — fires on `mode: 'skip_reveal'` AND on the no-progress
// early bail. `reason` distinguishes the two for the prefix wording.
//
// Hackathon simplification (per spec §9 open question): we list the dims
// that scored < 5 in the original ("Would have improved: …") instead of
// re-scoring the strong rewrite to compute a numeric delta. Saves a Gemini
// call. Wording stays informative.
// =============================================================================

export function renderSkipReveal({
  strongRewrite,
  originalDimensions,
  reason,
  noProgressDim,
  summary,
  overall,
}) {
  const wouldHaveImproved = DIMS.filter((d) => (originalDimensions?.[d] ?? 0) < 5);
  const calloutLine = wouldHaveImproved.length
    ? `**Would have improved:** ${wouldHaveImproved.map((d) => DIM_LABEL[d]).join(', ')}`
    : '';

  let prefix;
  if (reason === 'no_progress') {
    const dimLabel = noProgressDim
      ? (DIMENSION_TEACH[noProgressDim]?.title ?? noProgressDim.replace(/_/g, ' '))
      : 'the lowest dimension';
    prefix = `_Your last answer didn't move **${dimLabel}**. A stronger version of your prompt would have been:_`;
  } else {
    prefix = '_Proceeding with your original prompt. For next time, a stronger version would have been:_';
  }

  const headerEmoji = reason === 'no_progress' ? '⚠️' : '⏭️';
  const headerLabel = reason === 'no_progress' ? 'Coach — no progress' : 'Coach — skip acknowledged';
  const headerScore = typeof overall === 'number' ? ` (${overall}/10)` : '';

  const lines = [
    `### ${headerEmoji} ${headerLabel}${headerScore}`,
    '',
  ];
  if (originalDimensions) {
    lines.push(renderDimTable(originalDimensions, { highlightDim: noProgressDim }));
    lines.push('');
  }
  lines.push(prefix);
  lines.push('```');
  lines.push(inlinePrompt(strongRewrite ?? ''));
  lines.push('```');
  if (calloutLine) lines.push(calloutLine);
  // Same fail-open pattern as renderSuccessReveal — Gemini-written takeaway
  // appended after the templated arc, omitted on helper failure.
  if (summary && summary.trim()) {
    lines.push('');
    lines.push(summary.trim());
  }
  return lines.join('\n');
}
