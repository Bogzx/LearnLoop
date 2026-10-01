// TRAILHEAD_DEMO_TEAM: whether the seeded public demo team can authenticate.
//
//   on | true     always
//   off | false   never (its public secret gets 401 demo_team_disabled)
//   unset / ''    on, unless TRAILHEAD_ADMIN_TOKEN is set — an admin token is
//                 the sign of a networked deploy, where anyone could write to
//                 the demo team and spend the operator's Gemini quota
//
// Anything else is a configuration error: index.ts refuses to start, rather
// than guessing what "0" or "no" meant. Read per call, so tests can flip it.

const ON = new Set(['on', 'true']);
const OFF = new Set(['off', 'false']);

export function demoTeamConfigError(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.TRAILHEAD_DEMO_TEAM;
  if (v === undefined || v === '' || ON.has(v) || OFF.has(v)) return null;
  return `TRAILHEAD_DEMO_TEAM must be "on" or "off" (or unset for the default); got "${v}"`;
}

export function demoTeamEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.TRAILHEAD_DEMO_TEAM;
  if (v === undefined || v === '') return !env.TRAILHEAD_ADMIN_TOKEN;
  // An unknown value is rejected at startup; should one appear later, fail closed.
  return ON.has(v);
}
