// Integration tests for the Gemini wrapper — the 4,500-line backend's only
// path to an LLM, and until now the only major module in the repo with zero
// tests. That gap is exactly why the `tracedGenerate` self-recursion
// (gemini.ts:57) shipped to production: it was type-valid, so `tsc --noEmit`
// and CI stayed green while every single LLM call died with a RangeError
// before it ever reached the network.
//
// These tests stub `globalThis.fetch`, so nothing here touches the real
// Gemini API or needs a key that works. The stub is the whole point: it
// proves a request actually reaches the transport layer, which is precisely
// what infinite recursion prevents.
//
// Run: npm --workspace=apps/api test

import test from 'node:test';
import assert from 'node:assert/strict';
import { DIMENSIONS } from '@trailhead/shared';

// GEMINI_API_KEY must be set before the first call (the client is created
// lazily and throws without it). The value is a placeholder: every request in
// this file is intercepted by the fetch stub, so it is never sent anywhere and
// is not a credential. Dynamic import kept so the assignment provably runs
// first.
process.env.GEMINI_API_KEY ??= 'test-key-not-a-real-credential';
const { extractTopic, generateText, overallScore, scorePrompt, scoreSamplingConfig } = await import('./gemini.ts');

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  body: unknown;
}

/**
 * Swap globalThis.fetch for a recorder that returns a canned Gemini
 * generateContent response body. Returns the recorded calls plus a restore().
 */
function withFetchStub(
  responder: (call: FetchCall) => unknown,
): { calls: FetchCall[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    let body: unknown;
    try {
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    } catch {
      body = init?.body;
    }
    const call: FetchCall = { url: String(input), init, body };
    calls.push(call);
    const payload = responder(call);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Shape a Gemini generateContent response around a single text part. */
function geminiTextResponse(text: string, usage?: Record<string, number>) {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: usage ?? {
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      totalTokenCount: 150,
    },
  };
}

const WELL_FORMED_SCORE = JSON.stringify({
  dimensions: {
    goal_clarity: 8,
    specificity: 6,
    context_loading: 4,
    constraint_articulation: 9,
    output_specification: 3,
  },
  missing: {
    constraint_articulation: 'no libraries ruled out',
    output_specification: 'no success criterion given',
  },
});

// ---------------------------------------------------------------------------
// The regression test for the blocker. Before the fix, `tracedGenerate` called
// itself instead of `ai.models.generateContent`, so this test would fail with
// "Maximum call stack size exceeded" and `calls.length` would be 0 — the
// request never left the process.
// ---------------------------------------------------------------------------
test('scorePrompt returns all five dimensions from a well-formed model response', async () => {
  const stub = withFetchStub(() => geminiTextResponse(WELL_FORMED_SCORE));
  try {
    const result = await scorePrompt({ prompt: 'fix the retry logic' });

    // Five dimensions, all present, all integers in 0..10.
    assert.equal(
      Object.keys(result.dimensions).length,
      5,
      'expected exactly five scored dimensions',
    );
    assert.equal(DIMENSIONS.length, 5);
    for (const d of DIMENSIONS) {
      const v = result.dimensions[d];
      assert.equal(typeof v, 'number', `${d} should be a number`);
      assert.ok(Number.isInteger(v), `${d} should be an integer`);
      assert.ok(v >= 0 && v <= 10, `${d}=${v} should be within 0..10`);
    }

    assert.deepEqual(result.dimensions, {
      goal_clarity: 8,
      specificity: 6,
      context_loading: 4,
      constraint_articulation: 9,
      output_specification: 3,
    });

    // The missing-hint block survives the isCleanHint filter.
    assert.equal(result.missing.constraint_articulation, 'no libraries ruled out');
    assert.equal(result.missing.output_specification, 'no success criterion given');

    // The point of the whole exercise: exactly one request actually reached
    // the transport. Infinite recursion produces zero.
    assert.equal(stub.calls.length, 1, 'expected exactly one HTTP request to Gemini');
    assert.match(stub.calls[0]!.url, /generativelanguage\.googleapis\.com/);
    assert.match(stub.calls[0]!.url, /gemini-3-flash-preview/);
  } finally {
    stub.restore();
  }
});

test('scorePrompt sends the prompt and the five-dimension responseSchema on the wire', async () => {
  const stub = withFetchStub(() => geminiTextResponse(WELL_FORMED_SCORE));
  try {
    await scorePrompt({ prompt: 'add a webhook handler', file_path: 'src/api/hooks.ts' });
    const body = stub.calls[0]!.body as {
      contents?: unknown;
      generationConfig?: { responseSchema?: { properties?: { dimensions?: { required?: string[] } } } };
    };
    const wire = JSON.stringify(body);
    assert.ok(wire.includes('add a webhook handler'), 'prompt must reach the model');
    assert.ok(wire.includes('src/api/hooks.ts'), 'file_path must reach the model');
    const required = body.generationConfig?.responseSchema?.properties?.dimensions?.required;
    assert.deepEqual(
      [...(required ?? [])].sort(),
      [...DIMENSIONS].sort(),
      'responseSchema must require all five dimensions',
    );
  } finally {
    stub.restore();
  }
});

test('scorePrompt prepends team_context to the system instruction', async () => {
  const stub = withFetchStub(() => geminiTextResponse(WELL_FORMED_SCORE));
  try {
    await scorePrompt({ prompt: 'refactor the queue', team_context: 'TEAM CONVENTIONS: use pg pools' });
    const wire = JSON.stringify(stub.calls[0]!.body);
    assert.ok(wire.includes('TEAM CONVENTIONS: use pg pools'));
  } finally {
    stub.restore();
  }
});

test('scorePrompt salvages the dimensions block from truncated JSON', async () => {
  // The 2026-04-26 repetition failure mode: `missing` loops until
  // maxOutputTokens, so the object never closes — but `dimensions` landed
  // first and is intact.
  const truncated =
    '{\n  "dimensions": {"goal_clarity": 7, "specificity": 2, "context_loading": 5, ' +
    '"constraint_articulation": 6, "output_specification": 1},\n  "missing": {"context_loading": "The prompt does not specify';
  const stub = withFetchStub(() => geminiTextResponse(truncated));
  try {
    const result = await scorePrompt({ prompt: 'make it faster' });
    assert.equal(result.dimensions.goal_clarity, 7);
    assert.equal(result.dimensions.output_specification, 1);
    assert.equal(Object.keys(result.dimensions).length, 5);
  } finally {
    stub.restore();
  }
});

test('scorePrompt fails closed to all-zero dimensions on unparseable output', async () => {
  const stub = withFetchStub(() => geminiTextResponse('I am afraid I cannot do that.'));
  try {
    const result = await scorePrompt({ prompt: 'do the thing' });
    for (const d of DIMENSIONS) assert.equal(result.dimensions[d], 0);
    // Empty `missing` + all-zero is the fingerprint /coach uses to detect
    // "the model failed" as distinct from "a genuinely terrible prompt".
    assert.deepEqual(result.missing, {});
  } finally {
    stub.restore();
  }
});

test('extractTopic reaches the network and returns the parsed topic', async () => {
  const stub = withFetchStub(() => geminiTextResponse(JSON.stringify({ topic: 'retry' })));
  try {
    assert.equal(await extractTopic('the fetch keeps failing on 503'), 'retry');
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('overallScore averages the five dimensions', () => {
  assert.equal(
    overallScore({
      goal_clarity: 8,
      specificity: 6,
      context_loading: 4,
      constraint_articulation: 9,
      output_specification: 3,
    }),
    6, // 30 / 5
  );
});

// ---------------------------------------------------------------------------
// Sampling overrides (TRAILHEAD_SCORE_TEMPERATURE / _THINKING_BUDGET) — what
// the eval harness varies. Defaults must stay what production has used.
// ---------------------------------------------------------------------------
test('scoreSamplingConfig: production defaults, valid overrides, junk ignored', () => {
  assert.deepEqual(scoreSamplingConfig({}), { temperature: 0.2, thinkingBudget: -1 });
  assert.deepEqual(
    scoreSamplingConfig({ TRAILHEAD_SCORE_TEMPERATURE: '0', TRAILHEAD_SCORE_THINKING_BUDGET: '512' }),
    { temperature: 0, thinkingBudget: 512 },
  );
  assert.deepEqual(
    scoreSamplingConfig({ TRAILHEAD_SCORE_TEMPERATURE: 'hot', TRAILHEAD_SCORE_THINKING_BUDGET: '-5' }),
    { temperature: 0.2, thinkingBudget: -1 },
  );
  assert.equal(scoreSamplingConfig({ TRAILHEAD_SCORE_TEMPERATURE: '3' }).temperature, 0.2);
});

test('scorePrompt sends the configured temperature and thinking budget', async () => {
  process.env.TRAILHEAD_SCORE_TEMPERATURE = '0';
  process.env.TRAILHEAD_SCORE_THINKING_BUDGET = '256';
  const stub = withFetchStub(() => geminiTextResponse(WELL_FORMED_SCORE));
  try {
    await scorePrompt({ prompt: 'sampling check' });
    const cfg = (stub.calls[0]!.body as { generationConfig?: { temperature?: number; thinkingConfig?: { thinkingBudget?: number } } }).generationConfig;
    assert.equal(cfg?.temperature, 0);
    assert.equal(cfg?.thinkingConfig?.thinkingBudget, 256);
  } finally {
    stub.restore();
    delete process.env.TRAILHEAD_SCORE_TEMPERATURE;
    delete process.env.TRAILHEAD_SCORE_THINKING_BUDGET;
  }
});

// The rich wiki bootstrap (wiki-bootstrap-job.ts) used to build its own
// GoogleGenAI client, so its calls skipped the retry policy and never showed
// up in Langfuse. It now goes through generateText.
test('generateText sends one request through the shared client and does not cap long-form answers', async () => {
  const narrative = 'x'.repeat(12_000); // a folder narrative is several thousand words
  const stub = withFetchStub(() => geminiTextResponse(JSON.stringify({ narrative_md: narrative })));
  try {
    const text = await generateText({ model: 'gemini-3-flash-preview', contents: 'document src/' }, 'folder(src/)');
    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0]!.url, /generativelanguage\.googleapis\.com/);
    // The short structured answers are capped at 4 000 chars; this must not be.
    assert.equal(JSON.parse(text).narrative_md.length, 12_000);
  } finally {
    stub.restore();
  }
});

// Rich-bootstrap prompts carry the team's source files. With Langfuse on they
// must not be copied into traces: only sizes and usage.
test('generateText keeps the prompt and answer out of the Langfuse trace', async () => {
  const { withTrace } = await import('./langfuse.ts');
  const generations: { start: Record<string, unknown>; end?: Record<string, unknown> }[] = [];
  const fakeTrace = {
    generation(start: Record<string, unknown>) {
      const g: { start: Record<string, unknown>; end?: Record<string, unknown> } = { start };
      generations.push(g);
      return { end: (e: Record<string, unknown>) => { g.end = e; } };
    },
  };
  const SECRET_SOURCE = 'const apiKey = "sk-source-line-that-must-not-be-traced";';
  const stub = withFetchStub(() => geminiTextResponse(JSON.stringify({ narrative_md: `quotes ${SECRET_SOURCE}` })));
  try {
    // withTrace takes a LangfuseTraceClient; only generation() is used here.
    await withTrace(fakeTrace as never, () =>
      generateText({ model: 'gemini-3-flash-preview', contents: `=== src/a.ts ===\n${SECRET_SOURCE}` }, 'file(src/a.ts)'),
    );
    assert.equal(generations.length, 1);
    const traced = JSON.stringify(generations[0]);
    assert.ok(!traced.includes('sk-source-line'), traced);
    assert.match(traced, /"chars":\d+/);
  } finally {
    stub.restore();
  }
});

test('request-path calls still trace their prompt (only bootstrap is redacted)', async () => {
  const { withTrace } = await import('./langfuse.ts');
  const starts: Record<string, unknown>[] = [];
  const fakeTrace = { generation(start: Record<string, unknown>) { starts.push(start); return { end() {} }; } };
  const stub = withFetchStub(() => geminiTextResponse(WELL_FORMED_SCORE));
  try {
    await withTrace(fakeTrace as never, () => scorePrompt({ prompt: 'fix the retry logic' }));
    assert.match(JSON.stringify(starts[0]), /fix the retry logic/);
  } finally {
    stub.restore();
  }
});
