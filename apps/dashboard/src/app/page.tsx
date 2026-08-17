// Team view — server component.
//
// This was a picker over every team on the server, built from an
// unauthenticated GET /teams that returned each team's token. That endpoint
// published every tenant's only credential, so it now authenticates and
// returns just the caller's team, without the token.
//
// The dashboard therefore shows the team its own NEXT_PUBLIC_TEAM_TOKEN
// resolves to. To view a different team, configure that team's token — which
// is the point: viewing a team's wiki should require holding its credential.

import Link from 'next/link';
import type { TeamsListResponse, TeamSummary } from '@trailhead/shared';
import {
  apiConfigHint,
  DEFAULT_TEAM_TOKEN,
  IS_API_URL_CONFIGURED,
  RESOLVED_API_URL,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

const DEMO_TOKEN = 'trailhead_demo_acme_2026';
const DEMO_DESCRIPTION =
  "Backend services in Postgres + Hono, webhooks via signed callbacks, PCI-scoped audit logging. Coaching seeded from the team's actual repo conventions.";

// Described from the token this dashboard is configured with, since the API
// no longer discloses tokens.
function describe(token: string): string {
  if (token === DEMO_TOKEN) return DEMO_DESCRIPTION;
  if (token.startsWith('repo_local_')) {
    return 'Local-only repo (no git remote). Token persisted in .trailhead-team, gitignored. Wiki and skill arc are isolated to this machine.';
  }
  if (token.startsWith('repo_')) {
    return 'Repo-derived team (token = SHA-256 of git remote). Teammates cloning the same repo land in the same team automatically.';
  }
  return 'Custom team token. Wiki, skill arc, and metrics are scoped to this token only.';
}

type LoadResult =
  | { ok: true; teams: TeamSummary[] }
  | { ok: false; error: string };

async function loadTeams(): Promise<LoadResult> {
  try {
    // /teams is authenticated now — it resolves the caller's own team.
    const res = await fetch(`${RESOLVED_API_URL}/teams`, {
      cache: 'no-store',
      headers: { 'X-Team-Token': DEFAULT_TEAM_TOKEN },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status} ${body.slice(0, 160)}` };
    }
    const json = (await res.json()) as TeamsListResponse;
    return { ok: true, teams: json.teams };
  } catch (err) {
    // Network-layer failure: the self-hosted API isn't running, or
    // NEXT_PUBLIC_API_URL points somewhere wrong. Say which, and name the
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
          No teams returned by the API. Check that {RESOLVED_API_URL}/teams is
          reachable.
          {!IS_API_URL_CONFIGURED && (
            <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-[13px] text-foreground">
              <div className="font-semibold">NEXT_PUBLIC_API_URL is not set.</div>
              <p className="mt-1 text-muted-foreground">
                Trailhead is self-hosted — there is no default server. Start one
                with <code className="font-mono">docker compose up</code> from the
                repo root (see <code className="font-mono">SELFHOSTING.md</code>),
                or set <code className="font-mono">NEXT_PUBLIC_API_URL</code> to
                your server&apos;s base URL and rebuild.
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
            // The token comes from this dashboard's own configuration, not
            // from the API response — the API no longer discloses it.
            const qs = `?team=${encodeURIComponent(DEFAULT_TEAM_TOKEN)}`;
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
                  {describe(DEFAULT_TEAM_TOKEN)}
                </p>
                {/* The team token is a credential; it is not printed here.
                    `id` is an opaque digest, safe to show. */}
                <div className="mt-2 font-mono text-[11px] text-muted-foreground/70">
                  id: {team.id}
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
                    href={`/onboarding${qs}`}
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
