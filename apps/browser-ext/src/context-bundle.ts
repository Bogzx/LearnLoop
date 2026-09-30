// Renders the team's wiki subtree (rooted at the user-selected context path)
// as a markdown bundle that gets prepended to Claude.ai sends. Cache is
// eager so send-intercept can read the rendered string synchronously —
// refetch happens whenever the path or team changes.
//
// Subtree filter is `node.path.startsWith(selectedPath)`. We walk every
// matching node and emit body_md + durable learnings, fenced as untrusted
// team content (fenceUntrusted) so Claude treats it as reference data, not
// as the user's prompt.

import type { WikiTreeNode } from '@trailhead/shared';
import { fenceUntrusted, UNTRUSTED_NOTE } from '@trailhead/scoring/fence';
import { TRAILHEAD_ERROR_TAG } from './config.ts';
import { wikiTree } from './api.ts';
import { getContextPath, subscribeContext } from './context-state.ts';
import { getTeamToken } from './team-state.ts';

let cachedBundle: string | null = null;
// Composite key so a team-switch invalidates the cache even if the path
// string didn't change (different team, same 'src/' prefix, different wiki).
let cachedKey: string | null = null;
let inflightFetch: Promise<void> | null = null;

function makeKey(path: string): string {
  return `${getTeamToken()}\u0000${path}`;
}

export function getCachedContextBundle(): string | null {
  const path = getContextPath();
  if (!path) return null;
  if (cachedKey !== makeKey(path)) return null;
  return cachedBundle;
}

function renderBundle(nodes: WikiTreeNode[]): string {
  const blocks: string[] = [];
  for (const n of nodes) {
    const lines: string[] = [`# ${n.path}`];
    const body = n.body_md.trim();
    if (body) lines.push(body);
    if (n.durable_learnings.length > 0) {
      lines.push('', '## Durable learnings');
      for (const l of n.durable_learnings) {
        lines.push(`- ${l.body}`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  // The bundle is prepended to the user's Claude.ai message, so team-authored
  // text is fenced and preceded by the rule that it is reference data
  // (packages/scoring/src/fence.mjs) — a wiki learning must not read to Claude
  // as the user's own instructions.
  return `${UNTRUSTED_NOTE}\n\n${fenceUntrusted(blocks.join('\n\n'), 'team_wiki')}`;
}

/** True when `text` already starts with a context bundle (current or the
 *  pre-2026-09-30 `<team_context>` form), so it is never prepended twice. */
export function hasContextBundle(text: string): boolean {
  return text.startsWith(UNTRUSTED_NOTE) || text.startsWith('<team_context>');
}

async function refreshBundle(): Promise<void> {
  const path = getContextPath();
  if (!path) {
    cachedBundle = null;
    cachedKey = null;
    return;
  }
  const key = makeKey(path);
  if (cachedKey === key && cachedBundle) return;

  if (inflightFetch) {
    await inflightFetch;
    return;
  }
  inflightFetch = (async () => {
    try {
      // Through the service worker like every API call (api.ts); null on any
      // failure, already logged there.
      const data = await wikiTree();
      if (!data) return;
      // Root sentinel: the popup persists '/' for the repo-root node
      // (path = '' would silently no-op the truthy "is context active"
      // checks). For subtree filtering, '/' means "match every node".
      const filterPrefix = path === '/' ? '' : path;
      const subtree = data.nodes.filter((n) => n.path.startsWith(filterPrefix));
      if (subtree.length === 0) {
        console.warn(`${TRAILHEAD_ERROR_TAG} no nodes under ${path} — context bundle empty`);
        cachedBundle = null;
        cachedKey = key;
        return;
      }
      cachedBundle = renderBundle(subtree);
      cachedKey = key;
      console.info(
        `${TRAILHEAD_ERROR_TAG} context bundle ready: ${subtree.length} node(s), ${cachedBundle.length} chars`,
      );
    } catch (err) {
      console.warn(`${TRAILHEAD_ERROR_TAG} context bundle build failed`, err);
    } finally {
      inflightFetch = null;
    }
  })();
  await inflightFetch;
}

export function initContextBundle(): void {
  // Refetch whenever the chosen path changes (popup picked a new node, or
  // user cleared it). Drop the existing cache immediately so a stale
  // bundle never gets injected after a switch.
  subscribeContext(() => {
    cachedBundle = null;
    cachedKey = null;
    void refreshBundle();
  });
  // Eager initial fetch in case a path was already in storage at startup.
  void refreshBundle();
}
