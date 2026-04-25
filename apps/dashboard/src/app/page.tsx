import Link from 'next/link';

// Demo team selector — the §13 storyboard's 0:30 beat. One card,
// click-through to /skill-arc which is the visual centerpiece.
//
// In a real product this would list every team the user belongs to.
// For the hackathon there's exactly one (Acme Fintech), and the click
// just navigates to the hero page — no state, no auth, no team
// switching needed.
export default function HomePage() {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Pick a team</h1>
        <p className="mt-2 text-muted-foreground">
          Live skill arcs and L1→L2 progression metrics, driven by every
          prompt your team writes.
        </p>
      </header>

      <Link
        href="/skill-arc"
        className="group block rounded-lg border border-border bg-card p-6 shadow-sm transition-colors hover:border-foreground/30"
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              demo team
            </div>
            <div className="mt-1 text-xl font-semibold">Acme Fintech</div>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">
              Backend services in Postgres + Hono, webhooks via signed
              callbacks, PCI-scoped audit logging. Coaching seeded from the
              team's actual repo conventions.
            </p>
          </div>
          <div className="text-sm text-muted-foreground transition-colors group-hover:text-foreground">
            View skill arc →
          </div>
        </div>
      </Link>
    </section>
  );
}
