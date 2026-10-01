import test from 'node:test';
import assert from 'node:assert/strict';
import { demoTeamConfigError, demoTeamEnabled } from './demo-team.ts';

test('on by default, off once an admin token is set, an explicit value wins', () => {
  assert.equal(demoTeamEnabled({}), true);
  assert.equal(demoTeamEnabled({ TRAILHEAD_ADMIN_TOKEN: 'x' }), false);
  assert.equal(demoTeamEnabled({ TRAILHEAD_ADMIN_TOKEN: 'x', TRAILHEAD_DEMO_TEAM: 'on' }), true);
  assert.equal(demoTeamEnabled({ TRAILHEAD_DEMO_TEAM: 'off' }), false);
  assert.equal(demoTeamEnabled({ TRAILHEAD_DEMO_TEAM: 'true' }), true);
  assert.equal(demoTeamEnabled({ TRAILHEAD_DEMO_TEAM: 'false' }), false);
});

test('unknown values are a startup error, and fail closed if they slip through', () => {
  for (const v of ['0', '1', 'no', 'yes', 'OFF', 'disabled']) {
    assert.match(demoTeamConfigError({ TRAILHEAD_DEMO_TEAM: v })!, /must be "on" or "off"/, v);
    assert.equal(demoTeamEnabled({ TRAILHEAD_DEMO_TEAM: v }), false, v);
  }
  for (const v of [undefined, '', 'on', 'off', 'true', 'false']) {
    assert.equal(demoTeamConfigError({ TRAILHEAD_DEMO_TEAM: v }), null, String(v));
  }
});
