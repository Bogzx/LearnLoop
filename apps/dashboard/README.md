# dashboard — Next.js on Vercel

Visual proof of behavior change. Skill arc, L1→L2 metrics, wiki tree view.
Closes the demo with a real `/score`-driven tick layered on top of seeded data.

**Tech:** Next.js 16 + Tailwind + shadcn/ui-style theme + Recharts + SWR. Hosted
on Vercel; reads from `apps/api` only (no direct DB access from dashboard).

**Pages:**
- `/`          — demo team selector ("Acme Fintech")
- `/skill-arc` — per-dimension team chart, **2s SWR revalidate** (the §13 close beat)
- `/team`      — L1→L2 metric cards (avg overall, reuse rate, durable count, ...)
- `/wiki`      — node tree + durable learnings view

**Spec refs:** §2, §11 (seeding), §13 (demo storyboard close), and the
companion `2026-04-25-demo-completion-design.md` (A — full dashboard).

---

## Local dev

From the repo root:

Trailhead is self-hosted: there is no hosted API. Bring one up first —
`docker compose up` from the repo root (see [`SELFHOSTING.md`](../../SELFHOSTING.md))
— then start the dashboard:

```bash
npm --workspace=apps/dashboard run dev
```

Server runs on **http://localhost:3001** (port 3000 is the API).

The dashboard shows one team. Configuration is **server-side and read at
runtime** (`src/lib/server-config.ts`):

- `TRAILHEAD_API_URL` — defaults to `http://localhost:3000`, which is what
  `docker compose up` publishes.
- `TRAILHEAD_TEAM_TOKEN` — the team secret (from the repo's `.trailhead-team`);
  defaults to the public demo team.

```bash
TRAILHEAD_API_URL=https://trailhead.internal.example.com \
TRAILHEAD_TEAM_TOKEN="$(cat /path/to/repo/.trailhead-team)" \
  npm --workspace=apps/dashboard run dev
```

The secret never reaches the browser. Server components call the API
directly; client components (the SWR charts) call the dashboard's read-only
proxy at `/api/trailhead/*`, which allows GET on the read endpoints only and
adds `X-Team-Token` on the server. The legacy `NEXT_PUBLIC_API_URL` /
`NEXT_PUBLIC_TEAM_TOKEN` names still work as fallbacks (deprecated).

If the API is unreachable, the Teams page says so and names
`TRAILHEAD_API_URL` explicitly rather than showing an empty list.

## Build

```bash
npm --workspace=apps/dashboard run build      # ~5s, static export
npm --workspace=apps/dashboard run typecheck  # tsc --noEmit
```

There are five pages — `/`, `/onboarding`, `/skill-arc`, `/team`, `/wiki` —
plus the `/api/trailhead/[...path]` proxy route. `/` and the proxy are
server-rendered per request (`force-dynamic`); the other four are static
shells whose data SWR fetches through the proxy.

SWR still drives the live data on the client; "dynamic" here means the initial
HTML is rendered per request, not that the data is fetched at build time.

## Deploy to Vercel

One-time setup:

1. `npm i -g vercel` (or `npx vercel` per command)
2. From `apps/dashboard/`: `vercel link` — picks a project, writes `.vercel/`
3. Set env vars in the Vercel dashboard (or `vercel env add`), as plain
   server-side variables (not `NEXT_PUBLIC_*`):
   - `TRAILHEAD_API_URL=https://<your-self-hosted-api-host>` — must be
     reachable from Vercel's servers (visitors' browsers never call it)
   - `TRAILHEAD_TEAM_TOKEN=<team secret>`

   Anyone who can open the deployment can read that team's wiki and metrics
   (not write or delete). Use Vercel's deployment protection or your SSO if
   that is not what you want.

Deploy:

```bash
cd apps/dashboard && vercel --prod
```

Expected output: a `https://<project>.vercel.app` URL serving all 4 routes.

Verify:

```bash
URL=https://<your-vercel-url>
curl -sS "$URL/" | grep "Acme Fintech"            # home
curl -sS "$URL/skill-arc" | grep "Skill arc"      # hero
curl -sS "$URL/team" | grep "Behavioral"          # metrics
curl -sS "$URL/wiki" | grep "growing curriculum"  # wiki
```

## Notes on the live tick

`SkillArcChart` polls `GET /skill-arc` every **2 seconds** during the demo.
Each `/score` call writes 5 observations (one per dimension), so two prompts
in the prior 2 minutes pile 10 fresh observations into the rightmost
hour-bucket on the chart — that's what the audience sees climb at 2:50.

To slow the poll for dev (less log spam, less cost):

```tsx
<SkillArcChart hoursBack={24} refreshInterval={10000} />
```

## What's NOT here

- Real auth (single hardcoded `TEAM_TOKEN` in env, demo only)
- Multi-team selector (one card on `/`, hardcoded Acme Fintech)
- User-detail view (skill arc is team-wide; per-user filter is v2)
- Per-node detail page on `/wiki` (full tree on one page is enough at demo scale)
- Tests (e2e via Playwright is post-demo)
