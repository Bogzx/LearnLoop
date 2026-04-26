// Pure render functions for the /coach pipeline. No I/O, no side effects.
//
// The /coach handler computes inputs (lowest dim, dim deltas, strong example
// source) and these helpers turn them into the user-facing text the LLM
// relays. Keep the wording in one place so iterating tone is a single-file
// change.

import { DIMENSION_TEACH } from './teach-templates.mjs';

const DIMS = [
  'goal_clarity',
  'specificity',
  'context_loading',
  'constraint_articulation',
  'output_specification',
];

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  return s.length <= n ? s : s.slice(0, Math.max(1, n - 3)) + '...';
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
}) {
  const tpl = DIMENSION_TEACH[targetDim];
  if (!tpl) {
    return `Coach: cannot render block for unknown dimension "${targetDim}".`;
  }

  const lines = [];
  // Round 2+ acknowledgment of the user's last edit. Gemini-generated, so
  // it can specifically name what they added; falls back to the static
  // "You addressed X" line if the helper failed (empty string).
  if (acknowledgment && acknowledgment.trim()) {
    lines.push(acknowledgment.trim());
    lines.push('');
  } else if (previousLowestDim && previousLowestDim !== targetDim) {
    const prevTpl = DIMENSION_TEACH[previousLowestDim];
    const prevLabel = prevTpl ? prevTpl.title.toLowerCase() : previousLowestDim.replace(/_/g, ' ');
    lines.push(`You addressed ${prevLabel}. ${tpl.title.toLowerCase()} is the next gap.`);
    lines.push('');
  }

  lines.push(`${tpl.title} (yours: ${targetScore}/10) — ${tpl.definition}`);
  lines.push(tpl.why);
  if (strongExample && strongExample.trim()) {
    lines.push('');
    lines.push(`Strong example: "${strongExample.trim()}"`);
    if (tip && tip.trim()) {
      lines.push(`Why it works: ${tip.trim()}`);
    }
  }
  lines.push('');
  lines.push(tpl.question);
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
    ? `Improved on: ${improved.map((x) => `${x.d} (+${x.delta})`).join(', ')}`
    : 'No dimension moved by 2+ — your final prompt was already fairly strong on most.';

  const header = maxRoundsHit
    ? `(coached: ${originalOverall} → ${finalOverall}, max rounds reached)`
    : `(coached: ${originalOverall} → ${finalOverall})`;

  const lines = [
    header,
    'Your prompt grew:',
    `  "${truncate(originalPrompt, 80)}"`,
    '  →',
    `  "${truncate(finalPrompt, 200)}"`,
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
}) {
  const wouldHaveImproved = DIMS.filter((d) => (originalDimensions?.[d] ?? 0) < 5);
  const calloutLine = wouldHaveImproved.length
    ? `Would have improved: ${wouldHaveImproved.join(', ')}`
    : '';

  let prefix;
  if (reason === 'no_progress') {
    const dimLabel = noProgressDim
      ? (DIMENSION_TEACH[noProgressDim]?.title.toLowerCase() ?? noProgressDim.replace(/_/g, ' '))
      : 'the lowest dimension';
    prefix = `Your last answer didn't move ${dimLabel}. A stronger version of your prompt would have been:`;
  } else {
    prefix = 'Proceeding with your original prompt. For next time, a stronger version would have been:';
  }

  const lines = [prefix, `  "${(strongRewrite ?? '').trim()}"`];
  if (calloutLine) lines.push(calloutLine);
  // Same fail-open pattern as renderSuccessReveal — Gemini-written takeaway
  // appended after the templated arc, omitted on helper failure.
  if (summary && summary.trim()) {
    lines.push('');
    lines.push(summary.trim());
  }
  return lines.join('\n');
}
