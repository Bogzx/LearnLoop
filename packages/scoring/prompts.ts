// Locked prompt templates for the Gemini calls. One copy, imported by
// apps/api (score, augment, topic) and apps/stop-hook (extract). Keeping
// the wording byte-stable across calls is what lets us reason about
// quality drift over time. Spec §5 / §6 / §18.

import type { Dimension, DimensionScores, MissingHints } from '@trailhead/shared';

// ----- /score: 5-dim Haiku-equivalent scorer (now Gemini Flash) -------------
// Spec §5. Returns JSON only — Gemini's responseSchema enforces shape.
export const SCORE_SYSTEM_PROMPT = `You are a prompt-quality scorer for software engineers.

Given a developer's draft prompt, score it 0-10 on each of these five dimensions:

- goal_clarity:           is the desired outcome stated unambiguously?
                          ("make this better" → low; "reduce p99 to 200ms" → high)
- specificity:            are the steps / shape of the change concrete?
                          ("add error handling" → low; "wrap fetch in try/catch,
                          log via logger.ts, return 500" → high)
- context_loading:        does the prompt reference relevant files, functions,
                          or conventions? (none → low; "in src/api/webhooks/
                          handler.ts" → high)
- constraint_articulation: are constraints called out?
                          (none → low; "must remain idempotent; no public API
                          change" → high)
- output_specification:   is the expected return shape defined?
                          (none → low; "return only the modified function, no
                          explanation" → high)

For dimensions scoring strictly below 5, return a brief plain-English "missing"
hint (≤ 12 words) in the missing object. For dimensions ≥ 5 omit them from
missing.

Do not return any prose. Output only valid JSON matching the schema.`;

export function buildScoreUserPrompt(args: { prompt: string; file_path?: string }) {
  const ctx = args.file_path ? `File context: ${args.file_path}\n\n` : '';
  return `${ctx}Prompt:\n${args.prompt}`;
}

// JSON schema we hand to Gemini's responseSchema. Keeps the shape locked.
export const SCORE_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['dimensions', 'missing'],
  properties: {
    dimensions: {
      type: 'object',
      required: [
        'goal_clarity',
        'specificity',
        'context_loading',
        'constraint_articulation',
        'output_specification',
      ],
      properties: {
        goal_clarity:            { type: 'integer', minimum: 0, maximum: 10 },
        specificity:             { type: 'integer', minimum: 0, maximum: 10 },
        context_loading:         { type: 'integer', minimum: 0, maximum: 10 },
        constraint_articulation: { type: 'integer', minimum: 0, maximum: 10 },
        output_specification:    { type: 'integer', minimum: 0, maximum: 10 },
      },
    },
    missing: {
      type: 'object',
      properties: {
        goal_clarity:            { type: 'string' },
        specificity:             { type: 'string' },
        context_loading:         { type: 'string' },
        constraint_articulation: { type: 'string' },
        output_specification:    { type: 'string' },
      },
    },
  },
} as const;

export interface ScoreModelOutput {
  dimensions: DimensionScores;
  missing: MissingHints;
}

// ----- /diff "topic" extractor (used to find a matching graduated prompt) ---
export const TOPIC_SYSTEM_PROMPT = `You classify software-engineering prompts by their primary topic.

Return one of: retry, auth, webhook, db_migration, error_handling, logging,
testing, deployment, refactor, performance, schema, validation, other.

Output strictly JSON: {"topic": "<one of the above>"}.`;

export const TOPIC_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['topic'],
  properties: {
    topic: { type: 'string' },
  },
} as const;

// ----- Stop-hook learning extractor -----------------------------------------
// Spec §7C / §18 #3. Used by apps/stop-hook (and optionally from the MCP
// server). False positives = wiki spam; false negatives = miss demo moment.
export const EXTRACT_SYSTEM_PROMPT = `You decide whether the most recent assistant turn revealed a durable
team-wide engineering convention or rule worth recording in the team wiki.

A durable learning is:
- a stated team convention ("we always use exponential backoff with jitter")
- a stated invariant ("retries must remain idempotent")
- a stated rule of thumb that applies beyond the immediate problem

NOT durable learnings:
- one-off bugfixes
- rephrasing of the user's own prompt
- pleasantries or summaries

If you find a durable learning, return:
{"node_path": "<closest folder path with trailing slash, e.g. src/api/webhooks/>",
 "insight": "<one declarative sentence, no quotes, present tense>"}

If you do not, return: {"node_path": null, "insight": null}.

Output strictly JSON. Nothing else.`;

export const EXTRACT_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['node_path', 'insight'],
  properties: {
    node_path: { type: ['string', 'null'] },
    insight:   { type: ['string', 'null'] },
  },
} as const;

// ----- "Have Claude clarify" augmentation template (browser ext) ------------
// Spec §6. Inserted by the browser extension when the user opts in. Lives
// here so the extension and the API stay in sync on wording.
export function buildAugmentation(opts: {
  original: string;
  missing: Partial<Record<Dimension, string>>;
}): string {
  const missingDims = (Object.keys(opts.missing) as Dimension[])
    .map((d) => d.replace(/_/g, ' '));
  const missingList =
    missingDims.length === 0
      ? 'a few key dimensions'
      : missingDims.length === 1
      ? missingDims[0]
      : missingDims.slice(0, -1).join(', ') + ' and ' + missingDims[missingDims.length - 1];

  return `${opts.original}

---
[Trailhead coaching: This prompt is missing ${missingList}.
Before answering, please ask the user 2-3 clarifying questions to fill those
gaps (file/folder, current helper, constraints, expected output shape).
Only proceed once these are clarified.]`;
}
