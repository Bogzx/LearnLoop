// Cached, synchronously-readable view of the popup-controlled coaching
// toggle. Subscribes to chrome.storage.onChanged so flipping the switch
// in the popup takes effect on the live tab without a reload.
//
// Storage key: 'trailhead.coachingEnabled' — boolean, default true.
//   true  → extension intercepts sends as normal (default)
//   false → send-intercept early-returns; user's chat behaves as if
//           Trailhead weren't installed (other features like badges and
//           wiki toasts continue to render in the background)

declare const chrome: typeof globalThis extends { chrome: infer C } ? C : any;

export const COACHING_KEY = 'trailhead.coachingEnabled';

let coachingEnabled = true;

export function isCoachingEnabled(): boolean {
  return coachingEnabled;
}

export function initCoachingState(): void {
  try {
    const get = (chrome as any)?.storage?.local?.get;
    if (typeof get !== 'function') return;
    get.call((chrome as any).storage.local, COACHING_KEY, (out: Record<string, unknown>) => {
      // Default: undefined → enabled. Only an explicit `false` disables.
      coachingEnabled = out[COACHING_KEY] !== false;
    });
    const onChanged = (chrome as any)?.storage?.onChanged?.addListener;
    if (typeof onChanged !== 'function') return;
    onChanged.call(
      (chrome as any).storage.onChanged,
      (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area !== 'local') return;
        if (!(COACHING_KEY in changes)) return;
        const v = changes[COACHING_KEY]?.newValue;
        coachingEnabled = v !== false;
        console.info('[trailhead] coaching toggled →', coachingEnabled ? 'on' : 'off');
      },
    );
  } catch {
    // chrome.* unavailable in test environments — leave default.
  }
}
