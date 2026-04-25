// /skill-arc — the §13 close beat. Renders the live-tick chart that shows
// every dimension's team-wide average over time. Server component wrapper
// → SkillArcChart is the 'use client' boundary that owns the SWR poll.

import Link from 'next/link';
import { SkillArcChart } from '@/components/skill-arc-chart';

export default function SkillArcPage() {
  return (
    <section className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Teams
      </Link>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Skill improvement statistics</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Team-wide average score per dimension, hour-bucketed. The chart
          revalidates every 2 seconds — every prompt your team writes
          appears here within ~2s of being scored.
        </p>
      </header>

      <SkillArcChart hoursBack={24} refreshInterval={2000} />
    </section>
  );
}
