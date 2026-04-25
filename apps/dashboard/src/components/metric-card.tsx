// Reusable metric tile for /team. One label, one big value, an optional
// hint underneath (e.g. "of 5+ scoring obs", "promoted ≥3×"). Kept dumb —
// data fetching and formatting live in the page; this just renders.

interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  // Optional accent color — lets the page foreground key metrics. Mirror
  // the Tailwind dim.* palette so visual language stays consistent with
  // the skill-arc chart.
  accent?: 'goal' | 'spec' | 'context' | 'constraint' | 'output' | 'muted';
}

const ACCENT_CLASS: Record<NonNullable<MetricCardProps['accent']>, string> = {
  goal: 'text-dim-goal',
  spec: 'text-dim-spec',
  context: 'text-dim-context',
  constraint: 'text-dim-constraint',
  output: 'text-dim-output',
  muted: 'text-foreground',
};

export function MetricCard({ label, value, hint, accent = 'muted' }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${ACCENT_CLASS[accent]}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
