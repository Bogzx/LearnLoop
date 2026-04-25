import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractFromTranscript,
  extractTurn,
  shouldSkip,
  runHook,
} from '../trailhead-hook.lib.mjs';

test('extractTurn handles direct payload', () => {
  const r = extractTurn({ user_prompt: 'u', assistant_response: 'a' });
  assert.equal(r.user_prompt, 'u');
  assert.equal(r.assistant_response, 'a');
});

test('extractTurn returns null for empty payload', () => {
  assert.equal(extractTurn(null), null);
  assert.equal(extractTurn({}), null);
});

test('extractFromTranscript reads JSONL with role/content shape', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trailhead-hook-'));
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(
    path,
    [
      JSON.stringify({ role: 'user', content: 'first user message' }),
      JSON.stringify({ role: 'assistant', content: 'first assistant message' }),
      JSON.stringify({ role: 'user', content: 'latest user message' }),
      JSON.stringify({ role: 'assistant', content: 'latest assistant message' }),
    ].join('\n'),
  );
  const r = extractFromTranscript(path);
  assert.equal(r.user_prompt, 'latest user message');
  assert.equal(r.assistant_response, 'latest assistant message');
  rmSync(dir, { recursive: true });
});

test('extractFromTranscript handles message.role / message.content nesting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trailhead-hook-'));
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(
    path,
    [
      JSON.stringify({ message: { role: 'user', content: 'hi' } }),
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'hey' }] } }),
    ].join('\n'),
  );
  const r = extractFromTranscript(path);
  assert.equal(r.user_prompt, 'hi');
  assert.equal(r.assistant_response, 'hey');
  rmSync(dir, { recursive: true });
});

test('extractFromTranscript returns null when file missing', () => {
  assert.equal(extractFromTranscript('/no/such/path.jsonl'), null);
  assert.equal(extractFromTranscript(undefined), null);
});

test('shouldSkip bails on short responses', () => {
  assert.equal(
    shouldSkip({ user_prompt: 'q', assistant_response: 'short' }),
    'response too short',
  );
});

test('shouldSkip allows responses ≥ 80 chars', () => {
  const long = 'a'.repeat(80);
  assert.equal(shouldSkip({ user_prompt: 'q', assistant_response: long }), null);
});

test('runHook bails when API config missing', async () => {
  const r = await runHook({
    apiUrl: '',
    teamToken: '',
    anthropicKey: 'sk-test',
    stdin: '{"user_prompt":"x","assistant_response":"y"}',
  });
  assert.equal(r.skipped, 'config');
});

test('runHook bails on empty stdin', async () => {
  const r = await runHook({
    apiUrl: 'https://example.invalid',
    teamToken: 't',
    anthropicKey: 'sk-test',
    stdin: '',
  });
  assert.equal(r.skipped, 'no-stdin');
});

test('runHook bails on non-JSON stdin', async () => {
  const r = await runHook({
    apiUrl: 'https://example.invalid',
    teamToken: 't',
    anthropicKey: 'sk-test',
    stdin: 'not json',
  });
  assert.equal(r.skipped, 'bad-json');
});

test('runHook bails on short response', async () => {
  const r = await runHook({
    apiUrl: 'https://example.invalid',
    teamToken: 't',
    anthropicKey: 'sk-test',
    stdin: JSON.stringify({ user_prompt: 'q', assistant_response: 'short' }),
  });
  assert.equal(r.skipped, 'response too short');
});

test('runHook skips when ANTHROPIC_API_KEY missing', async () => {
  const r = await runHook({
    apiUrl: 'https://example.invalid',
    teamToken: 't',
    anthropicKey: '',
    stdin: JSON.stringify({
      user_prompt: 'q',
      assistant_response: 'a'.repeat(120),
    }),
  });
  assert.equal(r.skipped, 'no-learning');
});
