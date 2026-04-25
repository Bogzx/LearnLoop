// /team — L1→L2 metric grid. Same data backbone as the skill arc but
// snapshot rather than time-series. Used to defend the pitch's behavioral
// metric story (reuse rate, active users, durable count are all behavior
// markers, not engineering vanity numbers).

import Link from 'next/link';
import { TeamMetricsGrid } from '@/components/team-metrics-grid';
import { DEFAULT_TEAM_TOKEN } from '@/lib/api';

export default function TeamPage({
  searchParams,
}: {
  searchParams: { team?: string };
}) {
  const token = searchParams.team ?? DEFAULT_TEAM_TOKEN;

  return (
    <section className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Teams
      </Link>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Team</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Behavioral metrics — average prompt quality, team reuse rate,
          durable learnings. All KPIs are people-side, not engineering-side.
        </p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground/70">
          token: {token}
        </p>
      </header>

      <TeamMetricsGrid token={token} />
    </section>
  );
}
