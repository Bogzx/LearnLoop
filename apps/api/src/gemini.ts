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

// ----- /score ----------------------------------------------------------------
export interface ScoreModelResult {
  dimensions: DimensionScores;
  missing: MissingHints;
}

export async function scorePrompt(args: { prompt: string; file_path?: string }): Promise<ScoreModelResult> {
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
  // worst case. A well-formed response is ~150 tokens; 500 is plenty of
  // headroom while capping worst-case at ~3x normal.
  if (SCORE_MODEL.startsWith('gemini-')) {
    const resp = await withRetry(
      () => ai.models.generateContent({
        model: SCORE_MODEL,
        contents: buildScoreUserPrompt(args),
        config: {
          systemInstruction: SCORE_SYSTEM_PROMPT,
          temperature: 0.2,
          thinkingConfig: { thinkingBudget: -1 },
          maxOutputTokens: 500,
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
    // Parse failure → return zeros and let the caller fail-open. NEVER
    // fall through to a second LLM call (the previous fallthrough doubled
    // cost on every bad response, see 2026-04-25 incident).
    return coerceScore(parsed ?? { dimensions: zeroDims(), missing: {} });
  }

  // Non-Flash model path — used only if SCORE_MODEL is changed in
  // packages/scoring/src/models.mjs to a Gemma-family model that has no
  // schema enforcement. Single attempt; same fail-closed posture.
  const resp = await withRetry(
    () => ai.models.generateContent({
      model: SCORE_MODEL,
      contents:
        `${SCORE_SYSTEM_PROMPT}\n\n${buildScoreUserPrompt(args)}\n\n` +
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
