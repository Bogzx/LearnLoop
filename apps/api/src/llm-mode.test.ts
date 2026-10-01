import test from 'node:test';
import assert from 'node:assert/strict';
import { llmConfigError, llmMode } from './llm-mode.ts';

test('Gemini is the default; offline only when asked for by name', () => {
  assert.equal(llmMode({}), 'gemini');
  assert.equal(llmMode({ TRAILHEAD_LLM: 'gemini' }), 'gemini');
  assert.equal(llmMode({ TRAILHEAD_LLM: 'offline' }), 'offline');
});

test('no key and no TRAILHEAD_LLM is an error, never a silent switch to offline', () => {
  assert.match(llmConfigError({})!, /GEMINI_API_KEY not set.*TRAILHEAD_LLM=offline/);
  assert.equal(llmConfigError({ GEMINI_API_KEY: 'k' }), null);
  assert.equal(llmConfigError({ TRAILHEAD_LLM: 'offline' }), null);
  assert.equal(llmConfigError({ TRAILHEAD_LLM: 'offline', GEMINI_API_KEY: 'k' }), null);
  assert.match(llmConfigError({ TRAILHEAD_LLM: 'gpt', GEMINI_API_KEY: 'k' })!, /must be "gemini" or "offline"/);
});
