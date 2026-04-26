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

// Sanity check on a single missing-hint string. The score system prompt
// requires "ONE absence per hint, under 60 chars" but Flash 2.5 sometimes
// crams hints for multiple dimensions into one slot or glues token salad
// around dim names ("overjoyedcontext_loading" in 2026-04-26 logs). Returns
// false when the hint looks corrupt — caller drops it, keeping the dim
// score and falling back to the static teach template.
//
// Length cap matches the system-prompt rule (60 chars). Cross-field bleed
// is detected by checking for any other dim's snake_case name as a
// substring; well-formed prose hints don't contain those identifiers.
function isCleanHint(value: string, slot: Dimension): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.length > 60) return false;
  for (const other of DIMENSIONS) {
    if (other !== slot && trimmed.includes(other)) return false;
  }
  return true;
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
      if (typeof v !== 'string') continue;
      if (isCleanHint(v, d)) {
        missing[d] = v.trim();
      } else if (v.trim()) {
        console.warn(`[gemini] score dropped corrupt hint for ${d}: ${v.slice(0, 80)}`);
      }
    }
  } else if (Array.isArray(obj.missing)) {
    const lowDims = DIMENSIONS.filter((d) => dimensions[d] < 5);
    obj.missing.forEach((entry, i) => {
      const d = lowDims[i];
      if (!d || typeof entry !== 'string') return;
      if (isCleanHint(entry, d)) {
        missing[d] = entry.trim();
      } else if (entry.trim()) {
        console.warn(`[gemini] score dropped corrupt hint for ${d}: ${entry.slice(0, 80)}`);
      }
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
}): Promise<{ rewritten_prompt: string; tip: string }> {
  if (args.target_dims.length === 0) {
    return { rewritten_prompt: args.prompt, tip: '' };
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
          // Bumped 400 → 500 to make headroom for the new `tip` field
          // without crowding the rewrite. Schema enforcement still bounds
          // the worst case; the tip is hard-capped at 100 chars in-prompt.
          maxOutputTokens: 500,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            required: ['rewritten_prompt', 'tip'],
            properties: {
              rewritten_prompt: { type: Type.STRING },
              // maxLength stringified per the SDK contract — see the note
              // on `missing` in the score schema for the wire bug this
              // works around.
              tip: { type: Type.STRING, maxLength: '120' },
            },
          },
        },
      }),
      'teach-rewrite',
    );
    const parsed = tryParseJson<{ rewritten_prompt?: string; tip?: string }>(extractAnswer(resp));
    const rewritten = typeof parsed?.rewritten_prompt === 'string'
      ? parsed.rewritten_prompt.trim()
      : '';
    const tip = typeof parsed?.tip === 'string' ? parsed.tip.trim() : '';
    // Empty strings → callers fall back to the static template / no tip.
    // We don't throw because /coach is the never-block path: render the
    // block without an example or tip rather than blowing up the turn.
    return { rewritten_prompt: rewritten, tip };
  } catch (err) {
    console.warn('[gemini] teach-rewrite failed', err);
    return { rewritten_prompt: '', tip: '' };
  }
}

// ----- /coach round-2+ acknowledgment ---------------------------------------
// Gemini-generated one-liner that names the user's most recent edit and the
// dimension it lifted. Used to prepend recognition before the next teach
// block in the round 2+ "still <7, made progress, more rounds remain"
// branch. Fail-open: empty string → renderTeachBlock falls back to the
// existing static "You addressed X" line.
//
// Same guardrail discipline as the rest: Flash + responseSchema +
// thinkingBudget=-1 + maxOutputTokens cap + the no-retry-on-timeout policy.
const ACKNOWLEDGE_SYSTEM_PROMPT = `You acknowledge a developer's improvement to their prompt in ONE short sentence (under 120 characters).

You receive: their previous prompt, their current prompt, the per-dimension scores before and after, and the list of dimensions whose scores increased. Name the concrete addition they made AND the dimension it lifted. Specific > generic.

Return JSON only, no prose:
{ "acknowledgment": <string> }

Rules — MUST follow:
- ONE sentence, under 120 characters. No bullets, no list, no follow-up question.
- Reference the actual change (a file path, a constraint, an output shape they added) — do NOT just say "good progress".
- Mention the dimension that improved by name.
- Tone: warm, peer-to-peer. Avoid corporate phrasing.
- NEVER ask a question. NEVER use "What about..." / "How does...".
- If no dimension improved, return an empty string for "acknowledgment".`;

export async function acknowledgeProgress(args: {
  previous_prompt: string;
  current_prompt: string;
  previous_dimensions: DimensionScores;
  current_dimensions: DimensionScores;
}): Promise<string> {
  // Compute the dim deltas client-side so the model gets a clean signal
  // and can't hallucinate which dim moved.
  const improved = DIMENSIONS
    .map((d) => ({ d, delta: args.current_dimensions[d] - args.previous_dimensions[d] }))
    .filter((x) => x.delta > 0)
    .sort((a, b) => b.delta - a.delta);
  if (improved.length === 0) return '';

  const dimsLine = (s: DimensionScores) =>
    DIMENSIONS.map((d) => `${d}=${s[d]}`).join(', ');

  const userMessage =
    `Previous prompt:\n${args.previous_prompt}\n\n` +
    `Current prompt:\n${args.current_prompt}\n\n` +
    `Previous scores: ${dimsLine(args.previous_dimensions)}\n` +
    `Current scores:  ${dimsLine(args.current_dimensions)}\n` +
    `Dimensions that improved: ${improved.map((x) => `${x.d} (+${x.delta})`).join(', ')}`;

  try {
    const resp = await withRetry(
      () => ai.models.generateContent({
        model: SCORE_MODEL,
        contents: userMessage,
        config: {
          systemInstruction: ACKNOWLEDGE_SYSTEM_PROMPT,
          temperature: 0.3,
          thinkingConfig: { thinkingBudget: -1 },
          maxOutputTokens: 200,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            required: ['acknowledgment'],
            properties: {
              acknowledgment: { type: Type.STRING, maxLength: '140' },
            },
          },
        },
      }),
      'acknowledge',
    );
    const parsed = tryParseJson<{ acknowledgment?: string }>(extractAnswer(resp));
    return typeof parsed?.acknowledgment === 'string' ? parsed.acknowledgment.trim() : '';
  } catch (err) {
    console.warn('[gemini] acknowledge failed', err);
    return '';
  }
}

// ----- /coach end-of-session summary ----------------------------------------
// Gemini-written closing recap appended to renderSuccessReveal /
// renderSkipReveal. Frames the arc as a mini-lesson: what improved, the
// principle the user practiced, one takeaway for next time. Used in success,
// no-progress, skip, and max-rounds forced-exit branches; tone adapts to
// `reason` so the no-progress / skip cases stay honest instead of
// celebrating something that didn't happen.
const SUMMARIZE_SYSTEM_PROMPT = `You write a short closing recap (3-4 sentences total) of a developer's prompt-coaching session.

You receive: the original prompt, the final prompt, scores before/after, and the reason the session ended (success / max_rounds / no_progress / skip). Adapt the tone:
- success / max_rounds — celebrate the moves they made and name the prompt-engineering principle they practiced.
- no_progress / skip — acknowledge they bailed, but call out what they could have added; teach the principle they missed.

Return JSON only, no prose:
{ "summary": <string> }

Rules — MUST follow:
- 3-4 sentences total. Hard cap: 600 characters. No bullets, no headers, no preamble like "Here's a recap:".
- Reference the actual content (file paths, constraints, output shapes) the user did or didn't add. Specific > generic.
- Name ONE prompt-engineering principle (e.g. "anchoring with file paths", "naming invariants up front", "specifying output shape"). Do not list more than one.
- End with ONE concrete takeaway for next time, phrased as a habit, not as a question.
- Tone: warm, peer-to-peer, like a senior dev recapping a session at the desk.
- NEVER ask a question. NEVER list alternatives. NEVER use "What if..." / "How could...".`;

export async function summarizeCoaching(args: {
  original_prompt: string;
  final_prompt: string;
  original_dimensions: DimensionScores;
  final_dimensions: DimensionScores;
  reason: 'success' | 'max_rounds' | 'no_progress' | 'skip';
}): Promise<string> {
  const dimsLine = (s: DimensionScores) =>
    DIMENSIONS.map((d) => `${d}=${s[d]}`).join(', ');

  const userMessage =
    `Reason: ${args.reason}\n\n` +
    `Original prompt:\n${args.original_prompt}\n\n` +
    `Final prompt:\n${args.final_prompt}\n\n` +
    `Original scores: ${dimsLine(args.original_dimensions)}\n` +
    `Final scores:    ${dimsLine(args.final_dimensions)}`;

  try {
    const resp = await withRetry(
      () => ai.models.generateContent({
        model: SCORE_MODEL,
        contents: userMessage,
        config: {
          systemInstruction: SUMMARIZE_SYSTEM_PROMPT,
          temperature: 0.3,
          thinkingConfig: { thinkingBudget: -1 },
          // 600-char hard cap in the prompt; 600 tokens is a generous
          // ceiling that bounds runaway output without clipping a
          // well-formed recap.
          maxOutputTokens: 600,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            required: ['summary'],
            properties: {
              summary: { type: Type.STRING, maxLength: '700' },
            },
          },
        },
      }),
      'summarize',
    );
    const parsed = tryParseJson<{ summary?: string }>(extractAnswer(resp));
    return typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
  } catch (err) {
    console.warn('[gemini] summarize failed', err);
    return '';
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

export type { Dimension, DimensionScores, MissingHints };
