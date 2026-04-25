'use client';

// Client wrapper for the /team metric cards. Owns the SWR fetch so the
// page stays a server component (faster initial paint, smaller JS).
// No live tick here — these numbers move with new captures, not new
// scores, so a 30s revalidate is plenty.

import useSWR from 'swr';
import type { TeamMetricsResponse } from '@trailhead/shared';
import { api } from '@/lib/api';
import { MetricCard } from './metric-card';

const REFRESH_MS = 30_000;

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function TeamMetricsGrid({ token }: { token: string }) {
  const { data, error, isLoading } = useSWR<TeamMetricsResponse>(
    ['team-metrics', token],
    () => api.teamMetrics(token),
    { refreshInterval: REFRESH_MS, revalidateOnFocus: true },
  );

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[110px] animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-rose-400">
        Failed to load team metrics: {String((error as Error)?.message ?? 'unknown')}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      <MetricCard
        label="Avg overall (7d)"
        value={data.avg_overall.toFixed(1)}
        hint="across all dimensions, last 7 days"
        accent="goal"
      />
      <MetricCard
        label="Reuse rate (7d)"
        value={formatPercent(data.reuse_rate)}
        hint="captures rated 'helpful'"
        accent="spec"
      />
      <MetricCard
        label="Active users (7d)"
        value={String(data.active_users)}
        hint="distinct prompt authors"
        accent="context"
      />
      <MetricCard
        label="Durable learnings"
        value={String(data.durable_count)}
        hint="reinforced ≥ 3× — promoted from draft"
        accent="constraint"
      />
      <MetricCard
        label="Draft learnings"
        value={String(data.draft_count)}
        hint="awaiting reinforcement"
        accent="output"
      />
      <MetricCard
        label="Total scored prompts (7d)"
        value={data.total_obs.toLocaleString()}
        hint="5 observations per /score call"
        accent="muted"
      />
    </div>
  );
}
