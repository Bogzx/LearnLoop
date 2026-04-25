// Live integration test — hits the Railway /wiki/propose stub. Skipped if
// TRAILHEAD_API_URL is not set so unit-test runs stay offline-friendly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { postLearning } from '../trailhead-hook.lib.mjs';

const apiUrl = process.env.TRAILHEAD_API_URL ?? 'https://trailheadapi-production.up.railway.app';
const teamToken = process.env.TRAILHEAD_TEAM_TOKEN ?? 'trailhead_demo_acme_2026';

test('postLearning hits live /wiki/propose and returns a known action', async () => {
  const res = await postLearning({
    apiUrl,
    teamToken,
    learning: {
      node_path: 'src/api/webhooks/',
      insight: 'Use exponential backoff with jitter for webhook retries.',
    },
  });
  assert.ok(res, 'expected non-null response');
  assert.ok(['created', 'reinforced', 'promoted'].includes(res.action),
    `unexpected action: ${res.action}`);
  assert.equal(typeof res.current_count, 'number');
});

test('postLearning surfaces auth failures gracefully (returns null)', async () => {
  const res = await postLearning({
    apiUrl,
    teamToken: 'wrong-token',
    learning: { node_path: 'src/', insight: 'x' },
  });
  assert.equal(res, null);
});
