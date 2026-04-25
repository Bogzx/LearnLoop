import Link from 'next/link';

type Team = {
  id: string;
  name: string;
  description: string;
};

const teams: Team[] = [
  {
    id: 'acme-fintech',
    name: 'Acme Fintech',
    description:
      "Backend services in Postgres + Hono, webhooks via signed callbacks, PCI-scoped audit logging. Coaching seeded from the team's actual repo conventions.",
  },
];

export default function HomePage() {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Teams</h1>
        <p className="mt-2 text-muted-foreground">
          Pick a team to view its skill arc or wiki.
        </p>
      </header>

      <div className="grid gap-4">
        {teams.map((team) => (
          <article
            key={team.id}
            className="rounded-lg border border-border bg-card p-6 shadow-sm"
          >
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              team
            </div>
            <div className="mt-1 text-xl font-semibold">{team.name}</div>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">
              {team.description}
            </p>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/skill-arc"
                className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:border-foreground/40 hover:bg-accent"
              >
                Skill improvement statistics
              </Link>
              <Link
                href="/wiki"
                className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:border-foreground/40 hover:bg-accent"
              >
                Team's knowledge
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
