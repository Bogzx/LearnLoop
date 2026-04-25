// Pure logic for translating a stream of /wiki/recent items into toast lines.
// Lives in its own module so we can unit-test without spinning up VS Code.
import type { WikiRecentItem } from './api.ts';

export type ToastKind = 'created' | 'reinforced' | 'promoted';

export interface Toast {
  kind: ToastKind;
  item: WikiRecentItem;
  text: string;
}

// Diff a snapshot against the previous one, emitting one toast per item that
// changed in a user-visible way:
// - new id          → created
// - count went up   → reinforced (or promoted, if status flipped to durable)
//
// Ignored: items whose count stayed the same. Promotion-without-count-change
// is unusual but folded into reinforced for safety.
export function diffWikiItems(
  prev: Map<string, WikiRecentItem>,
  next: WikiRecentItem[],
): Toast[] {
  const toasts: Toast[] = [];
  for (const item of next) {
    const before = prev.get(item.id);
    if (!before) {
      toasts.push({ kind: 'created', item, text: createdText(item) });
      continue;
    }
    if (item.reinforcement_count > before.reinforcement_count) {
      const justPromoted = before.status === 'draft' && item.status === 'durable';
      const kind: ToastKind = justPromoted ? 'promoted' : 'reinforced';
      toasts.push({ kind, item, text: changeText(item, kind) });
    }
  }
  return toasts;
}

export function truncate(s: string, n = 80): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function createdText(item: WikiRecentItem): string {
  return `Wiki updated: «${truncate(item.body)}» — created (${item.node_path})`;
}

function changeText(item: WikiRecentItem, kind: ToastKind): string {
  if (kind === 'promoted') {
    return `Wiki updated: «${truncate(item.body)}» — reinforced ${item.reinforcement_count}/3, promoted to durable`;
  }
  return `Wiki updated: «${truncate(item.body)}» — reinforced ×${item.reinforcement_count}`;
}

// Update a state map in place after a poll cycle.
export function applyWikiSnapshot(
  prev: Map<string, WikiRecentItem>,
  next: WikiRecentItem[],
): Map<string, WikiRecentItem> {
  for (const item of next) prev.set(item.id, item);
  return prev;
}

// Compute the next ISO timestamp to send as `since` — the max last_seen_at
// across the snapshot, or the previous value if nothing changed.
export function maxSince(items: WikiRecentItem[], current: string): string {
  let best = current;
  for (const item of items) {
    if (item.last_seen_at > best) best = item.last_seen_at;
  }
  return best;
}
