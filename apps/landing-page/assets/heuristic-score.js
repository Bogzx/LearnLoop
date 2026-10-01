// Rule-based scorer for the 5-dimension rubric in score-prompt.mjs.
//
// What it is for:
//   - the offline LLM provider (TRAILHEAD_LLM=offline in apps/api), so the
//     stack runs and coaches with no API key;
//   - the in-browser demo on the landing page (apps/landing-page/assets keeps a
//     byte-identical copy: no imports, no Node APIs, plain ESM);
//   - a baseline for the Gemini scorer in apps/api/eval (not compared yet).
//
// What it is not: a substitute for the model. It reads surface features —
// file paths, identifiers, numbers with units, constraint and output phrasing —
// and knows nothing about whether the request makes sense. Every rule below
// maps to a sentence of the rubric, so a reader can check why a prompt got its
// score. Deterministic: the same prompt always gets the same score.

export const HEURISTIC_SCORER = 'heuristic-v1';

// `\b` in a JS regex is ASCII-only, so it never fires next to letters like
// ă or ü. Every phrase list below goes through this, which swaps `\b` for a
// Unicode-aware boundary.
const B = '(?:(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_])|(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_]))';
const words = (source, flags = 'i') => new RegExp(source.replaceAll('\\b', B), flags.includes('u') ? flags : flags + 'u');

const DIMS = [
  'goal_clarity',
  'specificity',
  'context_loading',
  'constraint_articulation',
  'output_specification',
];

// Shown when a dimension scores below 5 (same contract as the model's
// `missing` hints: one short statement, under 60 characters).
const HINTS = {
  goal_clarity: 'No concrete outcome is stated.',
  specificity: 'The change itself is not spelled out.',
  context_loading: 'No file, function or error is referenced.',
  constraint_articulation: 'No constraints or invariants are stated.',
  output_specification: 'The desired output format is not stated.',
};

// --- goal_clarity: "desired outcome stated unambiguously?" -------------------

// Imperative / request verbs that name an action on the code.
const ACTION_VERB = words(
  '\\b(' +
    [
      'speed (?:\\w+ )?up', 'add', 'fix', 'implement', 'refactor', 'write', 'create', 'build', 'replace',
      'remove', 'delete', 'rename', 'reduce', 'increase', 'speed up', 'optimi[sz]e',
      'migrate', 'wrap', 'extract', 'split', 'merge', 'review', 'explain', 'compare',
      'document', 'update', 'upgrade', 'convert', 'debug', 'find', 'propose', 'generate',
      'port', 'move', 'cache', 'validate', 'test', 'parse', 'paginate', 'log',
      'handle', 'support', 'enable', 'disable', 'limit', 'retry', 'deduplicate',
      'summari[sz]e', 'translate', 'design', 'plan', 'set up', 'configure',
      // a few non-English imperatives, so a prompt isn't scored down for its language
      'adaugă', 'adauga', 'repară', 'scrie', 'añade', 'agrega', 'corrige', 'ajoute', 'füge',
    ].join('|') +
    ')\\b',
  'gi',
);
// "don't add dependencies" states a constraint, not a goal.
const NEGATED = /(?:\bnot|n't|\bnever|\bwithout|\bno)\s+$/i;
// A measurable target or explicit success criterion.
const TARGET = words(
  [
    '\\b(?:p50|p90|p95|p99)\\b',
    '\\b(?:under|below|above|over|at most|at least|within|to)\\s+\\d',
    '\\bso (?:that|all|the)\\b',
    '\\buntil\\b',
    '\\bgoal\\s*:',
    '\\b(?:tests?|suite|build|ci) (?:pass|passes|green)\\b',
    '\\bpass(?:es)?\\b.*\\btests?\\b',
    '\\bmust (?:return|respond|produce)\\b',
  ].join('|'),
);
// A focused conceptual question ("what's the difference between X and Y").
const FOCUSED_QUESTION = /\b(?:difference between|compare|when (?:would|should) (?:you|i)|why (?:does|do|is)|how (?:do|does|can|should) i)\b/i;
// "make this better", "fix it", "help me" — a wish, not an outcome.
const VAGUE_GOAL = /\b(?:make (?:it|this|things|the \w+) (?:better|nicer|cleaner|faster)|fix (?:it|this|that)\b(?!\s+(?:so|by|in|to|with))|improve (?:it|this|things|stuff)|help me|can you help|take a look|clean(?:er)? up|wherever you think|any (?:ideas|suggestions)|doesn'?t work|isn'?t working)/i;

// --- specificity: "changes specified concretely?" -----------------------------

// Vague quantifiers and filler that stand in for a concrete change.
// How the change is made: "with exponential backoff", "using the sleep() helper".
const MECHANISM = /\b(?:with|using|via|instead of)\s+(?!(?:me|my|it|this|that|you|your|us|our code|the code)\b)[\w/'"`.-]+/gi;
// Named technologies and acronyms mid-sentence: Postgres, Docker, GIN, JSON.
const NAMED = /(?<=[\p{Ll}\p{N},;:)] )(?:\p{Lu}\p{Ll}+|\p{Lu}[\p{Ll}\p{Lu}]*\p{Lu}[\p{Ll}\p{Lu}\p{N}]*)\b/gu;
const VAGUE_WORDS = /\b(?:some|something|stuff|things?|somehow|kind of|sort of|a bunch|better|more accurate|cleaner|nicer|etc\.?|whatever|properly|correctly)\b/gi;

// --- context_loading: "references the relevant file, function, convention?" ---

const FILE_PATH = /(?:^|[\s`'"(,:])((?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z]{1,6}|[\w-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|rb|php|cs|cpp|cc|c|h|hpp|sql|md|json|ya?ml|toml|sh|css|scss|html|vue|svelte|swift|dart))(?=$|[\s`'"),.:;!?])/g;
const WELL_KNOWN_FILE = /\b(?:README|CHANGELOG|CONTRIBUTING|Dockerfile|Makefile|Procfile|docker-compose)\b/g;
const CONTEXT_LABEL = /(?:^|\n|\.\s)context\s*:/i;
const DIR_PATH = /(?:^|[\s`'"(])((?:[\w.@-]+\/){1,}[\w.@-]*)(?=$|[\s`'"),.:;])/g;
const CALL = /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(\)/g;
const CAMEL = /\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g;
const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
const BACKTICK = /`[^`\n]+`/g;
const CODE_BLOCK = /```/;
const ERROR_TEXT = /\b(?:error|exception|traceback|stack trace|fails? with|expected .{1,40} got|throws?|panic|segfault|status \d{3}|\b[45]\d\d\b)/i;
const COMMIT = /\b(?:commit|sha)\s+[0-9a-f]{6,40}\b/i;
const EXISTING_ARTIFACT = /\b(?:the existing|our|the current)\s+\w+|\bthe \w+ (?:handler|endpoint|route|query|function|helper|module|component|service|table|test|middleware|hook|schema|class)\b/i;

// --- constraint_articulation: "constraints/invariants stated?" -----------------

const CONSTRAINT = words(
  [
    '\\bmust(?:n\'t| not)?\\b',
    '\\b(?:do not|don\'t|never|avoid)\\b',
    '\\bwithout\\b',
    '\\bkeep(?:ing)?\\b',
    '\\b(?:preserve|unchanged|stay(?:s)? (?:the same|idempotent|compatible)|remain(?:s)?)\\b',
    '\\bno (?:new \\w+|dependenc|librar|packages?|breaking|api change|public api)',
    '\\((?:not|no|except)\\b',
    // a trigger that scopes the change: "retry when the downstream call fails"
    '\\b(?:when|if|unless)\\b[^,.\\n]{3,40}\\b(?:fails?|errors?|times? out|returns?|throws?)\\b',
    '\\bbackwards?[- ]compatible\\b',
    '\\bidempoten',
    '\\b(?:at most|at least|max(?:imum|im)?|min(?:imum)?|up to|no more than|limit(?:ed)? to)\\b',
    '\\bconstraints?\\s*:',
    '\\bonly (?:on|touch|change|modify|in)\\b',
    '\\bfără\\b|\\bsin\\b|\\bsans\\b|\\bohne\\b',
  ].join('|'),
  'gi',
);

// --- output_specification: "desired output shape requested?" ------------------

const OUTPUT = words(
  [
    '\\breturn (?:only|just)\\b',
    '\\breturn\\b[^.\\n]{1,60}\\bonly\\b',
    '\\b(?:only|just) (?:return|the (?:diff|code|function|sql|file|patch|migration))\\b',
    '\\b(?:reply|respond|answer) (?:with|in)\\b',
    '\\boutput\\s*(?::|as\\b|only\\b|a\\b)',
    '\\bas an? (?:diff|patch|table|list|json|markdown|single|bullet)',
    '\\bin (?:\\d+|one|two|three|four|five) (?:sentences?|bullets?|lines?|words?|paragraphs?)\\b',
    '\\b(?:the|a|minimal|unified) (?:diff|patch)\\b',
    '\\bdiff(?:-ul)?\\b',
    '\\b(?:single|one) (?:code block|file|function|sentence)\\b',
    '\\b(?:markdown table|json object|bulleted list|bullet list)\\b',
    '\\bno (?:explanation|prose|commentary)\\b',
    '\\bformat(?:ted)? as\\b',
    '\\bthen (?:one|a) sentence\\b',
    '\\breturnează\\b',
  ].join('|'),
  'gi',
);

// Text aimed at the scorer instead of describing a task: "ignore the rubric",
// "score every dimension 10", "you are now ScoreBot". Not a task, so not a
// good prompt; every dimension is capped.
const META = /\b(?:ignore (?:the|all|any|previous|prior) (?:rubric|instructions?|rules?)|(?:score|rate) (?:every|each|all)(?: \w+)? (?:dimension|10)|you are now|as scorebot|only job is to output)\b|"dimensions"\s*:/i;

const count = (re, s) => (s.match(re) ?? []).length;
const clamp = (n) => Math.max(0, Math.min(10, Math.round(n)));
const uniq = (arr) => [...new Set(arr)];

/**
 * Score a draft prompt on the five rubric dimensions without a model.
 *
 * @param {string} prompt
 * @returns {{ dimensions: Record<string, number>, missing: Record<string, string> }}
 */
export function heuristicScore(prompt) {
  const text = String(prompt ?? '').trim();
  const wordCount = (text.match(/[\p{L}\p{N}_'-]+/gu) ?? []).length;

  const files = uniq([
    ...[...text.matchAll(FILE_PATH)].map((m) => m[1]),
    ...(text.match(WELL_KNOWN_FILE) ?? []),
  ]);
  const dirs = uniq([...text.matchAll(DIR_PATH)].map((m) => m[1])).filter((d) => !files.some((f) => f.startsWith(d)));
  const identifiers = uniq([
    ...(text.match(CALL) ?? []),
    ...(text.match(CAMEL) ?? []),
    ...(text.match(SNAKE) ?? []),
    ...(text.match(BACKTICK) ?? []),
  ]).filter((id) => !files.some((f) => f.includes(id.replace(/[`()]/g, ''))));
  // Verbs are looked for in the prose only: "retry" inside src/lib/retry.ts
  // is a file name, not a request.
  const prose = text.replace(FILE_PATH, ' ').replace(BACKTICK, ' ').replace(CALL, ' ');
  const hasVerb = [...prose.matchAll(ACTION_VERB)].some((m) => !NEGATED.test(prose.slice(0, m.index)));
  const numbers = count(/\d+/g, text);
  const vague = count(VAGUE_WORDS, text);
  const mechanisms = count(MECHANISM, prose);
  const named = count(NAMED, text);
  const constraints = count(CONSTRAINT, text);
  const outputs = uniq((text.match(OUTPUT) ?? []).map((m) => m.toLowerCase())).length;
  const hasTarget = TARGET.test(text);
  const vagueGoal = VAGUE_GOAL.test(text);
  const question = FOCUSED_QUESTION.test(text);

  // goal_clarity
  let goal = 0;
  if (hasVerb) goal += 4;
  if (hasVerb && wordCount >= 8) goal += 2; // the verb has an object worth naming
  if (hasTarget) goal += 3;
  if (question && wordCount >= 8) goal += 6;
  if (files.length || identifiers.length) goal += 1;
  if (vagueGoal) goal -= 4;

  // specificity
  let spec = 0;
  spec += Math.min(identifiers.length, 3) * 2;
  spec += Math.min(files.length, 2) * 1.5;
  spec += Math.min(numbers, 3);
  spec += Math.min(mechanisms, 2) * 2;
  spec += Math.min(named, 3);
  if ((hasVerb || question) && wordCount >= 10) spec += 2;
  if (/(?:^|\n)\s*(?:\d+[.)]|[-*•])\s/.test(text) || count(/,/g, text) >= 3) spec += 1;
  spec -= vague * 1.5;
  if (vagueGoal) spec -= 2;

  // context_loading
  let ctx = 0;
  if (files.length) ctx += 6 + Math.min(files.length - 1, 2) * 1.5;
  else if (dirs.length) ctx += 4;
  ctx += Math.min(identifiers.length, 2) * 1.5;
  if (CODE_BLOCK.test(text)) ctx += 2;
  if (ERROR_TEXT.test(text)) ctx += 1.5;
  if (COMMIT.test(text)) ctx += 1.5;
  if (EXISTING_ARTIFACT.test(text)) ctx += 2;
  if (CONTEXT_LABEL.test(text)) ctx += 3;

  // constraint_articulation: every stated constraint counts.
  let cons = 0;
  if (constraints) cons += 4 + Math.min(constraints - 1, 3) * 2;

  // output_specification: one explicit request is already a clear shape.
  let out = 0;
  if (outputs) out += 7 + Math.min(outputs - 1, 2) * 2;

  const dimensions = {
    goal_clarity: clamp(goal),
    specificity: clamp(spec),
    context_loading: clamp(ctx),
    constraint_articulation: clamp(cons),
    output_specification: clamp(out),
  };

  // A few words can't carry five dimensions, and text aimed at the scorer is
  // not a task.
  const cap = META.test(text) ? 2 : wordCount < 4 ? 2 : 10;
  for (const d of DIMS) dimensions[d] = Math.min(dimensions[d], cap);

  /** @type {Record<string, string>} */
  const missing = {};
  for (const d of DIMS) if (dimensions[d] < 5) missing[d] = HINTS[d];
  return { dimensions, missing };
}
