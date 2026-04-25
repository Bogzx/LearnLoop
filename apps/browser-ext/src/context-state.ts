// Cached, synchronously-readable view of the popup-controlled "Select
// context" picker. Mirrors team-state.ts: read once on init, then keep
// in sync via chrome.storage.onChanged so picking a context node in the
// popup takes effect on the live tab without a reload.
//
// Storage key: 'trailhead.selectedContextPath' — string path that the
// user picked from the wiki tree (e.g., 'src/api/'). Empty/unset means
// no context is active. Subtree filter is `path.startsWith(stored)`.

export const CONTEXT_PATH_KEY = 'trailhead.selectedContextPath';

let currentPath: string | null = null;
const subscribers = new Set<(path: string | null) => void>();

export function getContextPath(): string | null {
  return currentPath;
}

export function subscribeContext(cb: (path: string | null) => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function notify(): void {
  for (const cb of subscribers) {
    try {
      cb(currentPath);
    } catch {
      /* swallow — one bad subscriber can't break the others */
    }
  }
}

export function initContextState(): void {
  try {
    const get = (chrome as any)?.storage?.local?.get;
    if (typeof get !== 'function') return;
    get.call((chrome as any).storage.local, CONTEXT_PATH_KEY, (out: Record<string, unknown>) => {
      const stored = out[CONTEXT_PATH_KEY];
      if (typeof stored === 'string' && stored) {
        currentPath = stored;
        notify();
        console.info('[trailhead] context path loaded from storage:', currentPath);
      }
    });
    const onChanged = (chrome as any)?.storage?.onChanged?.addListener;
    if (typeof onChanged !== 'function') return;
    onChanged.call(
      (chrome as any).storage.onChanged,
      (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area !== 'local' || !(CONTEXT_PATH_KEY in changes)) return;
        const v = changes[CONTEXT_PATH_KEY]?.newValue;
        currentPath = typeof v === 'string' && v ? v : null;
        notify();
        console.info('[trailhead] context path changed →', currentPath ?? '(cleared)');
      },
    );
  } catch {
    // chrome.* unavailable — leave default null.
  }
}
