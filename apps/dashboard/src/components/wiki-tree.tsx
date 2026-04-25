'use client';

// /wiki tree. Shows every node in the team's wiki with its body_md,
// durable learnings (highlighted), and draft learnings (de-emphasized).
// No collapse/expand — for the demo seed (~5 nodes), scrolling is fine
// and the audience reads the full tree at a glance.

import useSWR from 'swr';
import type { WikiTreeNode, WikiTreeResponse } from '@trailhead/shared';
import { api } from '@/lib/api';

// Indent is purely visual — each leading path segment maps to one level.
function depthOf(path: string): number {
  // Root is path '' or '/'; src/ = 1; src/api/ = 2; etc.
  if (!path || path === '/' || path === '') return 0;
  return path.replace(/\/$/, '').split('/').filter(Boolean).length;
}

function NodeBlock({ node }: { node: WikiTreeNode }) {
  const depth = depthOf(node.path);
  const indent = { paddingLeft: `${depth * 1.25}rem` };

  return (
    <div style={indent} className="border-l border-border pl-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm">{node.path || '/'}</span>
        {node.durable_learnings.length > 0 && (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-400">
            {node.durable_learnings.length} durable
          </span>
        )}
        {node.draft_learnings.length > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {node.draft_learnings.length} draft
          </span>
        )}
      </div>
      {node.body_md && (
        <pre className="mt-2 whitespace-pre-wrap rounded border border-border bg-background/40 p-3 text-xs text-muted-foreground">
          {node.body_md}
        </pre>
      )}
      {node.durable_learnings.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {node.durable_learnings.map((l) => (
            <li
              key={l.id}
              className="flex items-start gap-2 text-sm text-foreground"
            >
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              <span>
                <span className="font-mono text-xs text-muted-foreground">
                  ({l.reinforcement_count}×)
                </span>{' '}
                {l.body}
              </span>
            </li>
          ))}
        </ul>
      )}
      {node.draft_learnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {node.draft_learnings.map((l) => (
            <li
              key={l.id}
              className="flex items-start gap-2 text-xs italic text-muted-foreground"
            >
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
              <span>
                <span className="font-mono">({l.reinforcement_count}×)</span>{' '}
                {l.body}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WikiTree() {
  const { data, error, isLoading } = useSWR<WikiTreeResponse>(
    'wiki-tree',
    () => api.wikiTree(),
    { refreshInterval: 30_000, revalidateOnFocus: true },
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[120px] animate-pulse rounded border border-border bg-card" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-rose-400">
        Failed to load wiki: {String((error as Error)?.message ?? 'unknown')}
      </div>
    );
  }

  if (!data.nodes.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No wiki nodes yet. Run the seed script or have Claude Code call
        wiki_save to populate the tree.
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-lg border border-border bg-card p-5">
      {data.nodes.map((node) => (
        <NodeBlock key={node.path} node={node} />
      ))}
    </div>
  );
}
