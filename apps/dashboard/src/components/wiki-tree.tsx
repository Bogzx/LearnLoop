'use client';

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import useSWR from 'swr';
import type {
  WikiTreeNode,
  WikiTreePrompt,
  WikiTreeResponse,
} from '@trailhead/shared';
import { api } from '@/lib/api';

function normalize(path: string): string {
  if (!path || path === '/' || path === '') return '';
  return path.replace(/\/$/, '');
}

function nodeName(path: string): string {
  if (!path) return '/';
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '/';
}

type Tree = {
  byPath: Map<string, WikiTreeNode>;
  children: Map<string, string[]>;
};

function buildTree(nodes: WikiTreeNode[]): Tree {
  const byPath = new Map<string, WikiTreeNode>();
  for (const n of nodes) byPath.set(normalize(n.path), n);
  const children = new Map<string, string[]>();
  children.set('', []);
  for (const n of nodes) {
    const np = normalize(n.path);
    if (np === '') continue;
    const parts = np.split('/').filter(Boolean);
    parts.pop();
    const parent = parts.join('/');
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(np);
  }
  for (const arr of children.values()) arr.sort();
  return { byPath, children };
}

const NODE_W = 200;
const NODE_H = 64;
const LEVEL_Y = 130;
const LEAF_X = 230;

type Layout = {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
};

function layoutTree2D(tree: Tree, rootPath = ''): Layout {
  const positions = new Map<string, { x: number; y: number }>();

  function leafCount(path: string): number {
    const kids = tree.children.get(path) ?? [];
    if (!kids.length) return 1;
    return kids.reduce((s, c) => s + leafCount(c), 0);
  }

  function place(path: string, depth: number, xStart: number) {
    const kids = tree.children.get(path) ?? [];
    if (!kids.length) {
      positions.set(path, { x: xStart, y: depth * LEVEL_Y });
      return;
    }
    let cursor = xStart;
    for (const c of kids) {
      const w = leafCount(c) * LEAF_X;
      place(c, depth + 1, cursor);
      cursor += w;
    }
    const childXs = kids.map((c) => positions.get(c)!.x);
    const cx = childXs.reduce((s, n) => s + n, 0) / childXs.length;
    positions.set(path, { x: cx, y: depth * LEVEL_Y });
  }
  place(rootPath, 0, 0);

  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const padX = NODE_W / 2 + 40;
  const width = maxX - minX + padX * 2;
  const height = maxY + NODE_H + 80;
  const offsetX = -minX + padX;
  const offsetY = 40;
  for (const [k, v] of positions) {
    positions.set(k, { x: v.x + offsetX, y: v.y + offsetY });
  }
  return { positions, width, height };
}

const LAYER_COLORS = [
  'hsl(348 83% 65%)', // 0 root — rose
  'hsl(199 89% 60%)', // 1 — sky
  'hsl(45 93% 60%)',  // 2 — amber
  'hsl(262 83% 70%)', // 3 — violet
  'hsl(142 76% 56%)', // 4 — green
  'hsl(20 90% 65%)',  // 5+ — orange
];

// Depth = number of slash-separated segments. Root ('') is 0.
function pathDepth(path: string): number {
  if (!path) return 0;
  return path.split('/').filter(Boolean).length;
}

function layerColorFor(path: string): string {
  return LAYER_COLORS[Math.min(pathDepth(path), LAYER_COLORS.length - 1)]!;
}

// 'hsl(348 83% 65%)' → 'hsl(348 83% 65% / 0.22)'.
function withAlpha(hslColor: string, alpha: number): string {
  return hslColor.replace(/\)$/, ` / ${alpha})`);
}

// Breadcrumb segments for a path. Each segment carries its display label and
// the cumulative path used to compute its layer color (so 'src' is depth 1,
// 'src/api' is depth 2, etc.). The root chip is always present.
function pathSegments(path: string): Array<{ label: string; cumulative: string }> {
  const segs: Array<{ label: string; cumulative: string }> = [
    { label: '/', cumulative: '' },
  ];
  if (!path) return segs;
  const parts = path.split('/').filter(Boolean);
  let acc = '';
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p;
    segs.push({ label: p, cumulative: acc });
  }
  return segs;
}

const STEP_MS = 320;

function Tree2D({
  tree,
  selected,
  onSelect,
}: {
  tree: Tree;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const layout = useMemo(() => layoutTree2D(tree, ''), [tree]);
  const { positions, width, height } = layout;
  const [hovered, setHovered] = useState<string | null>(null);
  const [animTick, setAnimTick] = useState(0);
  useEffect(() => {
    setAnimTick((t) => t + 1);
  }, [selected]);

  const edges: Array<{
    from: string;
    to: string;
    p0: { x: number; y: number };
    p1: { x: number; y: number };
  }> = [];
  for (const [path, kids] of tree.children) {
    const p0 = positions.get(path);
    if (!p0) continue;
    for (const c of kids) {
      const p1 = positions.get(c);
      if (!p1) continue;
      edges.push({ from: path, to: c, p0, p1 });
    }
  }

  const depthFromRoot = useMemo(() => {
    const m = new Map<string, number>();
    const queue: Array<[string, number]> = [['', 0]];
    while (queue.length) {
      const [p, d] = queue.shift()!;
      if (m.has(p)) continue;
      m.set(p, d);
      const kids = tree.children.get(p) ?? [];
      for (const k of kids) queue.push([k, d + 1]);
    }
    return m;
  }, [tree]);

  function layerColor(path: string): string {
    const d = depthFromRoot.get(path) ?? 0;
    return LAYER_COLORS[Math.min(d, LAYER_COLORS.length - 1)];
  }

  function nodeFill(path: string): string {
    if (path === selected) return 'hsl(217.2 32.6% 17.5%)';
    if (path === hovered) return 'hsl(217.2 32.6% 14%)';
    return 'hsl(222.2 84% 6%)';
  }
  function nodeStroke(path: string): string {
    if (path === selected) return 'hsl(142 76% 56%)';
    return layerColor(path);
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4" style={{ overflow: 'auto' }}>
      <svg width={width} height={height} style={{ display: 'block', minWidth: '100%' }}>
        <defs>
          <style>{`
            @keyframes drawEdge {
              from { stroke-dashoffset: var(--len); }
              to   { stroke-dashoffset: 0; }
            }
            @keyframes flowParticle {
              from { stroke-dashoffset: 0; }
              to   { stroke-dashoffset: calc(var(--len) * -1); }
            }
            @keyframes fadeIn {
              to { opacity: 1; }
            }
          `}</style>
        </defs>

        {edges.map(({ from, to, p0, p1 }) => {
          const x1 = p0.x;
          const y1 = p0.y + NODE_H / 2;
          const x2 = p1.x;
          const y2 = p1.y - NODE_H / 2;
          const mid = (y1 + y2) / 2;
          const d = `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
          return (
            <path
              key={`base-${from}->${to}`}
              d={d}
              fill="none"
              stroke="hsl(217.2 32.6% 28%)"
              strokeWidth={1.4}
              opacity={0.6}
            />
          );
        })}

        {selected != null && (() => {
          const chain: Array<{ child: string; parent: string; step: number }> = [];
          let cur = selected;
          let step = 0;
          while (cur !== '') {
            const parts = cur.split('/').filter(Boolean);
            parts.pop();
            const parent = parts.join('/');
            chain.push({ child: cur, parent, step });
            cur = parent;
            step++;
          }
          const trailColor = layerColor(selected);
          return chain.map(({ child, parent, step }) => {
            const cp = positions.get(child);
            const pp = positions.get(parent);
            if (!cp || !pp) return null;
            const x1 = pp.x;
            const y1 = pp.y + NODE_H / 2;
            const x2 = cp.x;
            const y2 = cp.y - NODE_H / 2;
            const mid = (y1 + y2) / 2;
            const d = `M ${x2} ${y2} C ${x2} ${mid}, ${x1} ${mid}, ${x1} ${y1}`;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.round(Math.hypot(dx, dy) * 1.25 + 60);
            const delay = step * STEP_MS;

            const drawStyle: CSSProperties = {
              ['--len' as never]: `${len}px`,
              strokeDasharray: 'var(--len)',
              strokeDashoffset: 'var(--len)',
              animation: `drawEdge 380ms ease-out ${delay}ms forwards`,
              filter: `drop-shadow(0 0 6px ${trailColor})`,
            };
            const particleStyle: CSSProperties = {
              ['--len' as never]: `${len}px`,
              strokeDasharray: `14 ${len - 14}`,
              strokeDashoffset: 0,
              opacity: 0,
              animation: `flowParticle 1100ms linear ${delay + 380}ms infinite, fadeIn 200ms ease-out ${delay + 380}ms forwards`,
              filter: `drop-shadow(0 0 8px ${trailColor})`,
            };

            return (
              <g key={`up-${animTick}-${child}->${parent}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={trailColor}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  style={drawStyle}
                />
                <path
                  d={d}
                  fill="none"
                  stroke={trailColor}
                  strokeWidth={3}
                  strokeLinecap="round"
                  style={particleStyle}
                />
              </g>
            );
          });
        })()}

        {[...positions.entries()].map(([path, pos]) => {
          const node = tree.byPath.get(path);
          const isSelected = path === selected;
          const isHovered = path === hovered;
          const x = pos.x - NODE_W / 2;
          const y = pos.y - NODE_H / 2;
          const dur = node ? node.durable_learnings.length : 0;
          const dft = node ? node.draft_learnings.length : 0;
          const prm = node ? node.graduated_prompts.length : 0;
          const badges: Array<{ key: string; label: string; fg: string; bg: string }> = [];
          if (dur > 0) badges.push({ key: 'd', label: `${dur}d`, fg: 'hsl(152 76% 56%)', bg: 'hsla(152 76% 50% / 0.18)' });
          if (dft > 0) badges.push({ key: 'r', label: `${dft}r`, fg: 'hsl(215 20% 65%)', bg: 'hsla(215 20% 65% / 0.18)' });
          if (prm > 0) badges.push({ key: 'p', label: `${prm}p`, fg: 'hsl(45 93% 60%)', bg: 'hsla(45 93% 50% / 0.18)' });
          const BADGE_W = 24;
          const BADGE_H = 16;
          const BADGE_GAP = 4;
          const label = nodeName(path);

          return (
            <g
              key={path || '/'}
              onClick={() => onSelect(path)}
              onMouseEnter={() => setHovered(path)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}
              transform={`translate(${x}, ${y})`}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={10}
                ry={10}
                fill={nodeFill(path)}
                stroke={nodeStroke(path)}
                strokeWidth={isSelected ? 2 : 1.25}
                style={{
                  transition: 'fill 200ms, stroke 200ms, stroke-width 200ms',
                  filter:
                    isSelected || isHovered
                      ? 'drop-shadow(0 4px 14px rgba(0,0,0,0.5))'
                      : 'none',
                }}
              />
              <rect
                x={0}
                y={0}
                width={4}
                height={NODE_H}
                rx={2}
                ry={2}
                fill={layerColor(path)}
              />
              <text
                x={16}
                y={26}
                fill="hsl(210 40% 98%)"
                fontFamily="ui-monospace, Menlo, monospace"
                fontSize="13"
                fontWeight="600"
              >
                {label}
              </text>
              <text
                x={16}
                y={46}
                fill="hsl(215 20% 65%)"
                fontFamily="ui-monospace, Menlo, monospace"
                fontSize="10"
              >
                {path || '(root)'}
              </text>
              {badges.map((b, bi) => {
                // Right-aligned row, leftmost badge first in array.
                const idxFromRight = badges.length - 1 - bi;
                const x = NODE_W - 14 - BADGE_W - idxFromRight * (BADGE_W + BADGE_GAP);
                return (
                  <g key={b.key} transform={`translate(${x}, ${NODE_H - 22})`}>
                    <rect width={BADGE_W} height={BADGE_H} rx={8} ry={8} fill={b.bg} />
                    <text
                      x={BADGE_W / 2}
                      y={11}
                      textAnchor="middle"
                      fill={b.fg}
                      fontFamily="ui-monospace, Menlo, monospace"
                      fontSize="10"
                      fontWeight="600"
                    >
                      {b.label}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ancestorChain(tree: Tree, selectedPath: string): WikiTreeNode[] {
  const paths: string[] = [];
  let cur = selectedPath;
  while (true) {
    paths.push(cur);
    if (cur === '') break;
    const parts = cur.split('/').filter(Boolean);
    parts.pop();
    cur = parts.join('/');
  }
  paths.reverse();
  return paths
    .map((p) => tree.byPath.get(p))
    .filter((n): n is WikiTreeNode => !!n);
}

function DetailPanel({
  tree,
  selectedPath,
}: {
  tree: Tree;
  selectedPath: string | null;
}) {
  if (selectedPath == null) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
        style={{ minHeight: 160 }}
      >
        Click any node to view its rules and learnings.
      </div>
    );
  }
  const selected = tree.byPath.get(selectedPath);
  if (!selected) return null;

  const chain = ancestorChain(tree, selectedPath);
  const breadcrumb = pathSegments(selected.path);
  const bodyChain = chain.filter((n) => !!n.body_md);

  type Tagged = {
    id: string;
    path: string;
    body: string;
    reinforcement_count: number;
  };
  type TaggedPrompt = WikiTreePrompt & { path: string };
  const durables: Tagged[] = [];
  const drafts: Tagged[] = [];
  const prompts: TaggedPrompt[] = [];
  for (const n of chain) {
    for (const l of n.durable_learnings) durables.push({ ...l, path: n.path });
    for (const l of n.draft_learnings) drafts.push({ ...l, path: n.path });
    for (const p of n.graduated_prompts) prompts.push({ ...p, path: n.path });
  }

  return (
    <div className="space-y-6 rounded-lg border border-border bg-card p-6">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Path</div>
        <div className="mt-1 flex flex-wrap items-center gap-1 font-mono text-lg">
          {breadcrumb.map((seg, i) => {
            const color = layerColorFor(seg.cumulative);
            return (
              <Fragment key={`${i}-${seg.cumulative}`}>
                {i > 0 && (
                  <span className="text-muted-foreground/50">/</span>
                )}
                <span
                  className="rounded px-1.5 py-0.5"
                  style={{
                    background: withAlpha(color, 0.22),
                    color,
                  }}
                >
                  {seg.label}
                </span>
              </Fragment>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {durables.length > 0 && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-400">
              {durables.length} durable
            </span>
          )}
          {drafts.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {drafts.length} draft
            </span>
          )}
          {prompts.length > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-400">
              {prompts.length} graduated prompt{prompts.length === 1 ? '' : 's'}
            </span>
          )}
          {durables.length === 0 && drafts.length === 0 && prompts.length === 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              no learnings yet
            </span>
          )}
        </div>
      </div>

      {bodyChain.length > 0 && (
        <div>
          <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
            General info
          </div>
          <div className="space-y-3">
            {bodyChain.map((n) => {
              const color = layerColorFor(n.path);
              return (
                <div key={n.path} className="space-y-1.5">
                  <span
                    className="inline-block rounded px-1.5 py-0.5 font-mono text-[11px]"
                    style={{ background: withAlpha(color, 0.22), color }}
                  >
                    {n.path || '/'}
                  </span>
                  <pre
                    className="whitespace-pre-wrap rounded border p-3 text-xs text-muted-foreground"
                    style={{
                      background: withAlpha(color, 0.06),
                      borderColor: withAlpha(color, 0.35),
                    }}
                  >
                    {n.body_md}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {durables.length > 0 && (
        <div>
          <div className="mb-3 text-xs uppercase tracking-wider text-emerald-400">
            Durable learnings
          </div>
          <ul className="space-y-2">
            {durables.map((l) => {
              const color = layerColorFor(l.path);
              return (
                <li
                  key={`${l.path}-${l.id}`}
                  className="flex items-start gap-2 text-sm text-foreground"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                  <span>
                    <span
                      className="rounded px-1 py-0 font-mono text-[10px]"
                      style={{ background: withAlpha(color, 0.22), color }}
                    >
                      {l.path || '/'}
                    </span>{' '}
                    <span className="font-mono text-xs text-muted-foreground">
                      ({l.reinforcement_count}×)
                    </span>{' '}
                    {l.body}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {drafts.length > 0 && (
        <div>
          <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
            Draft learnings
          </div>
          <ul className="space-y-1.5">
            {drafts.map((l) => {
              const color = layerColorFor(l.path);
              return (
                <li
                  key={`${l.path}-${l.id}`}
                  className="flex items-start gap-2 text-xs italic text-muted-foreground"
                >
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: 'hsl(215 20% 65% / 0.4)' }}
                  />
                  <span>
                    <span
                      className="rounded px-1 py-0 font-mono text-[10px] not-italic"
                      style={{ background: withAlpha(color, 0.22), color }}
                    >
                      {l.path || '/'}
                    </span>{' '}
                    <span className="font-mono">({l.reinforcement_count}×)</span>{' '}
                    {l.body}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {prompts.length > 0 && (
        <div>
          <div className="mb-3 text-xs uppercase tracking-wider text-amber-400">
            Graduated prompts
          </div>
          <ul className="space-y-3">
            {prompts.map((p) => {
              const color = layerColorFor(p.path);
              return (
                <li key={`${p.path}-${p.id}`} className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className="rounded px-1.5 py-0.5 font-mono"
                      style={{ background: withAlpha(color, 0.22), color }}
                    >
                      {p.path || '/'}
                    </span>
                    {p.topic && (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
                        {p.topic}
                      </span>
                    )}
                    <span className="font-mono text-muted-foreground">
                      {p.reuse_count}× reused
                    </span>
                  </div>
                  <pre
                    className="whitespace-pre-wrap rounded border p-3 text-xs text-foreground"
                    style={{
                      background: withAlpha(color, 0.06),
                      borderColor: withAlpha(color, 0.35),
                    }}
                  >
                    {p.template}
                  </pre>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function WikiTree({ token }: { token: string }) {
  const { data, error, isLoading } = useSWR<WikiTreeResponse>(
    ['wiki-tree', token],
    () => api.wikiTree(token),
    { refreshInterval: 30_000, revalidateOnFocus: true },
  );
  const [selected, setSelected] = useState<string | null>(null);

  const tree = useMemo(
    () => (data?.nodes ? buildTree(data.nodes) : null),
    [data],
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-8 animate-pulse rounded border border-border bg-card"
          />
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

  if (!data.nodes.length || !tree) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No wiki nodes yet. Run the seed script or have Claude Code call
        wiki_save to populate the tree.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tree2D tree={tree} selected={selected} onSelect={setSelected} />
      <DetailPanel tree={tree} selectedPath={selected} />
    </div>
  );
}
