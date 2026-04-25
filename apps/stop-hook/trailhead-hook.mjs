#!/usr/bin/env node
// Claude Code Stop hook — the deterministic backstop for the autonomous wiki
// update path. Fires after every assistant turn. Reads the hook payload from
// stdin, extracts the most recent user prompt + assistant response, asks
// Haiku 4.5 whether the turn contains a teamwide convention worth saving,
// and POSTs to /wiki/propose if so. Server-side dedup keeps this idempotent
// against the MCP path.
//
// HARD INVARIANTS (roadmap §5):
// - Errors NEVER propagate. The whole body is wrapped in try/catch and logs
//   to ~/.trailhead-hook.log only. A crash here = silent demo failure.
// - Hook fires on every turn. Bail fast on short responses to save Haiku $.
// - Config comes entirely from env (set in ~/.claude/settings.json hook entry).
//
// TESTING: extract logic + IO are split into trailhead-hook.lib.mjs so we can
// unit-test without spawning a process.
import { runHook } from './trailhead-hook.lib.mjs';

runHook({
  apiUrl: process.env.TRAILHEAD_API_URL,
  teamToken: process.env.TRAILHEAD_TEAM_TOKEN,
  anthropicKey: process.env.ANTHROPIC_API_KEY,
}).then((result) => {
  // Always exit 0. Hook errors should never reach the user.
  process.exit(0);
}).catch(() => {
  process.exit(0);
});
