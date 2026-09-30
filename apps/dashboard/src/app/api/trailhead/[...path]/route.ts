// Read-only proxy from the browser to the Trailhead API. Adds the team secret
// server-side (lib/server-config.ts) so it never reaches the client.
//
// GET only, and only the read endpoints the dashboard renders. Whoever can
// open the dashboard can therefore *read* its team's data through it — that
// is what a dashboard is — but cannot write, promote, or DELETE /team/data.

import { apiConfigHint, serverApiUrl, serverTeamToken } from '@/lib/server-config';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set([
  'teams',
  'skill-arc',
  'team/metrics',
  'wiki/tree',
  'wiki/recent',
  'wiki/export',
  'context',
  'examples',
  'prompts/proven',
  'search',
]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params;
  const joined = path.join('/');
  if (!ALLOWED.has(joined)) {
    return Response.json({ error: 'not_proxied', detail: `/${joined} is not exposed by the dashboard` }, { status: 404 });
  }
  const search = new URL(req.url).search;
  let upstream: Response;
  try {
    upstream = await fetch(`${serverApiUrl()}/${joined}${search}`, {
      cache: 'no-store',
      headers: { 'X-Team-Token': serverTeamToken() },
    });
  } catch {
    return Response.json({ error: 'api_unreachable', detail: apiConfigHint() }, { status: 502 });
  }
  const headers = new Headers({ 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) headers.set('content-disposition', disposition);
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
}
