// /team — L1→L2 metric grid. Same data backbone as the skill arc but
// snapshot rather than time-series. Used to defend the pitch's behavioral
// metric story (reuse rate, active users, durable count are all behavior
// markers, not engineering vanity numbers).

import { TeamMetricsGrid } from '@/components/team-metrics-grid';

export default function TeamPage() {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Team</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Behavioral metrics for Acme Fintech — average prompt quality,
          team reuse rate, durable learnings. All KPIs are people-side,
          not engineering-side.
        </p>
      </header>

      <TeamMetricsGrid />
    </section>
  );
}
