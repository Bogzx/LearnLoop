// The no-model provider behind TRAILHEAD_LLM=offline (see llm-mode.ts).
//
// Same exports and signatures as gemini.ts, so llm.ts can route every call to
// either. Nothing here is a language model and nothing pretends to be:
//
//   scoring             the rule-based scorer in packages/scoring
//   topic / path        keyword and regex matching
//   rewrites, tips,     '' — the /coach renderers already fall back to their
//   acknowledgements,   static per-dimension templates when the model returns
//   summaries           nothing (and a teammate's library prompt still shows)
//   /diff narrative     a template naming the dimension with the biggest gap
//   /improve            asks the static question for each weak dimension, then
//                       appends the answers to the prompt under their labels
//   rich bootstrap      unavailable (POST /onboard/repo/full answers 503)

import type { Dimension, DimensionScores, MissingHints } from '@trailhead/shared';
import { DIMENSIONS } from '@trailhead/shared';
import { DIMENSION_TEACH, heuristicScore } from '@trailhead/scoring';
import type { ImproveCoachInput, ImproveCoachOutput, ScoreModelResult } from './gemini.ts';
import { TOPIC_VALUES } from './gemini.ts';

export async function scorePrompt(args: {
  prompt: string;
  file_path?: string;
  team_context?: string;
}): Promise<ScoreModelResult> {
  // The team-context bundle can't calibrate a rule set; it is ignored here.
  return heuristicScore(args.prompt);
}

export async function rewriteForDims(_args: {
  prompt: string;
  target_dims: Dimension[];
  file_path?: string;
  team_context?: string;
}): Promise<{ rewritten_prompt: string; tip: string }> {
  return { rewritten_prompt: '', tip: '' };
}

export async function acknowledgeProgress(_args: {
  previous_prompt: string;
  current_prompt: string;
  previous_dimensions: DimensionScores;
  current_dimensions: DimensionScores;
}): Promise<string> {
  return '';
}

export async function summarizeCoaching(_args: {
  original_prompt: string;
  final_prompt: string;
  original_dimensions: DimensionScores;
  final_dimensions: DimensionScores;
  reason: 'success' | 'max_rounds' | 'no_progress' | 'skip';
}): Promise<string> {
  return '';
}

// First match wins, most specific topics first ("webhook retry" is a webhook
// prompt). Every value must be one of gemini.ts's TOPIC_VALUES.
const TOPIC_RULES: Array<[(typeof TOPIC_VALUES)[number], RegExp]> = [
  ['webhook', /\bwebhooks?\b/i],
  ['db_migration', /\bmigrat(?:e|ion|ions)\b|\balter table\b/i],
  ['retry', /\bretr(?:y|ies|ied|ying)\b|\bbackoff\b/i],
  ['auth', /\bauth\w*\b|\blog ?in\b|\bpasswords?\b|\bjwt\b|\boauth\b|\bsessions?\b|\btokens?\b/i],
  ['validation', /\bvalidat\w*\b|\bsanitiz\w*\b|\bschema validation\b/i],
  ['error_handling', /\berrors?\b|\bexceptions?\b|\btry\/catch\b|\bthrows?\b/i],
  ['logging', /\blog(?:s|ging|ger)?\b/i],
  ['testing', /\btests?\b|\bspecs?\b|\bunit test\w*\b|\bcoverage\b/i],
  ['deployment', /\bdeploy\w*\b|\bdocker\w*\b|\bkubernetes\b|\bci\b|\bpipelines?\b/i],
  ['performance', /\blatency\b|\bp9\d\b|\bslow\b|\bperformance\b|\bspeed\b|\boptimi[sz]\w*\b|\bcach(?:e|ing)\b/i],
  ['refactor', /\brefactor\w*\b|\bclean ?up\b|\bsplit\b|\bextract\b|\brename\b/i],
  ['schema', /\bschemas?\b|\binterfaces?\b|\btypes?\b|\bmodels?\b|\bcolumns?\b/i],
];

export async function extractTopic(prompt: string): Promise<string> {
  return TOPIC_RULES.find(([, re]) => re.test(prompt))?.[0] ?? 'other';
}

const PATH = /(?:^|[\s`'"(])((?:[\w.@-]+\/)+[\w.@-]*)/;

export async function extractPathAndTopic(
  prompt: string,
): Promise<{ path: string | null; topic: string | null }> {
  const topic = await extractTopic(prompt);
  return { path: prompt.match(PATH)?.[1] ?? null, topic: topic === 'other' ? null : topic };
}

export async function synthesizeDiff(args: {
  user_prompt: string;
  user_scores: DimensionScores;
  team_prompt: string;
  team_scores: DimensionScores;
}): Promise<string> {
  const [gap, d] = DIMENSIONS
    .map((dim) => [args.team_scores[dim] - args.user_scores[dim], dim] as const)
    .sort((a, b) => b[0] - a[0])[0]!;
  if (gap <= 0) return 'Your prompt scores at least as well as the team prompt on every dimension.';
  const t = DIMENSION_TEACH[d];
  return (
    `The biggest gap is ${t.title.toLowerCase()}: the team prompt scores ${args.team_scores[d]}/10 ` +
    `and yours ${args.user_scores[d]}/10. ${t.title} means: ${t.definition} ` +
    `Next time, answer this before sending: ${t.question}`
  );
}

const LABEL: Record<Dimension, string> = {
  goal_clarity: 'Goal',
  specificity: 'Change',
  context_loading: 'Context',
  constraint_articulation: 'Constraints',
  output_specification: 'Output',
};

export async function improveCoach(input: ImproveCoachInput): Promise<ImproveCoachOutput> {
  // Clients may omit the weak dimensions; then the rule-based score decides.
  const missing: MissingHints = Object.keys(input.missing).length ? input.missing : heuristicScore(input.original_prompt).missing;
  const weak = DIMENSIONS.filter((d) => d in missing);
  const answers = input.history.filter((t) => t.role === 'user').map((t) => t.text.trim());
  if (input.command === 'next' && answers.length < weak.length) {
    const d = weak[answers.length]!;
    const t = DIMENSION_TEACH[d];
    return { kind: 'question', text: `Tip: ${t.title} means: ${t.definition} ${t.question}` };
  }
  const added = weak
    .map((d, i) => (answers[i] ? `${LABEL[d]}: ${answers[i]}` : ''))
    .filter(Boolean);
  return {
    kind: 'final',
    polished: added.length ? `${input.original_prompt.trim()}\n\n${added.join('\n')}` : input.original_prompt.trim(),
    rationale: added.length
      ? `Added your answers for ${weak.slice(0, added.length).map((d) => LABEL[d].toLowerCase()).join(', ')} under their labels. ` +
        'Offline mode: no model rewrote the prompt.'
      : 'Offline mode: no model rewrote the prompt, and there were no answers to add.',
  };
}

export async function generateText(): Promise<string> {
  throw new Error('the rich wiki bootstrap needs an LLM (TRAILHEAD_LLM=offline)');
}
