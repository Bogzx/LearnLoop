import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiffResponse } from './diff-parse.ts';

const validUser = {
  prompt: 'fix the retry',
  overall: 4,
  dimensions: {
    goal_clarity: 8,
    specificity: 4,
    context_loading: 2,
    constraint_articulation: 1,
    output_specification: 3,
  },
};
const validTeam = {
  prompt: 'in src/api/webhooks/handler.ts retry idempotently with jitter',
  overall: 9,
  dimensions: {
    goal_clarity: 9,
    specificity: 9,
    context_loading: 9,
    constraint_articulation: 9,
    output_specification: 9,
  },
  node_path: 'src/api/webhooks/',
  topic: 'retry',
};

test('parses a fully-formed diff response', () => {
  const out = parseDiffResponse({
    user: validUser,
    team: validTeam,
    narrative: 'You missed context_loading.',
  });
  assert.ok(out);
  assert.equal(out.narrative, 'You missed context_loading.');
});

test('handles missing narrative field by returning empty string', () => {
  const out = parseDiffResponse({ user: validUser, team: validTeam });
  assert.ok(out);
  assert.equal(out.narrative, '');
});

test('returns null when user is missing', () => {
  assert.equal(parseDiffResponse({ team: validTeam }), null);
});

test('returns null when team is missing', () => {
  assert.equal(parseDiffResponse({ user: validUser }), null);
});

test('returns null on non-object input', () => {
  assert.equal(parseDiffResponse(null), null);
  assert.equal(parseDiffResponse(undefined), null);
  assert.equal(parseDiffResponse('error'), null);
});
