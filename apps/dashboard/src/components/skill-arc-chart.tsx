'use client';

// Hero chart for the §13 close beat. SWR revalidates every 2s during demo —
// the demonstrator's last 2 minutes of /score writes show up as a visibly
// climbing tick on the rightmost bucket.
//
// Time-bucketing strategy: 1-hour buckets, all 5 dimensions averaged within
// each bucket. Seeded data (~25 obs) spread over recent hours fills the
// left of the chart; the demo's fresh /score writes pile into the most
// recent bucket and push it up.

import useSWR from 'swr';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Dimension, SkillArcResponse } from '@trailhead/shared';
import { DIMENSIONS } from '@trailhead/shared';
import { api } from '@/lib/api';
import { LiveIndicator } from './live-indicator';

// Tailwind theme colors don't propagate into Recharts (it needs literal
// strings for line stroke). Mirror the tailwind.config.ts dim.* values
// here so the chart matches the rest of the UI.
const DIMENSION_COLOR: Record<Dimension, string> = {
  goal_clarity: 'hsl(142 76% 56%)',
  specificity: 'hsl(199 89% 60%)',
  context_loading: 'hsl(38 92% 60%)',
  constraint_articulation: 'hsl(280 70% 65%)',
  output_specification: 'hsl(348 83% 65%)',
};

// Human-readable dim names for the legend.
const DIMENSION_LABEL: Record<Dimension, string> = {
  goal_clarity: 'goal',
  specificity: 'specificity',
  context_loading: 'context',
  constraint_articulation: 'constraints',
  output_specification: 'output',
};

const BUCKET_MS = 60 * 60 * 1000; // 1-hour buckets

interface BucketRow {
  bucketTs: number;
  bucketLabel: string;
  goal_clarity?: number;
  specificity?: number;
  context_loading?: number;
  constraint_articulation?: number;
  output_specification?: number;
}

// Group observations by (1-hour bucket, dimension), average within each
// group, and emit a Recharts-friendly row per bucket. Buckets with no
// observations for a dimension simply omit that key — Recharts draws a
// gap instead of forcing the line to 0.
function bucketize(obs: SkillArcResponse['observations']): BucketRow[] {
  if (!obs.length) return [];

  // Group: bucketTs -> dimension -> [scores...]
  const groups = new Map<number, Map<Dimension, number[]>>();
  for (const o of obs) {
    const t = new Date(o.ts).getTime();
    if (!Number.isFinite(t)) continue;
    const bucket = Math.floor(t / BUCKET_MS) * BUCKET_MS;
    let perBucket = groups.get(bucket);
    if (!perBucket) {
      perBucket = new Map();
      groups.set(bucket, perBucket);
    }
    const arr = perBucket.get(o.dimension) ?? [];
    arr.push(o.score);
    perBucket.set(o.dimension, arr);
  }

  // Flatten into Recharts rows, sorted ascending by bucket time.
  const rows: BucketRow[] = [];
  for (const [bucketTs, perBucket] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const row: BucketRow = {
      bucketTs,
      bucketLabel: new Date(bucketTs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
    for (const dim of DIMENSIONS) {
      const scores = perBucket.get(dim);
      if (!scores?.length) continue;
      const avg = scores.reduce((s, n) => s + n, 0) / scores.length;
      row[dim] = Math.round(avg * 10) / 10;
    }
    rows.push(row);
  }
  return rows;
}

interface SkillArcChartProps {
  token: string;
  // Look-back window in hours. Default 24 — covers the demo seed.
  hoursBack?: number;
  // SWR revalidation cadence. 2000 ms during demo; tunable for dev to
  // avoid log spam.
  refreshInterval?: number;
}

export function SkillArcChart({
  token,
  hoursBack = 24,
  refreshInterval = 2000,
}: SkillArcChartProps) {
  // Recompute `since` on each render so revalidation stays anchored to
  // a rolling window. SWR keys must be stable strings, so we round to
  // the minute — preserves the rolling effect without busting the cache
  // key on every render.
  const sinceMs = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 60_000) * 60_000;
  const since = new Date(sinceMs).toISOString();

  const { data, error, isLoading } = useSWR<SkillArcResponse>(
    ['skill-arc', token, since],
    () => api.skillArc(token, since),
    {
      refreshInterval,
      revalidateOnFocus: true,
      dedupingInterval: refreshInterval / 2,
    },
  );

  if (isLoading) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
        Loading skill arc…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-lg border border-border bg-card text-sm text-rose-400">
        Failed to load: {String((error as Error).message)}
      </div>
    );
  }

  const rows = bucketize(data?.observations ?? []);
  const totalObs = data?.observations.length ?? 0;

  if (!rows.length) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
        No observations yet. Send a prompt to populate the arc.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Skill improvements</h2>
          <p className="text-xs text-muted-foreground">
            {totalObs} observation{totalObs === 1 ? '' : 's'} across{' '}
            {rows.length} hour-bucket{rows.length === 1 ? '' : 's'}
          </p>
        </div>
        <LiveIndicator />
      </div>
      <div className="h-[380px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="hsl(217 32% 17%)" strokeDasharray="3 3" />
            <XAxis
              dataKey="bucketLabel"
              stroke="hsl(215 20% 65%)"
              fontSize={11}
              tickLine={false}
            />
            <YAxis
              domain={[0, 10]}
              ticks={[0, 2, 4, 6, 8, 10]}
              stroke="hsl(215 20% 65%)"
              fontSize={11}
              tickLine={false}
              width={28}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(222 84% 6%)',
                border: '1px solid hsl(217 32% 17%)',
                borderRadius: '0.5rem',
                fontSize: '0.85rem',
              }}
              labelStyle={{ color: 'hsl(210 40% 98%)' }}
            />
            <Legend
              iconType="line"
              wrapperStyle={{ fontSize: '0.8rem', paddingTop: '0.5rem' }}
            />
            {DIMENSIONS.map((dim) => (
              <Line
                key={dim}
                type="monotone"
                dataKey={dim}
                name={DIMENSION_LABEL[dim]}
                stroke={DIMENSION_COLOR[dim]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
