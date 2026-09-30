// Per-install user id — replaces the hardcoded `user_id: 'demo'` every
// browser user used to send, which made per-user skill arcs, the dashboard's
// active-user count, and /coach's "prefer someone else's example" ordering
// meaningless for browser traffic.
//
// Privacy choice (default ON, opt-out in the popup):
//   - The id is a random UUID generated on first run and kept in
//     chrome.storage.local. It is not derived from the Claude account, the
//     machine, or anything else; reinstalling the extension makes a new one.
//   - It lets the team's server group this install's scores over time
//     (GET /skill-arc?user_id=…, "active users" on the dashboard). Anyone
//     holding the team secret can read those per-id scores.
//   - Opting out sends the fixed id 'anonymous' instead: scores still count
//     toward team totals but can't be told apart from other opted-out users.
//     The stored UUID is kept, so opting back in resumes the same history.

export const USER_ID_KEY = 'trailhead.userId';
export const SHARE_USER_ID_KEY = 'trailhead.shareUserId';
export const ANONYMOUS_USER_ID = 'anonymous';

export interface StoredUserState {
  id?: unknown;
  share?: unknown;
}

/** Pure resolution, unit-tested. `generate` makes a fresh UUID. Returns the
 *  id to persist (null = nothing to write) and the id to send. */
export function resolveUserState(
  stored: StoredUserState,
  generate: () => string,
): { persistId: string | null; share: boolean; effective: string } {
  const existing = typeof stored.id === 'string' && stored.id.length > 0 ? stored.id : null;
  const id = existing ?? generate();
  const share = stored.share !== false;
  return { persistId: existing ? null : id, share, effective: share ? id : ANONYMOUS_USER_ID };
}

let effectiveId = ANONYMOUS_USER_ID;

/** The user_id to stamp on API calls. 'anonymous' until storage has loaded
 *  or when the user opted out. */
export function getUserId(): string {
  return effectiveId;
}

function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

export function initUserState(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const local = (chrome as any)?.storage?.local;
      if (typeof local?.get !== 'function') return resolve();
      local.get([USER_ID_KEY, SHARE_USER_ID_KEY], (out: Record<string, unknown>) => {
        const r = resolveUserState({ id: out?.[USER_ID_KEY], share: out?.[SHARE_USER_ID_KEY] }, newUuid);
        if (r.persistId) local.set({ [USER_ID_KEY]: r.persistId });
        effectiveId = r.effective;
        resolve();
      });
      (chrome as any)?.storage?.onChanged?.addListener?.(
        (changes: Record<string, unknown>, area: string) => {
          if (area !== 'local' || !(USER_ID_KEY in changes || SHARE_USER_ID_KEY in changes)) return;
          local.get([USER_ID_KEY, SHARE_USER_ID_KEY], (out: Record<string, unknown>) => {
            effectiveId = resolveUserState({ id: out?.[USER_ID_KEY], share: out?.[SHARE_USER_ID_KEY] }, newUuid).effective;
          });
        },
      );
    } catch {
      // chrome.* unavailable — stay anonymous.
      resolve();
    }
  });
}
