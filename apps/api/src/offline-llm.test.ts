// The no-model provider (TRAILHEAD_LLM=offline): it must answer every call
// the routes make, with no network access at all.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { DimensionScores } from '@trailhead/shared';
import { heuristicScore } from '@trailhead/scoring';
import * as offline from './offline-llm.ts';
import { TOPIC_VALUES } from './gemini.ts';

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (() => assert.fail('offline mode must not touch the network')) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

const dims = (o: Partial<DimensionScores>): DimensionScores => ({
  goal_clarity: 5, specificity: 5, context_loading: 5, constraint_articulation: 5, output_specification: 5, ...o,
});

test('scorePrompt is the rule-based scorer', async () => {
  const p = 'Add retries to src/api/webhooks/handler.ts. It must stay idempotent. Return only the diff.';
  assert.deepEqual(await offline.scorePrompt({ prompt: p, team_context: 'ignored' }), heuristicScore(p));
});

test('LLM-written text is empty, so /coach falls back to its static templates', async () => {
  assert.deepEqual(await offline.rewriteForDims({ prompt: 'x', target_dims: ['goal_clarity'] }), { rewritten_prompt: '', tip: '' });
  assert.equal(await offline.acknowledgeProgress({ previous_prompt: 'a', current_prompt: 'b', previous_dimensions: dims({}), current_dimensions: dims({ goal_clarity: 9 }) }), '');
  assert.equal(await offline.summarizeCoaching({ original_prompt: 'a', final_prompt: 'b', original_dimensions: dims({}), final_dimensions: dims({}), reason: 'success' }), '');
});

test('topics come from keyword rules and are always valid topic values', async () => {
  assert.equal(await offline.extractTopic('fix the webhook retry loop'), 'webhook');
  assert.equal(await offline.extractTopic('add exponential backoff to the client'), 'retry');
  assert.equal(await offline.extractTopic('reduce p99 latency'), 'performance');
  assert.equal(await offline.extractTopic('hello'), 'other');
  for (const p of ['jwt login', 'write a migration', 'log the request id', 'add a unit test', 'refactor it', 'zod validation']) {
    assert.ok((TOPIC_VALUES as readonly string[]).includes(await offline.extractTopic(p)), p);
  }
  assert.deepEqual(await offline.extractPathAndTopic('In src/api/auth/login.ts add rate limiting'), { path: 'src/api/auth/login.ts', topic: 'auth' });
  assert.deepEqual(await offline.extractPathAndTopic('hello'), { path: null, topic: null });
});

test('the /diff narrative names the dimension with the biggest gap', async () => {
  const text = await offline.synthesizeDiff({
    user_prompt: 'fix it',
    user_scores: dims({ constraint_articulation: 1 }),
    team_prompt: 'In x.ts ... must stay idempotent',
    team_scores: dims({ constraint_articulation: 9 }),
  });
  assert.match(text, /constraints.*9\/10.*1\/10/i);
});

test('/improve asks one static question per weak dimension, then appends the answers', async () => {
  const input = {
    original_prompt: 'fix the retry',
    missing: { context_loading: 'no file', output_specification: 'no format' },
    history: [] as { role: 'assistant' | 'user'; text: string }[],
    command: 'next' as const,
  };
  const q1 = await offline.improveCoach(input);
  assert.equal(q1.kind, 'question');
  assert.match(q1.kind === 'question' ? q1.text : '', /Context loading/);
  input.history.push({ role: 'assistant', text: 'q1' }, { role: 'user', text: 'src/lib/retry.ts' });
  const q2 = await offline.improveCoach(input);
  assert.match(q2.kind === 'question' ? q2.text : '', /Output shape/);
  input.history.push({ role: 'assistant', text: 'q2' }, { role: 'user', text: 'only the diff' });
  const done = await offline.improveCoach(input);
  assert.equal(done.kind, 'final');
  assert.equal(done.kind === 'final' && done.polished, 'fix the retry\n\nContext: src/lib/retry.ts\nOutput: only the diff');
  // finalize early: whatever was answered so far
  const early = await offline.improveCoach({ ...input, history: input.history.slice(0, 2), command: 'finalize' });
  assert.equal(early.kind === 'final' && early.polished, 'fix the retry\n\nContext: src/lib/retry.ts');
});

test('/improve without client-supplied weak dimensions asks about the rule-based ones', async () => {
  const q = await offline.improveCoach({ original_prompt: 'fix it', missing: {}, history: [], command: 'next' });
  assert.equal(q.kind, 'question');
  assert.match(q.kind === 'question' ? q.text : '', /Goal clarity/);
});

test('the rich bootstrap is unavailable offline', async () => {
  await assert.rejects(() => offline.generateText(), /needs an LLM/);
});
