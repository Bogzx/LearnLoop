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
  TEACH_SYSTEM_PROMPT,
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

// ----- /coach teach-rewrite (used by /coach when no team graduated prompt fits) ----
//
// Asks Gemini to rewrite the user's draft prompt so it scores 9+ on each
// named target dimension while preserving topic and intent. Single Flash
// call with responseSchema enforcing { rewritten_prompt: string }; same
// guardrails as scorePrompt (maxOutputTokens cap, dynamic thinking,
// schema-only output).
//
// Used by:
//   - the teach block (when target_dims.length === 1) — one strong example
//     for the dimension being taught
//   - the skip-style reveal (when target_dims is the list of dims that
//     scored < 5 on the original) — one rewrite that would have lifted them
//     all
export async function rewriteForDims(args: {
  prompt: string;
  target_dims: Dimension[];
  file_path?: string;
  team_context?: string;
}): Promise<{ rewritten_prompt: string }> {
  if (args.target_dims.length === 0) {
    return { rewritten_prompt: args.prompt };
  }

  const systemInstruction = args.team_context
    ? `${args.team_context}\n\n${TEACH_SYSTEM_PROMPT}`
    : TEACH_SYSTEM_PROMPT;

  const userMessage =
    `${args.file_path ? `File context: ${args.file_path}\n\n` : ''}` +
    `Target dimensions to improve: ${args.target_dims.join(', ')}\n\n` +
    `Original prompt:\n${args.prompt}`;

  try {
    const resp = await withRetry(
      () => ai.models.generateContent({
        model: SCORE_MODEL,
        contents: userMessage,
        config: {
          systemInstruction,
          temperature: 0.3,
          thinkingConfig: { thinkingBudget: -1 },
          maxOutputTokens: 400,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            required: ['rewritten_prompt'],
            properties: {
              rewritten_prompt: { type: Type.STRING },
            },
          },
        },
      }),
      'teach-rewrite',
    );
    const parsed = tryParseJson<{ rewritten_prompt?: string }>(extractAnswer(resp));
    const rewritten = typeof parsed?.rewritten_prompt === 'string'
      ? parsed.rewritten_prompt.trim()
      : '';
    // Empty string → caller falls back to a hardcoded line. We don't throw
    // because /coach is the never-block path: render the block without an
    // example rather than blowing up the whole coaching turn.
    return { rewritten_prompt: rewritten };
  } catch (err) {
    console.warn('[gemini] teach-rewrite failed', err);
    return { rewritten_prompt: '' };
  }
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
        `Write 2-3 sentences naming the specific dimensions the user fell short on ` +
        `and what the team prompt did differently. No bullets, no preamble.`,
      config: { temperature: 0.2 },
    }),
    'diff',
  );
  return extractAnswer(resp);
}

// ----- /improve --------------------------------------------------------------
// Gemini-driven multi-turn prompt coach. Stateless — caller passes the full
// conversation each turn. Spec: 2026-04-26-improve-widget-design.md
const IMPROVE_SYSTEM_PROMPT = `You are a senior engineer's prompt coach. The user is about to send a prompt to Claude. Your job is to ask one focused follow-up question that would meaningfully raise the prompt's quality on the listed weak dimensions, OR — if you already have enough information — return the polished prompt.

Rules:
- One question per turn. Keep it concrete: file path, expected output shape, constraints, current code location.
- Stop asking once you have enough to write a strong final prompt. Don't pad the conversation.
- The polished prompt must preserve the user's original intent. Add specificity, do not invent requirements the user didn't imply.
- Output JSON matching the schema exactly. No prose outside the JSON.

If the command is "finalize", you MUST return kind="final" regardless of how much information you have. Synthesize the best polished prompt you can from what's available.`;

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

export type { Dimension, DimensionScores, MissingHints };
