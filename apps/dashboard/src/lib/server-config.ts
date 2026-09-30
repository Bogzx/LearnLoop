// Server-only dashboard configuration. Never import this from a 'use client'
// module: it holds the team secret.
//
// Since 2026-09-30 the dashboard never sends the team secret to the browser.
// Server components call the API directly, and client components go through
// the read-only proxy at /api/trailhead/* (app/api/trailhead/[...path]), which
// adds X-Team-Token on the server. Before, the secret travelled in `?team=`
// links and in every browser request, so a deployed dashboard handed anyone
// who opened it full read/write/delete on the team.
//
//   TRAILHEAD_API_URL     API base URL (runtime, server-side). Falls back to the
//                         legacy NEXT_PUBLIC_API_URL, then http://localhost:3000.
//   TRAILHEAD_TEAM_TOKEN  team secret (runtime, server-side). Falls back to the
//                         legacy NEXT_PUBLIC_TEAM_TOKEN (deprecated: a
//                         NEXT_PUBLIC_* value is inlined into client bundles
//                         wherever it is referenced), then the public demo team.

export const DEFAULT_API_URL = 'http://localhost:3000';
export const DEMO_TEAM_TOKEN = 'trailhead_demo_acme_2026';

export function serverApiUrl(): string {
  const raw = process.env.TRAILHEAD_API_URL || process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
  return raw.replace(/\/+$/, '');
}

export function isApiUrlConfigured(): boolean {
  return Boolean(process.env.TRAILHEAD_API_URL || process.env.NEXT_PUBLIC_API_URL);
}

let warnedPublicToken = false;
export function serverTeamToken(): string {
  if (process.env.TRAILHEAD_TEAM_TOKEN) return process.env.TRAILHEAD_TEAM_TOKEN;
  if (process.env.NEXT_PUBLIC_TEAM_TOKEN) {
    if (!warnedPublicToken) {
      warnedPublicToken = true;
      console.warn(
        '[dashboard] NEXT_PUBLIC_TEAM_TOKEN is deprecated — rename it to TRAILHEAD_TEAM_TOKEN so the team secret is never a public build variable.',
      );
    }
    return process.env.NEXT_PUBLIC_TEAM_TOKEN;
  }
  return DEMO_TEAM_TOKEN;
}

export function apiConfigHint(): string {
  const url = serverApiUrl();
  return isApiUrlConfigured()
    ? `Could not reach the Trailhead API at ${url}. Check that the server is running and that TRAILHEAD_API_URL is correct.`
    : `Could not reach the Trailhead API at ${url}. TRAILHEAD_API_URL is not set, so the dashboard fell back to the local default. Trailhead is self-hosted — start the API with \`docker compose up\` from the repo root (see SELFHOSTING.md), or set TRAILHEAD_API_URL to your server's base URL.`;
}
