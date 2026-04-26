import './env.ts';
// Thin Gemini wrapper. One client, one place to encode model quirks.
//
// gemini-2.5-flash supports responseSchema enforcement and thinkingBudget=0
// for fast structured output. We use it for /score and topic extraction.
//
// gemma-4-31b-it is a thinking model with no schema enforcement and no
// thinking-budget control. It returns chain-of-thought as `thought:true`
// parts followed by the answer in plain `text`. We use it for /diff and
// the learning-extractor helper below, where latency is tolerable.

import { GoogleGenAI, Type } from '@google/genai';
import type { Dimension, DimensionScores, MissingHints } from '@trailhead/shared';
import { DIMENSIONS } from '@trailhead/shared';
import {
  DIFF_MODEL,
  EXTRACT_MODEL,
  EXTRACT_SYSTEM_PROMPT,
  SCORE_MODEL,
  SCORE_SYSTEM_PROMPT,
  TOPIC_MODEL,
  TOPIC_SYSTEM_PROMPT,
  buildScoreUserPrompt,
} from '@trailhead/scoring';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY not set');
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Retry policy:
//
//   - 429 / 503 / 500 → retry. These are transient (free-tier rate limit,
//     overloaded backend). A few hundred ms of backoff usually clears them.
//
//   - timeout → DO NOT retry. Timeouts on Gemini are most often caused by
//     model repetition loops on ambiguous prompts (the "what is the X
//     impact of the bug" failure mode that burned ~32K tokens on
//     "fix the retry" — 2026-04-25 incident). Retrying just runs the same
//     loop again. Better to fail fast and let callers fail-open.
//
// Per-call timeout is 20s — `/score` with dynamic thinking lands around
// 2-4s; 20s is a generous ceiling that catches stalls without burning
// much LLM budget. (Was 15s when thinking was disabled; raised after
// switching to thinkingBudget=-1.)
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  perCallTimeoutMs = 20_000,
): Promise<T> {
  const sleeps = [200, 600, 1500];
  for (let i = 0; i <= sleeps.length; i++) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`__trailhead_timeout__:${label}`)), perCallTimeoutMs);
    });
    try {
      const result = await Promise.race([fn(), timeoutPromise]);
      return result as T;
    } catch (err) {
      const msg = String((err as { message?: string }).message ?? '');
      const isTimeout = msg.startsWith('__trailhead_timeout__');
      const status =
        (err as { status?: number; code?: number }).status ??
        (err as { code?: number }).code;
      // Timeouts are NOT retryable — see comment above. Only true rate-limit
      // and overload codes get the backoff treatment.
      const retryable = status === 429 || status === 503 || status === 500;
      if (isTimeout) {
        console.warn(`[gemini] ${label} timed out at ${perCallTimeoutMs}ms — not retrying`);
        throw err;
      }
      if (!retryable || i === sleeps.length) throw err;
      const base = sleeps[i] ?? 1500;
      const jitter = Math.floor(Math.random() * 250);
      console.warn(`[gemini] ${label} ${status} — retrying in ${base + jitter}ms`);
      await new Promise((r) => setTimeout(r, base + jitter));
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
  throw new Error('unreachable');
}

// Pull the answer text out of a response, ignoring chain-of-thought parts
// that thinking models emit. Works for both Flash and Gemma.
type GenResp = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };

// 4000 chars is ~1000 tokens — well above any well-formed response in this
// codebase, but a hard ceiling against truncated repetition garbage being
// fed to JSON.parse (which scales O(n) on input length).
const MAX_EXTRACT_CHARS = 4000;

function extractAnswer(resp: GenResp): string {
  const parts = resp.candidates?.[0]?.content?.parts ?? [];
  const joined = parts
    .filter((p) => p.thought !== true && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
  return joined.length > MAX_EXTRACT_CHARS
    ? joined.slice(0, MAX_EXTRACT_CHARS)
    : joined;
}

// Strip ``` fences if a model wrapped its JSON in markdown despite being
// told not to. Returns `null` if nothing parses.
function tryParseJson<T = unknown>(raw: string): T | null {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end > start) s = s.slice(start, end + 1);
  try { return JSON.parse(s) as T; } catch { return null; }
}

// Salvage scores from a truncated /score response. The 2026-04-26 finding
// (after wiring team_context into /coach via deriveContextPath): when the
// team-context bundle primes the model toward verbosity, the `missing` field
// strings sometimes loop into themselves ("The prompt does not specify... The
// prompt does not specify..." × N) until they hit maxOutputTokens, which
// makes the full JSON unparseable. The `dimensions` block always lands first
// and is shape-stable, so we can recover the score even when the missing
// hints are corrupt. Without this fallback, Gemini's repetition trap collapses
// the call to fail-open (all-zero) and the user sees "no coaching this turn"
// despite a perfectly good 5-dim score sitting in the response.
//
// Returns null when even the dimensions block is missing.
function salvagePartialScore(raw: string): { dimensions: Record<string, number> } | null {
  const dimsMatch = raw.match(/"dimensions"\s*:\s*\{([^}]*)\}/);
  const body = dimsMatch?.[1];
  if (!body) return null;
  const dims: Record<string, number> = {};
  const fieldRe = /"(\w+)"\s*:\s*(-?\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(body)) !== null) {
    dims[m[1]!] = Number(m[2]);
  }
  if (Object.keys(dims).length === 0) return null;
  return { dimensions: dims };
}

// ----- /score ----------------------------------------------------------------
export interface ScoreModelResult {
  dimensions: DimensionScores;
  missing: MissingHints;
}

export async function scorePrompt(args: {
  prompt: string;
  file_path?: string;
  // Optional team-context bundle (already rendered by team-context.ts).
  // When set, we prepend it to the system instruction so the rubric is
  // calibrated against the team's conventions. The user's prompt itself
  // is NOT modified — score still reflects the bare prompt's quality.
  team_context?: string;
}): Promise<ScoreModelResult> {
  // Flash with responseSchema + dynamic thinking + maxOutputTokens cap.
  //
  // thinkingBudget=-1 (dynamic) is the single biggest model-side defense
  // against the repetition-loop class of failures: the planning step gives
  // the model an explicit exit ("nothing concrete to say in `specificity` —
  // omit the hint") before it commits tokens to the open string field.
  // Acceptable now that /score fires only at decision points (submit on
  // browser, button click in VS Code), not on every keystroke — the
  // ~1-3s thinking latency lands during a deliberate user beat, not a
  // 250ms typing debounce.
  //
  // maxOutputTokens is still the hard ceiling that bounds cost in the
  // worst case. The cap covers thoughts + candidate tokens combined; with
  // dynamic thinking enabled and a team-context bundle in the system
  // prompt, observed thoughtsTokenCount ranges 300-450, leaving ~50 tokens
  // for the JSON response when capped at 500 — and the response gets
  // truncated to "{\n  \"dimensions\": {\n    \"goal_" with finishReason=
  // MAX_TOKENS. Bumped to 1500 so a well-grounded score has room to think
  // (~500) AND emit the ~150-token response, while still bounding the
  // 2026-04-25 runaway-repetition class of bug at 3x of today's normal.
  const systemInstruction = args.team_context
    ? `${args.team_context}\n\n${SCORE_SYSTEM_PROMPT}`
    : SCORE_SYSTEM_PROMPT;

  if (SCORE_MODEL.startsWith('gemini-')) {
    const resp = await withRetry(
      () => ai.models.generateContent({
        model: SCORE_MODEL,
        contents: buildScoreUserPrompt(args),
        config: {
          systemInstruction,
          temperature: 0.2,
          thinkingConfig: { thinkingBudget: -1 },
          maxOutputTokens: 1500,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            required: ['dimensions', 'missing'],
            properties: {
              dimensions: {
                type: Type.OBJECT,
                required: [...DIMENSIONS],
                properties: Object.fromEntries(
                  DIMENSIONS.map((d) => [d, { type: Type.INTEGER, minimum: 0, maximum: 10 }]),
                ),
              },
              missing: {
                type: Type.OBJECT,
                properties: Object.fromEntries(
                  // maxLength MUST be passed as a string to match the SDK's
                  // typed contract (Schema.maxLength is `string` in
                  // @google/genai's types). Passing a number is silently
                  // dropped on the wire — the API never sees the
                  // constraint, the model overshoots freely. This was the
                  // root cause of the 2026-04-25 repetition incident:
                  // the comment in the original code claimed maxLength
                  // would prevent loops, but the wrong type meant the
                  // constraint was a no-op. The real backstop is still
                  // maxOutputTokens above; this is belt-and-suspenders.
                  DIMENSIONS.map((d) => [d, { type: Type.STRING, maxLength: '60' }]),
                ),
              },
            },
          },
        },
      }),
      'score(flash)',
    );
    const text = extractAnswer(resp);
    const parsed = tryParseJson<ScoreModelResult>(text);
    if (parsed) return coerceScore(parsed);

    // Strict parse failed. Before giving up to fail-open, try to salvage
    // just the dimensions block — the `missing` field is usually what loops
    // (see salvagePartialScore for context).
    const salvaged = salvagePartialScore(text);
    const r = resp as unknown as {
      candidates?: { finishReason?: string }[];
      usageMetadata?: { thoughtsTokenCount?: number; candidatesTokenCount?: number };
    };
    const u = r.usageMetadata ?? {};
    if (salvaged) {
      console.warn(
        `[gemini] score(flash) salvaged dimensions from malformed JSON — ` +
        `finishReason=${r.candidates?.[0]?.finishReason}, ` +
        `thoughts=${u.thoughtsTokenCount}, candidates=${u.candidatesTokenCount}`,
      );
      return coerceScore({ dimensions: salvaged.dimensions, missing: {} });
    }

    console.warn(
      `[gemini] score(flash) parse failed — finishReason=${r.candidates?.[0]?.finishReason}, ` +
      `thoughts=${u.thoughtsTokenCount}, candidates=${u.candidatesTokenCount}, ` +
      `raw[0..200]=${text.slice(0, 200)}`,
    );
    // Total parse failure → return zeros and let the caller fail-open. NEVER
    // fall through to a second LLM call (the previous fallthrough doubled
    // cost on every bad response, see 2026-04-25 incident).
    return coerceScore({ dimensions: zeroDims(), missing: {} });
  }

  // Non-Flash model path — used only if SCORE_MODEL is changed in
  // packages/scoring/src/models.mjs to a Gemma-family model that has no
  // schema enforcement. Single attempt; same fail-closed posture.
  const resp = await withRetry(
    () => ai.models.generateContent({
      model: SCORE_MODEL,
      contents:
        `${systemInstruction}\n\n${buildScoreUserPrompt(args)}\n\n` +
        `Return ONLY the JSON object, nothing else.`,
      config: { temperature: 0, maxOutputTokens: 500 },
    }),
    'score(non-flash)',
  );
  const text = extractAnswer(resp);
  const parsed = tryParseJson<ScoreModelResult>(text);
  return coerceScore(parsed ?? { dimensions: zeroDims(), missing: {} });
}

// Defensively shape model output. Gemma sometimes returns `missing` as a
// flat array of strings instead of the keyed object Flash returns; we keep
// that variant available to the caller as best-effort hints.
function coerceScore(input: unknown): ScoreModelResult {
  const obj = (input ?? {}) as { dimensions?: Record<string, unknown>; missing?: unknown };
  const dimsIn = obj.dimensions ?? {};
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((d) => {
      const v = (dimsIn as Record<string, unknown>)[d];
      const n = typeof v === 'number' ? v : Number(v);
      return [d, Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n))) : 0];
    }),
  ) as DimensionScores;

  const missing: MissingHints = {};
  if (obj.missing && typeof obj.missing === 'object' && !Array.isArray(obj.missing)) {
    for (const d of DIMENSIONS) {
      const v = (obj.missing as Record<string, unknown>)[d];
      if (typeof v === 'string' && v.trim()) missing[d] = v.trim();
    }
  } else if (Array.isArray(obj.missing)) {
    const lowDims = DIMENSIONS.filter((d) => dimensions[d] < 5);
    obj.missing.forEach((entry, i) => {
      const d = lowDims[i];
      if (d && typeof entry === 'string' && entry.trim()) missing[d] = entry.trim();
    });
  }
  return { dimensions, missing };
}

function zeroDims(): DimensionScores {
  return Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as DimensionScores;
}

// Average score → "overall" 0..10 the score-card displays.
export function overallScore(d: DimensionScores): number {
  const sum = DIMENSIONS.reduce((s, k) => s + d[k], 0);
  return Math.round(sum / DIMENSIONS.length);
}

// ----- topic extraction (used by /diff to find a graduated prompt) ----------
const TOPIC_VALUES = [
  'retry', 'auth', 'webhook', 'db_migration', 'error_handling',
  'logging', 'testing', 'deployment', 'refactor', 'performance',
  'schema', 'validation', 'other',
] as const;

export async function extractTopic(prompt: string): Promise<string> {
  const resp = await withRetry(
    () => ai.models.generateContent({
      model: TOPIC_MODEL,
      contents: prompt,
      config: {
        systemInstruction: TOPIC_SYSTEM_PROMPT,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['topic'],
          properties: {
            topic: { type: Type.STRING, enum: [...TOPIC_VALUES] },
          },
        },
      },
    }),
    'topic',
  );
  const parsed = tryParseJson<{ topic: string }>(extractAnswer(resp));
  return parsed?.topic ?? 'other';
}

// ----- path + topic extraction (used by /coach prompt-promotion) ------------
// Single Flash call when /coach gets a graduate-eligible prompt without an
// explicit file_path. Returns the file/folder mentioned in the prompt text
// (empty string if none) and the topic, so we can file the promoted prompt
// under the right node in one round-trip. Mirrors extractTopic's shape.
const PATH_TOPIC_SYSTEM_PROMPT =
  `Extract a folder or file path AND a topic from a developer's prompt.

PATH: If the prompt mentions a specific file or folder path (for example
'src/api/webhooks/handler.ts' or 'src/db/'), return that exact path. If no
path is mentioned, return an empty string. Do NOT invent paths. Do NOT
include any text other than the path itself.

TOPIC: Pick the closest match from the enum. Use 'other' if nothing fits.

Return ONLY the JSON object.`;

export async function extractPathAndTopic(
  prompt: string,
): Promise<{ path: string | null; topic: string | null }> {
  try {
    const resp = await withRetry(
      () => ai.models.generateContent({
        model: TOPIC_MODEL,
        contents: prompt,
        config: {
          systemInstruction: PATH_TOPIC_SYSTEM_PROMPT,
          temperature: 0,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            required: ['path', 'topic'],
            properties: {
              path: { type: Type.STRING },
              topic: { type: Type.STRING, enum: [...TOPIC_VALUES] },
            },
          },
        },
      }),
      'path-topic',
    );
    const parsed = tryParseJson<{ path?: string; topic?: string }>(extractAnswer(resp));
    const rawPath = typeof parsed?.path === 'string' ? parsed.path.trim() : '';
    // Sanity check: paths don't contain whitespace and shouldn't be a sentence.
    // If the model echoed prose, treat it as null.
    const path =
      rawPath.length > 0 && rawPath.length < 200 && !/\s/.test(rawPath)
        ? rawPath
        : null;
    const topic =
      typeof parsed?.topic === 'string' && parsed.topic !== 'other'
        ? parsed.topic
        : null;
    return { path, topic };
  } catch (err) {
    console.warn('[gemini] extractPathAndTopic failed', err);
    return { path: null, topic: null };
  }
}

// ----- /diff narrative synthesis (Gemma 4 31B; quality > latency) -----------
export async function synthesizeDiff(args: {
  user_prompt: string;
  user_scores: DimensionScores;
  team_prompt: string;
  team_scores: DimensionScores;
}): Promise<string> {
  const dimsLine = (s: DimensionScores) => DIMENSIONS.map((d) => `${d}=${s[d]}`).join(', ');
  const resp = await withRetry(
    () => ai.models.generateContent({
      model: DIFF_MODEL,
      contents:
        `Compare these two prompts on the five Trailhead dimensions.\n\n` +
        `USER (${dimsLine(args.user_scores)}):\n${args.user_prompt}\n\n` +
        `TEAM (${dimsLine(args.team_scores)}):\n${args.team_prompt}\n\n` +
        `In 2-3 sentences, name ONE prompt-engineering move the team prompt makes that the user's didn't, ` +
        `then phrase how to apply that move next time as a habit (not a question). No bullets, no preamble, ` +
        `no rhetorical "What if..." / "How could..." phrasing.`,
      config: { temperature: 0.2 },
    }),
    'diff',
  );
  return extractAnswer(resp);
}

// ----- /improve --------------------------------------------------------------
// Gemini-driven multi-turn prompt coach. Stateless — caller passes the full
// conversation each turn. Spec: 2026-04-26-improve-widget-design.md
const IMPROVE_SYSTEM_PROMPT = `You are a senior engineer's prompt coach with an educational mindset. The user is about to send a prompt to Claude. You have two jobs at once:
1) Help them produce a sharper prompt by asking targeted follow-up questions, OR — when you have enough context — return a polished version.
2) Teach them prompt-engineering principles along the way, so every conversation leaves them a better prompter.

How to teach while asking:
- Lead every question with a one-sentence "Tip:" that names the prompt-engineering principle behind it. The tip must be specific to the weakness you are probing — not a generic platitude.
  Examples:
  - "Tip: Vague locations force Claude to guess, and it often guesses wrong. Which file or directory should it focus on?"
  - "Tip: Without an explicit output shape, Claude picks one that may not fit your codebase. Should this be a single function, a class, a code snippet, or a diff against existing code?"
  - "Tip: Constraints prevent over-engineering and keep edits surgical. Are there parts of the code you want left untouched, or libraries you do not want introduced?"
  - "Tip: Examples ground abstract requests. Could you paste a small input/output sample, or describe one in concrete numbers?"
  - "Tip: A clear success criterion lets Claude know when to stop iterating. How will you know the change worked — a passing test, a UI behavior, a metric?"
- Vary the tip across turns — do not repeat the same principle two questions in a row.
- Keep tip + question under 35 words combined. You are a teacher, not a lecturer.
- Tone: warm, concise, peer-to-peer. Avoid corporate phrasing like "Could you please clarify…". Sound like a senior dev nudging a junior across a desk.

When to finalize:
- Stop asking once you have enough to write a strong polished prompt. Three or four questions is usually plenty; do not drag the conversation.
- The polished prompt must preserve the user's original intent. Weave in the specifics they gave you; do not invent requirements they did not imply.
- The "rationale" field is shown to the user as a "What changed" recap — treat it as a mini-lesson. Write 1-2 sentences naming the weak dimensions you addressed and the prompt-engineering moves you made (e.g. "Added an explicit file path and an expected diff shape so Claude does not have to guess location or output format.").

Output rules:
- JSON only. No prose outside the JSON. Match the schema exactly.
- One question per turn when kind="question".
- If the command is "finalize", you MUST return kind="final" regardless of how much context you have. Synthesize the best polished prompt and rationale you can from what is available.`;

export interface ImproveCoachInput {
  original_prompt: string;
  missing: MissingHints;
  history: { role: 'assistant' | 'user'; text: string }[];
  command: 'next' | 'finalize';
  // Same semantics as scorePrompt.team_context — when set, prepend to the
  // system instruction so the coach's questions and the polished prompt
  // are calibrated against the team's idiom.
  team_context?: string;
}

export type ImproveCoachOutput =
  | { kind: 'question'; text: string }
  | { kind: 'final'; polished: string; rationale?: string };

export async function improveCoach(input: ImproveCoachInput): Promise<ImproveCoachOutput> {
  const dimList = Object.keys(input.missing).map((d) => d.replace(/_/g, ' '));
  const weak = dimList.length === 0 ? '(none flagged)' : dimList.join(', ');
  const transcript = input.history.length === 0
    ? '(no turns yet)'
    : input.history
        .map((t, i) => `${i + 1}. ${t.role === 'assistant' ? 'Coach' : 'User'}: ${t.text}`)
        .join('\n');

  const userMessage =
    `Original prompt:\n"""\n${input.original_prompt}\n"""\n\n` +
    `Weak dimensions: ${weak}\n\n` +
    `Conversation so far:\n${transcript}\n\n` +
    `Command: ${input.command}`;

  const systemInstruction = input.team_context
    ? `${input.team_context}\n\n${IMPROVE_SYSTEM_PROMPT}`
    : IMPROVE_SYSTEM_PROMPT;

  const resp = await withRetry(
    () => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: userMessage,
      config: {
        systemInstruction,
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 800,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['kind'],
          properties: {
            kind: { type: Type.STRING, enum: ['question', 'final'] },
            text: { type: Type.STRING },
            polished: { type: Type.STRING },
            rationale: { type: Type.STRING },
          },
        },
      },
    }),
    'improve',
  );

  const raw = extractAnswer(resp);
  const parsed = tryParseJson<{
    kind?: string;
    text?: string;
    polished?: string;
    rationale?: string;
  }>(raw);
  if (!parsed) throw new Error('improveCoach: unparseable response');
  if (parsed.kind === 'question') {
    if (typeof parsed.text !== 'string' || !parsed.text.trim()) {
      throw new Error('improveCoach: question missing text');
    }
    return { kind: 'question', text: parsed.text.trim() };
  }
  if (parsed.kind === 'final') {
    if (typeof parsed.polished !== 'string' || !parsed.polished.trim()) {
      throw new Error('improveCoach: final missing polished');
    }
    return {
      kind: 'final',
      polished: parsed.polished.trim(),
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : undefined,
    };
  }
  throw new Error(`improveCoach: unexpected kind=${String(parsed.kind)}`);
}

// ----- learning extractor (Gemma 4 31B) -------------------------------------
// Helper kept available for a future server-side learning-extraction path.
// Not currently wired to any endpoint.
export interface ExtractResult { node_path: string | null; insight: string | null; }

export async function extractLearning(args: {
  user_prompt: string;
  assistant_response: string;
}): Promise<ExtractResult> {
  const resp = await withRetry(
    () => ai.models.generateContent({
      model: EXTRACT_MODEL,
      contents:
        `${EXTRACT_SYSTEM_PROMPT}\n\n` +
        `USER PROMPT:\n${args.user_prompt}\n\n` +
        `ASSISTANT RESPONSE:\n${args.assistant_response}\n\n` +
        `Return ONLY the JSON object.`,
      config: { temperature: 0 },
    }),
    'extract',
  );
  const parsed = tryParseJson<ExtractResult>(extractAnswer(resp));
  if (!parsed) return { node_path: null, insight: null };
  return {
    node_path: typeof parsed.node_path === 'string' ? parsed.node_path : null,
    insight:   typeof parsed.insight   === 'string' ? parsed.insight   : null,
  };
}

// =============================================================================
// coachScore — single Gemini call per /coach round (2026-04-26 consolidation)
//
// Folds scoring + acknowledgment + tip + strong-example + summary into one
// structured response. Replaces the four-call flow (scorePrompt +
// rewriteForDims + acknowledgeProgress + summarizeCoaching). Gemini stays
// in every round but the per-round LLM cost is now strictly 1.
//
// Topic discipline: the strong_example MUST stay on the user's prompt
// theme. Reference templates from the team's wiki library are passed as
// inline style guidance ("Reference style: ...") rather than as the
// example's source. team_context (rules + durable learnings) lives in the
// system instruction, where it has always lived.
//
// Token budget under maxOutputTokens=1500 (worst case ~720 tokens of
// output, plus 600-800 for dynamic thinking): dimensions ~50, missing
// ~120, strong_example ~200, tip ~30, acknowledgment ~30, summary ~200,
// JSON overhead ~50. ~2× safety margin AFTER thinking budget. The
// 2026-04-25 incident was 32K tokens — we are still 21× below the
// failure mode even at this raised cap.
// =============================================================================

// Phase is server-determined PRE-Gemini-call from request signals only.
// We don't know the score until after the call, so for round 2+ we emit a
// "mid_loop" phase that asks the model to emit BOTH teach content AND a
// summary — the server picks which to render based on the actual score
// (success / no-progress / keep teaching). This wastes ~150 tokens on the
// non-exit paths in exchange for strict 1 call per round.
export type CoachPhase =
  | 'teach'             // round 1, score mode — emit teach content only
  | 'mid_loop'          // round 2+ < MAX, score mode — emit both teach + summary
  | 'exit_max_rounds'   // round = MAX, score mode — emit summary only
  | 'exit_skip';        // skip_reveal mode — emit summary only

export interface CoachScoreInput {
  // The current prompt to score and (when teaching) build an example for.
  prompt: string;
  // Round 1 = same as `prompt`. Round 2+ = the user's first prompt of the
  // session, used so the model can name what changed in the acknowledgment
  // and write the summary against the original starting point.
  original_prompt?: string;
  file_path?: string;
  // Wiki rules + durable learnings, prepended to the system instruction.
  // Same shape as the existing scorePrompt / rewriteForDims contract.
  team_context?: string;
  // Top 2-3 same-topic graduated prompts from the team library, passed
  // inline as style guidance. The model treats these as how-to-phrase
  // hints, NOT as the topic source.
  reference_templates?: string[];
  // The lowest-scoring dim from the PREVIOUS round (or null when none).
  // Passed to the model as historical context only — the model picks the
  // NEW target dim from its own scoring per the system prompt's rules.
  // Null at exits.
  previous_target_dim?: Dimension | null;
  // Round 2+ — used for acknowledgment of which dim moved.
  previous_dimensions?: DimensionScores;
  // Original (round-1) dims — used for the summary's score arc.
  original_dimensions?: DimensionScores;
  // Server-determined phase. The model uses it to decide which conditional
  // fields to emit non-empty.
  phase: CoachPhase;
}

export interface CoachScoreOutput {
  dimensions: DimensionScores;
  missing: MissingHints;
  // Required-but-defaultable: model returns "" when not applicable.
  // Server checks emptiness before rendering each.
  strong_example: string;
  tip: string;
  acknowledgment: string;
  summary: string;
}

const COACH_SCORE_SYSTEM_PROMPT = `PRIMARY DIRECTIVE — read this first, follow it always:

1. The USER'S PROMPT is the SUBJECT of everything you produce. Score it, write the example for it, acknowledge what was added to it, summarize the arc of it. Not templates. Not team conventions. Not the wiki. The user's prompt.
2. team_context (rules + durable learnings) and reference_templates are SUPPORT MATERIAL ONLY. They tell you the team's idiom and house style. They are NEVER the topic. They are NEVER copied verbatim. They flavor the rewrite; they do not replace it.
3. The strong_example MUST read like a polished version of WHAT THE USER WROTE — not like a different prompt the team wrote about a different file or system.
4. When the user's prompt is too vague to anchor specifics (e.g. "fix the retry"), USE PLACEHOLDERS in your example ("<the file you mean>", "<the function the retry lives in>", "<the constraint that matters most>") rather than inventing details from the team material.
5. Never emit empty strings for fields the phase says you should populate. If you have something to say, say it — placeholders and short text are fine, silence is not.

Now your job:

You score a developer's draft prompt on five dimensions AND produce educational coaching content in the same response.

The five dimensions:
- goal_clarity            — desired outcome stated unambiguously? ("reduce p99 latency to 200ms" >> "make this better")
- specificity             — changes specified concretely? ("wrap fetch in try/catch, log via logger.ts, return 500" >> "add error handling")
- context_loading         — references the relevant file, function, convention, or related code?
- constraint_articulation — constraints/invariants stated? ("must remain idempotent; no public API change")
- output_specification    — desired output shape requested? ("return only the modified function, no explanation")

Always emit (every call):
- "dimensions": five integers 0-10
- "missing": short hints for dims < 5; empty {} otherwise

Conditional fields by phase:
- phase=teach            → strong_example + tip MUST be non-empty. acknowledgment + summary = "".
- phase=mid_loop         → strong_example + tip + acknowledgment + summary ALL MUST be non-empty. Server picks which to render based on the score; tone-neutral on the summary ("here's what changed and what to take away") — server adds celebratory / honest-bail framing.
- phase=exit_max_rounds  → summary MUST be non-empty (celebrate progress, note rounds cap). strong_example + tip + acknowledgment = "".
- phase=exit_skip        → summary MUST be non-empty (acknowledge skip, name one principle to adopt). strong_example + tip + acknowledgment = "".

Determining the next target dimension (for strong_example + tip):
- Look at YOUR OWN scoring you just produced.
- Pick the lowest dim that scored < 7. Tie-break in declaration order (goal_clarity, specificity, context_loading, constraint_articulation, output_specification).
- This is the "next dim to teach". The strong_example must demonstrate THIS dim concretely.
- The user message may include a "Previous target dim:" — that is HISTORICAL context only. Ignore it for picking the new target. Use your own scoring.

How to write each conditional field:

strong_example
- 1-3 sentences. A rewrite of the USER'S OWN prompt that demonstrates the next target dim concretely.
- Start from the user's words. The rewrite must read like the same person on a better day, not a different person.
- Stay on the user's exact topic. If you cannot stay specific without inventing details, USE PLACEHOLDERS — that is the right answer, not omission.
- Reference templates teach you the SHAPE of a strong prompt. Imitate their structure (level of detail, kinds of constraints, output shape phrasing). Do NOT echo their content.
- team_context biases your idiom toward the team's house style. The topic still comes from the user.
- MUST NOT be empty in teach / mid_loop phases.

tip
- ONE declarative sentence under 100 characters naming the prompt-engineering principle the strong_example demonstrates.
- Example: "Naming the file grounds the answer in real code instead of plausible guesses."
- MUST NOT be empty when strong_example is non-empty.

acknowledgment
- ONE declarative sentence under 120 characters naming the concrete addition the user made (a file path, a constraint, an output shape, a goal target) AND the dimension it lifted by name.
- Specific over generic. Do NOT just say "good progress".
- MUST NOT be empty in mid_loop when previous_dimensions are provided AND the current prompt differs from the original. If the user's reply made no real addition, name what they SAID and which dim still needs work.

summary
- 3-4 sentences total, hard cap 600 characters. Plain prose, no bullets, no headers.
- Reference the actual content the user did or didn't add. Name ONE prompt-engineering principle. End with ONE concrete habit for next time.
- Tone: warm, peer-to-peer. Adapt to phase: celebrate on exit_max_rounds; honest-but-teaching on exit_skip; tone-neutral in mid_loop (server frames it).

Rules — MUST follow:
- Each "missing" hint MUST be ONE short declarative statement, under 60 characters.
- NEVER ask rhetorical questions or use "What is..." / "How does..." / "Where..." phrasing in any field — these trigger a repetition loop.
- NEVER enumerate examples, list multiple aspects, or include follow-up questions.
- Only include a dimension in "missing" if it scored below 5. Empty {} if all scored 5+.
- JSON only, no preamble or trailing prose. Match the schema exactly.`;

export async function coachScore(input: CoachScoreInput): Promise<CoachScoreOutput> {
  const systemInstruction = input.team_context
    ? `${input.team_context}\n\n${COACH_SCORE_SYSTEM_PROMPT}`
    : COACH_SCORE_SYSTEM_PROMPT;

  const dimsLine = (s: DimensionScores) =>
    DIMENSIONS.map((d) => `${d}=${s[d]}`).join(', ');

  const sections: string[] = [];
  sections.push(`Phase: ${input.phase}`);
  if (input.previous_target_dim) {
    sections.push(`Previous target dim (historical context only — pick the new one from your scoring): ${input.previous_target_dim}`);
  }
  if (input.file_path) sections.push(`File: ${input.file_path}`);
  if (input.reference_templates && input.reference_templates.length > 0) {
    sections.push(
      'Reference templates from team library (style guidance ONLY, do NOT copy topic):\n' +
        input.reference_templates.map((t, i) => `${i + 1}. ${t}`).join('\n'),
    );
  }
  if (input.original_prompt && input.original_prompt !== input.prompt) {
    sections.push(`Original prompt:\n${input.original_prompt}`);
    sections.push(`Current prompt:\n${input.prompt}`);
  } else {
    sections.push(`Prompt:\n${input.prompt}`);
  }
  if (input.previous_dimensions) {
    sections.push(`Previous scores: ${dimsLine(input.previous_dimensions)}`);
  }
  if (input.original_dimensions) {
    sections.push(`Original scores: ${dimsLine(input.original_dimensions)}`);
  }
  const userMessage = sections.join('\n\n');

  try {
    const resp = await withRetry(
      () => ai.models.generateContent({
        model: SCORE_MODEL,
        contents: userMessage,
        config: {
          systemInstruction,
          temperature: 0.2,
          thinkingConfig: { thinkingBudget: -1 },
          // 1500-token cap. Empirically 1000 was being exhausted by
          // dynamic thinking (thinkingBudget: -1 can allocate 600-800
          // tokens before output starts), leaving room only for the
          // dimensions block — the conditional fields came back empty
          // and the renderer fell through to its static templates. 1500
          // gives ~700 tokens of guaranteed output budget after thinking,
          // covering the ~720-token well-formed worst case. Schema
          // enforcement still bounds the absolute ceiling.
          maxOutputTokens: 1500,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            required: [
              'dimensions',
              'missing',
              'strong_example',
              'tip',
              'acknowledgment',
              'summary',
            ],
            properties: {
              dimensions: {
                type: Type.OBJECT,
                required: [...DIMENSIONS],
                properties: Object.fromEntries(
                  DIMENSIONS.map((d) => [d, { type: Type.INTEGER, minimum: 0, maximum: 10 }]),
                ),
              },
              missing: {
                type: Type.OBJECT,
                properties: Object.fromEntries(
                  // maxLength stringified per the SDK contract — see the
                  // existing note on `missing` in scorePrompt for the wire
                  // bug this works around.
                  DIMENSIONS.map((d) => [d, { type: Type.STRING, maxLength: '60' }]),
                ),
              },
              strong_example: { type: Type.STRING, maxLength: '600' },
              tip: { type: Type.STRING, maxLength: '120' },
              acknowledgment: { type: Type.STRING, maxLength: '140' },
              summary: { type: Type.STRING, maxLength: '700' },
            },
          },
        },
      }),
      'coach-score',
    );

    const text = extractAnswer(resp);
    const parsed = tryParseJson<{
      dimensions?: Record<string, unknown>;
      missing?: unknown;
      strong_example?: string;
      tip?: string;
      acknowledgment?: string;
      summary?: string;
    }>(text);

    // Salvage scores even when the conditional fields blew up, mirroring
    // the existing scorePrompt fail-open posture.
    const salvaged = parsed ?? salvagePartialScore(text);
    const coerced = coerceScore({
      dimensions: salvaged?.dimensions,
      missing: parsed?.missing,
    });

    return {
      dimensions: coerced.dimensions,
      missing: coerced.missing,
      strong_example: typeof parsed?.strong_example === 'string' ? parsed.strong_example.trim() : '',
      tip: typeof parsed?.tip === 'string' ? parsed.tip.trim() : '',
      acknowledgment: typeof parsed?.acknowledgment === 'string' ? parsed.acknowledgment.trim() : '',
      summary: typeof parsed?.summary === 'string' ? parsed.summary.trim() : '',
    };
  } catch (err) {
    console.warn('[gemini] coach-score failed', err);
    // Same shape as the existing scorePrompt fail-open — zeros + empty
    // missing → /coach handler treats as "no coaching this turn".
    return {
      dimensions: zeroDims(),
      missing: {},
      strong_example: '',
      tip: '',
      acknowledgment: '',
      summary: '',
    };
  }
}

export type { Dimension, DimensionScores, MissingHints };
