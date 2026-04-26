// Team picker — server component. Fetches /teams at request time so
// every team auto-created via /onboard/repo or wiki_bootstrap shows up
// without a code change. Each card links into the team-aware detail
// pages via `?team=<token>`.

import Link from 'next/link';
import type { TeamsListResponse, TeamSummary } from '@trailhead/shared';
import { RESOLVED_API_URL } from '@/lib/api';

export const dynamic = 'force-dynamic';

const DEMO_TOKEN = 'trailhead_demo_acme_2026';
const DEMO_DESCRIPTION =
  "Backend services in Postgres + Hono, webhooks via signed callbacks, PCI-scoped audit logging. Coaching seeded from the team's actual repo conventions.";

function describe(team: TeamSummary): string {
  if (team.token === DEMO_TOKEN) return DEMO_DESCRIPTION;
  if (team.token.startsWith('repo_local_')) {
    return 'Local-only repo (no git remote). Token persisted in .trailhead-team, gitignored. Wiki and skill arc are isolated to this machine.';
  }
  if (team.token.startsWith('repo_')) {
    return 'Repo-derived team (token = SHA-256 of git remote). Teammates cloning the same repo land in the same team automatically.';
  }
  return 'Custom team token. Wiki, skill arc, and metrics are scoped to this token only.';
}

type LoadResult =
  | { ok: true; teams: TeamSummary[] }
  | { ok: false; error: string };

async function loadTeams(): Promise<LoadResult> {
  try {
    const res = await fetch(`${RESOLVED_API_URL}/teams`, { cache: 'no-store' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status} ${body.slice(0, 160)}` };
    }
    const json = (await res.json()) as TeamsListResponse;
    return { ok: true, teams: json.teams };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? String(err) };
  }
}

export default async function HomePage() {
  const result = await loadTeams();
  const teams = result.ok ? result.teams : [];

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Teams</h1>
        <p className="mt-2 text-muted-foreground">
          Pick a team to view its skill arc or wiki. {teams.length}{' '}
          {teams.length === 1 ? 'team' : 'teams'} on the API.
        </p>
      </header>

      {teams.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No teams returned by the API. Check that {RESOLVED_API_URL}/teams is
          reachable.
          {!result.ok && (
            <div className="mt-2 font-mono text-[11px] text-destructive">
              {result.error}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {teams.map((team) => {
            const qs = `?team=${encodeURIComponent(team.token)}`;
            return (
              <article
                key={team.token}
                className="rounded-lg border border-border bg-card p-6 shadow-sm"
              >
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  team
                </div>
                <div className="mt-1 text-xl font-semibold">{team.name}</div>
                <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                  {describe(team)}
                </p>
                <div className="mt-2 font-mono text-[11px] text-muted-foreground/70">
                  token: {team.token}
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href={`/skill-arc${qs}`}
                    className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:border-foreground/40 hover:bg-accent"
                  >
                    Skill improvement statistics
                  </Link>
                  <Link
                    href={`/wiki${qs}`}
                    className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:border-foreground/40 hover:bg-accent"
                  >
                    Team's knowledge
                  </Link>
                  <Link
                    href={`/team${qs}`}
                    className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:border-foreground/40 hover:bg-accent"
                  >
                    Behavioral metrics
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
