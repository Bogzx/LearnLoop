'use client';

// Onboarding view — single-fetch over /wiki/tree, then flattened/sorted client
// side. Shows ALL graduated prompts and ALL learnings (durable + draft) using
// the exact same card/row format as the Team's-knowledge tree DetailPanel, so
// a new teammate sees a flat catalog without needing to click around the tree.

import { useMemo } from 'react';
import useSWR from 'swr';
import type {
  WikiTreeNode,
  WikiTreePrompt,
  WikiTreeResponse,
} from '@trailhead/shared';
import { api } from '@/lib/api';

const REFRESH_MS = 30_000;

type FlatPrompt = WikiTreePrompt & { node_path: string };
type FlatLearning = {
  id: string;
  body: string;
  reinforcement_count: number;
  status: 'durable' | 'draft';
  node_path: string;
};

function flatten(nodes: WikiTreeNode[]): {
  prompts: FlatPrompt[];
  learnings: FlatLearning[];
  durableCount: number;
  draftCount: number;
  folderCount: number;
} {
  const prompts: FlatPrompt[] = [];
  const learnings: FlatLearning[] = [];
  let durableCount = 0;
  let draftCount = 0;
  for (const n of nodes) {
    for (const p of n.graduated_prompts) prompts.push({ ...p, node_path: n.path });
    for (const l of n.durable_learnings) {
      learnings.push({
        id: l.id,
        body: l.body,
        reinforcement_count: l.reinforcement_count,
        status: 'durable',
        node_path: n.path,
      });
      durableCount += 1;
    }
    for (const l of n.draft_learnings) {
      learnings.push({
        id: l.id,
        body: l.body,
        reinforcement_count: l.reinforcement_count,
        status: 'draft',
        node_path: n.path,
      });
      draftCount += 1;
    }
  }
  prompts.sort((a, b) => b.reuse_count - a.reuse_count);
  // Durables first, then drafts; within each, sort by reinforcement count desc.
  learnings.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'durable' ? -1 : 1;
    return b.reinforcement_count - a.reinforcement_count;
  });
  return {
    prompts,
    learnings,
    durableCount,
    draftCount,
    folderCount: nodes.length,
  };
}

function copyToClipboard(text: string): void {
  void navigator.clipboard?.writeText(text);
}

function formatAuthor(author: string | null | undefined): string {
  if (!author) return 'anonymous';
  if (author.includes('@')) return author;
  if (author.startsWith('user_')) return author.slice(5);
  if (author.length > 18) return `${author.slice(0, 16)}…`;
  return author;
}

export function OnboardingView({ token }: { token: string }) {
  const { data, error, isLoading } = useSWR<WikiTreeResponse>(
    ['wiki-tree', token],
    () => api.wikiTree(token),
    { refreshInterval: REFRESH_MS, revalidateOnFocus: true },
  );

  const flat = useMemo(() => (data ? flatten(data.nodes) : null), [data]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-[80px] animate-pulse rounded-lg border border-border bg-card" />
        <div className="h-[300px] animate-pulse rounded-lg border border-border bg-card" />
        <div className="h-[300px] animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (error || !data || !flat) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-rose-400">
        Failed to load onboarding view: {String((error as Error)?.message ?? 'unknown')}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SummaryStrip
        prompts={flat.prompts.length}
        durables={flat.durableCount}
        drafts={flat.draftCount}
        folders={flat.folderCount}
      />

      <section>
        <SectionHeader
          eyebrow="Graduated prompts"
          subtitle={
            flat.prompts.length === 0
              ? 'No graduated prompts yet — the team needs more reuse before any reach onboarding status.'
              : `Every graduated prompt the team has produced (${flat.prompts.length}). Topic, reuse count, author, and the full template — copyable.`
          }
        />
        {flat.prompts.length === 0 ? (
          <EmptyHint>
            Graduated prompts appear here once a prompt is reused enough times
            to be promoted by the API.
          </EmptyHint>
        ) : (
          <div className="space-y-3">
            {flat.prompts.map((p, idx) => (
              <PromptCard
                key={`${p.node_path}-${p.id}`}
                prompt={p}
                isTop={idx === 0}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          eyebrow="All team patterns"
          subtitle={
            flat.learnings.length === 0
              ? 'No learnings yet — every wiki_save from the team starts as a draft and is promoted after 3+ reinforcements.'
              : `Every learning the team has captured (${flat.durableCount} durable + ${flat.draftCount} draft). Same format as the Team's-knowledge tree.`
          }
        />
        {flat.learnings.length === 0 ? (
          <EmptyHint>
            Learnings appear here as the team uses{' '}
            <code className="font-mono">wiki_save</code>. Drafts are auto-promoted
            to durable after 3 reinforcements.
          </EmptyHint>
        ) : (
          <ul className="space-y-2">
            {flat.learnings.map((l) => (
              <LearningRow key={`${l.node_path}-${l.id}`} learning={l} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SummaryStrip({
  prompts,
  durables,
  drafts,
  folders,
}: {
  prompts: number;
  durables: number;
  drafts: number;
  folders: number;
}) {
  const items = [
    { label: 'Graduated prompts', value: prompts },
    { label: 'Durable patterns', value: durables },
    { label: 'Draft learnings', value: drafts },
    { label: 'Folders covered', value: folders },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-lg border border-border bg-card px-4 py-3"
        >
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {it.label}
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-foreground">
            {it.value.toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  subtitle,
}: {
  eyebrow: string;
  subtitle: string;
}) {
  return (
    <div className="mb-5 border-b border-border/60 pb-3">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">
        {eyebrow}
      </h2>
      <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
        {subtitle}
      </p>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 p-5 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

// Same visual format as wiki-tree.tsx DetailPanel's prompt block:
// best chip (top only) + path + topic + reuse + author + copy + pre.
function PromptCard({ prompt, isTop }: { prompt: FlatPrompt; isTop: boolean }) {
  return (
    <div
      className={`rounded-lg border p-4 ${isTop ? 'border-foreground/30 bg-card' : 'border-border bg-card/60'}`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {isTop && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono font-semibold text-amber-300">
              best
            </span>
          )}
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
            {prompt.node_path || '/'}
          </span>
          {prompt.topic && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
              {prompt.topic}
            </span>
          )}
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
            {prompt.reuse_count}× reused
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
            ✍ {formatAuthor(prompt.author_user_id)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => copyToClipboard(prompt.template)}
          className="rounded border border-border bg-background px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          Copy
        </button>
      </div>
      <pre className="whitespace-pre-wrap rounded border border-border bg-background/40 p-3 text-xs text-foreground">
        {prompt.template}
      </pre>
    </div>
  );
}

// Same visual format as wiki-tree.tsx DetailPanel's learning row:
// status pill + path + reinforcement count + body.
function LearningRow({ learning }: { learning: FlatLearning }) {
  const isDurable = learning.status === 'durable';
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-card/60 px-3 py-2.5">
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${isDurable ? 'bg-emerald-400' : 'bg-muted-foreground/40'}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span
            className={`rounded px-1.5 py-0.5 font-mono font-semibold uppercase tracking-wider ${isDurable ? 'bg-emerald-500/15 text-emerald-300' : 'bg-muted text-muted-foreground'}`}
          >
            {learning.status}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
            {learning.node_path || '/'}
          </span>
          <span className="font-mono text-muted-foreground">
            {learning.reinforcement_count}× reinforced
          </span>
        </div>
        <p
          className={`mt-1.5 text-sm ${isDurable ? 'text-foreground' : 'italic text-muted-foreground'}`}
        >
          {learning.body}
        </p>
      </div>
    </li>
  );
}
