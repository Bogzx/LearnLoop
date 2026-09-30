// user_id the MCP server stamps on /coach calls. Replaces the shared 'demo'
// id every install used to send (which made per-user skill arcs and /coach's
// "prefer someone else's example" ordering meaningless).
//
// Same privacy model as the browser and VS Code extensions:
//   1. TRAILHEAD_USER_ID       explicit override (any string)
//   2. TRAILHEAD_SHARE_USER_ID=false → 'anonymous' (opt-out)
//   3. a random UUID generated once per machine user and kept in
//      $XDG_CONFIG_HOME/trailhead/user-id (default ~/.config/trailhead/user-id).
//      Not derived from the account, hostname or git identity.
// If the file can't be read or written, fall back to 'anonymous' rather than
// failing the tool call.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const ANONYMOUS_USER_ID = 'anonymous';

export function userIdFile(env = process.env) {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(base, 'trailhead', 'user-id');
}

export function resolveUserId(env = process.env) {
  if (env.TRAILHEAD_USER_ID && env.TRAILHEAD_USER_ID.trim()) return env.TRAILHEAD_USER_ID.trim();
  if (env.TRAILHEAD_SHARE_USER_ID === 'false') return ANONYMOUS_USER_ID;
  const file = userIdFile(env);
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch {
    /* not created yet */
  }
  try {
    const id = randomUUID();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${id}\n`, { mode: 0o600 });
    return id;
  } catch {
    return ANONYMOUS_USER_ID;
  }
}
