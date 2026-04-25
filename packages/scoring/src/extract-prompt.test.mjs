import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExtractResponse } from './extract-prompt.mjs';

test('parses the no-learning shape', () => {
  const r = parseExtractResponse('{"learning": null}');
  assert.deepEqual(r, { learning: null });
});

test('parses a real learning shape', () => {
  const r = parseExtractResponse(
    '{"learning":{"node_path":"src/api/webhooks/","insight":"Use exponential backoff with jitter."}}',
  );
  assert.deepEqual(r, {
    learning: {
      node_path: 'src/api/webhooks/',
      insight: 'Use exponential backoff with jitter.',
    },
  });
});

test('strips markdown fences around the JSON', () => {
  const raw = '```json\n{"learning": null}\n```';
  assert.deepEqual(parseExtractResponse(raw), { learning: null });
});

test('handles a leading "Here is the JSON:" preamble', () => {
  const raw = 'Here is the JSON:\n{"learning": null}';
  assert.deepEqual(parseExtractResponse(raw), { learning: null });
});

test('appends trailing slash to node_path if missing', () => {
  const r = parseExtractResponse(
    '{"learning":{"node_path":"src/api","insight":"x"}}',
  );
  assert.equal(r.learning?.node_path, 'src/api/');
});

test('drops malformed JSON (returns no-learning)', () => {
  assert.deepEqual(parseExtractResponse('not json'), { learning: null });
  assert.deepEqual(parseExtractResponse(''), { learning: null });
  assert.deepEqual(parseExtractResponse('{broken'), { learning: null });
});

test('drops shapes missing required fields', () => {
  assert.deepEqual(
    parseExtractResponse('{"learning":{"node_path":"src/"}}'),
    { learning: null },
  );
  assert.deepEqual(
    parseExtractResponse('{"learning":{"insight":"x"}}'),
    { learning: null },
  );
  assert.deepEqual(
    parseExtractResponse('{"learning":{"node_path":"","insight":"x"}}'),
    { learning: null },
  );
});

test('drops non-string types in fields', () => {
  assert.deepEqual(
    parseExtractResponse('{"learning":{"node_path":42,"insight":"x"}}'),
    { learning: null },
  );
});
