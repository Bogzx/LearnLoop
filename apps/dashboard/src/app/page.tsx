// Team view — server component.
//
// This was a picker over every team on the server, built from an
// unauthenticated GET /teams that returned each team's token. That endpoint
// published every tenant's only credential, so it now authenticates and
// returns just the caller's team, without the token.
//
// The dashboard therefore shows the team its server-side TRAILHEAD_TEAM_TOKEN
// resolves to (lib/server-config.ts). The secret stays on the server: this
// component fetches with it directly, and client components go through the
// read-only /api/trailhead proxy.

import Link from 'next/link';
import type { TeamsListResponse, TeamSummary } from '@trailhead/shared';
import {
  apiConfigHint,
  DEMO_TEAM_TOKEN,
  isApiUrlConfigured,
  serverApiUrl,
  serverTeamToken,
} from '@/lib/server-config';

export const dynamic = 'force-dynamic';

const DEMO_DESCRIPTION =
  "Backend services in Postgres + Hono, webhooks via signed callbacks, PCI-scoped audit logging. Coaching seeded from the team's actual repo conventions.";

function describe(team: TeamSummary, isDemo: boolean): string {
  if (isDemo) return DEMO_DESCRIPTION;
  if (team.legacy) {
    return 'Legacy team token (derived from the git remote URL, so anyone who knows the URL can compute it). Run `init --upgrade-legacy` in the repo and set TRAILHEAD_TEAM_TOKEN to the new secret.';
  }
  return 'Wiki, skill arc, and metrics for this team. The dashboard holds its secret server-side and exposes read-only views.';
}

type LoadResult =
  | { ok: true; teams: TeamSummary[] }
  | { ok: false; error: string };

async function loadTeams(): Promise<LoadResult> {
  try {
    // /teams is authenticated now — it resolves the caller's own team.
    const res = await fetch(`${serverApiUrl()}/teams`, {
      cache: 'no-store',
      headers: { 'X-Team-Token': serverTeamToken() },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status} ${body.slice(0, 160)}` };
    }
    const json = (await res.json()) as TeamsListResponse;
    return { ok: true, teams: json.teams };
  } catch (err) {
    // Network-layer failure: the self-hosted API isn't running, or
    // TRAILHEAD_API_URL points somewhere wrong. Say which, and name the
    // variable — an opaque "fetch failed" here is what sends people hunting.
    return { ok: false, error: `${apiConfigHint()} (${(err as Error).message ?? String(err)})` };
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
          No teams returned by the API. Check that {serverApiUrl()}/teams is
          reachable and that TRAILHEAD_TEAM_TOKEN is a valid team secret.
          {!isApiUrlConfigured() && (
            <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-[13px] text-foreground">
              <div className="font-semibold">TRAILHEAD_API_URL is not set.</div>
              <p className="mt-1 text-muted-foreground">
                Trailhead is self-hosted — there is no default server. Start one
                with <code className="font-mono">docker compose up</code> from the
                repo root (see <code className="font-mono">SELFHOSTING.md</code>),
                or set <code className="font-mono">TRAILHEAD_API_URL</code> to
                your server&apos;s base URL.
              </p>
            </div>
          )}
          {!result.ok && (
            <div className="mt-2 font-mono text-[11px] text-destructive">
              {result.error}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {teams.map((team) => {
            return (
              <article
                key={team.id}
                className="rounded-lg border border-border bg-card p-6 shadow-sm"
              >
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  team
                </div>
                <div className="mt-1 text-xl font-semibold">{team.name}</div>
                <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                  {describe(team, serverTeamToken() === DEMO_TEAM_TOKEN)}
                </p>
                {/* The team secret is never printed. team_id is public by
                    design; legacy teams only get the opaque digest. */}
                <div className="mt-2 font-mono text-[11px] text-muted-foreground/70">
                  id: {team.team_id ?? team.id}
                </div>

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
                  <Link
                    href="/onboarding"
                    className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:border-foreground/40 hover:bg-accent"
                  >
                    Onboarding
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
