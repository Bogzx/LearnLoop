# Trailhead

> A prompt-skill coach that uses your team's actual work as the curriculum.
> The team wiki is the engine that keeps the curriculum fresh, automatically.

Built for **PoliHack 2026** — *AI Adoption for Engineers*. Trailhead targets the
**L1 → L2 transition** (opportunistic prompting → systematized, team-shared
prompting), the gap the brief calls "the hardest." It makes the rubric for a
strong prompt visible to every engineer, on every send, on the surface they
already use (Claude.ai, VS Code, Claude Code, Copilot Chat).

The marketing site brands the product as **LearnLoop**.

---

## What ships

Trailhead is a monorepo with five engineering surfaces and one backend. Every
client talks to the same Hono API; the API owns Postgres and is the only
service with a database connection.

```
┌─ Thin clients ────────────────────────────────────────┐
│  apps/browser-ext   Score-card overlay on Claude.ai   │
│  apps/vscode-ext    VS Code sidebar + articulation    │
│  apps/mcp-server    MCP for Claude Code + Copilot     │
│  apps/dashboard     Next.js skill-arc / wiki view     │
│  apps/landing-page  LearnLoop marketing site (static) │
└─────────────────────┬─────────────────────────────────┘
                      │ HTTPS, X-Team-Token header
                      ▼
┌─ apps/api ────────────────────────────────────────────┐
│  Hono on Railway. Endpoints: /score /coach /capture   │
│  /context /examples /diff /wiki/propose /onboard/...  │
└─────────────────────┬─────────────────────────────────┘
                      ▼
┌─ Postgres (Neon) ─────────────────────────────────────┐
│  6 tables: teams, nodes, learnings, prompts,          │
│  captures, skill_observations (+ wiki_jobs for async) │
└───────────────────────────────────────────────────────┘
```

### The 5-dimension rubric

Every prompt is scored on:

1. `goal_clarity` — what outcome is being asked for
2. `specificity` — concrete files, functions, errors named
3. `context_loading` — relevant code/docs/examples attached
4. `constraint_articulation` — what *must not* change, perf/style limits
5. `output_specification` — desired shape of the response

A prompt scoring `< 7` triggers a 5-second nudge with *Have Claude clarify* /
*Send as-is*; `≥ 7` lands silently. Each `/score` write produces one
`skill_observation` per dimension — that's what powers the live skill arc on
the dashboard.

---

## Repository layout

```
apps/
  api/           Hono + TypeScript backend (Railway)
  browser-ext/   Chrome extension for Claude.ai
  vscode-ext/    VS Code IDE extension
  mcp-server/    MCP server (Claude Code + Copilot Chat)
  dashboard/     Next.js 15 dashboard (Vercel)
  landing-page/  Static marketing site (LearnLoop)

packages/
  shared/        TypeScript types — single source of truth for API shapes
  scoring/       Locked Gemini prompt templates (score, augment, teach, ...)
  score-card/    Pure-DOM render of the 5-dimension card (used by ext + ide)
  db/            Postgres schema, migrations, seed data

docs/
  superpowers/specs/   Design specs (architecture, roadmaps, demo plan)
  roadmaps/            Per-surface 24h build roadmaps
```

Each app and package has its own README with its specific contract, build, and
deploy story. Start there for surface-specific work.

---

## Quick start (local)

Prerequisites:
- Node `>= 22.6`
- A Postgres database (Neon recommended — the `DATABASE_URL` must include
  `sslmode=require`)
- A Gemini API key from <https://aistudio.google.com/apikey>

```bash
# 1. Install workspace dependencies
npm install

# 2. Create your env file
cp .env.example .env
# Edit .env — fill in DATABASE_URL and GEMINI_API_KEY

# 3. Apply the schema (idempotent)
psql "$DATABASE_URL" -f packages/db/schema.sql

# 4. (optional) Seed the Acme Fintech demo data
node packages/db/seed.mjs

# 5. Run the API
npm run dev
# → http://localhost:3000
```

The API will refuse to boot without `DATABASE_URL` and `GEMINI_API_KEY`.

### Run individual surfaces

```bash
# Dashboard (Next.js, port 3001)
NEXT_PUBLIC_API_URL=http://localhost:3000 \
NEXT_PUBLIC_TEAM_TOKEN=trailhead_demo_acme_2026 \
  npm --workspace=apps/dashboard run dev

# Browser extension (build, then load apps/browser-ext/dist as unpacked)
npm --workspace=@trailhead/browser-ext run build

# VS Code extension (run via the Extension Development Host)
npm --workspace=apps/vscode-ext run build
# → F5 in VS Code with apps/vscode-ext as the workspace

# MCP server — install into a target repo
cd /path/to/your/repo
npx trailhead-mcp init
npx trailhead-mcp bootstrap
```

### Workspace scripts

```bash
npm run typecheck    # tsc --noEmit across all workspaces
npm run test         # run all workspace tests
npm run build        # build all workspaces that expose a build script
```

---

## Environment

The root `.env.example` is the canonical template — every surface reads from
the same set of variables.

| Var | Used by | Notes |
|-----|---------|-------|
| `DATABASE_URL` | api | Postgres connection string, `sslmode=require` |
| `GEMINI_API_KEY` | api | Gemini 2.5 Flash (score) + 2.5 Pro (diff) |
| `TEAM_TOKEN` | api, clients | Demo single-tenant secret. `X-Team-Token` header on every request |
| `PORT` | api | Defaults to `3000`; Railway injects automatically |
| `NEXT_PUBLIC_API_URL` | dashboard | Where the dashboard fetches |
| `NEXT_PUBLIC_TEAM_TOKEN` | dashboard | Team token surfaced to the browser |
| `TRAILHEAD_AUTO_CREATE_TEAMS` | api | `false` to disable on-the-fly team creation |
| `TRAILHEAD_ALLOW_DEMO_RESET` | api | `true` to allow `reset` on the demo team |

Production-grade auth is intentionally out of scope — the spec calls for
swapping in Clerk before any non-demo deploy.

---

## Deployment

- **API** → Railway. `railway.json` declares `npm --workspace=apps/api start`
  with healthcheck on `/`.
- **Dashboard** → Vercel. Set `NEXT_PUBLIC_API_URL` and
  `NEXT_PUBLIC_TEAM_TOKEN` in the project settings, then `vercel --prod` from
  `apps/dashboard/`.
- **Browser extension** → loaded unpacked from `apps/browser-ext/dist/` for the
  demo. Pin a specific Chrome build via `apps/browser-ext/PINNED_CHROME.txt`.
- **VS Code extension** → `vsce package` from `apps/vscode-ext/`.
- **MCP server** → distributed via `npx trailhead-mcp init` (per-repo wiring,
  multi-tenant token derivation from the git remote).

---

## How the pieces fit (the demo)

1. Engineer types a prompt in Claude.ai. The browser extension debounces
   250 ms and `POST /score`s it. The score-card mounts under the textarea
   showing 5 per-dimension bars and missing-dimension hints.
2. Below 7 → 5-second *Have Claude clarify* nudge. Each `/score` writes 5
   `skill_observation` rows; the dashboard's `/skill-arc` chart polls every 2
   seconds, so the rightmost bucket climbs as the user prompts.
3. In Claude Code (or Copilot Chat), the MCP server registers four tools:
   `coach`, `wiki_lookup`, `wiki_save`, `wiki_bootstrap`. The host LLM is
   instructed to call `coach` before answering any code task — it returns a
   `proceed` flag plus a teach-block, and the LLM relays it. Three rounds max,
   then a reveal block shows the score arc and prompt diff.
4. When the user states a teamwide convention, `wiki_save` calls
   `POST /wiki/propose`. Server-side normalize + dedup means repeated calls
   reinforce the same draft instead of duplicating; `reinforcement_count >= 3`
   promotes draft → durable. The VS Code extension polls and toasts the wiki
   update — visible proof of the autonomous loop.
5. The dashboard layers real `/score` writes from the live demo on top of the
   seeded base data, so the closing tick is genuinely live.

The whole thing is designed so the demo is **L1 → L2** in motion: an
individual prompt becomes a versioned, reusable team artifact without anyone
filing a PR.

---

## Specs and design docs

The project was specced before it was built. The specs are the source of
truth for *why* — read them before changing surface contracts.

- `docs/superpowers/specs/2026-04-25-trailhead-design.md` — master spec (24 h
  scope, schema, endpoints, demo storyboard, risk register)
- `docs/superpowers/specs/2026-04-25-mcp-plugin-ux-design.md` — MCP install
  story and four-tool surface
- `docs/superpowers/specs/2026-04-25-trailhead-browser-ext-design.md` —
  Claude.ai content-script architecture
- `docs/superpowers/specs/2026-04-25-demo-completion-design.md` — dashboard,
  seeding, demo close beats
- `docs/superpowers/specs/2026-04-26-trailhead-educational-loop-design.md` —
  the teach → reveal coaching loop
- `docs/superpowers/specs/2026-04-26-wiki-bootstrap-rich-design.md` — async
  Karpathy-style wiki bootstrap
- `docs/superpowers/specs/2026-04-26-improve-widget-design.md` — prompt
  improvement widget
- `docs/roadmaps/` — per-surface 24-hour build plans

The hackathon brief itself is in `AI_Adoption_for_Engineers.md`.

---

## Tech stack

- **Backend:** Hono, TypeScript, Node 22, `@hono/node-server`, Railway
- **DB:** Postgres (Neon), no ORM — raw SQL via `pg`
- **LLMs:** Gemini 2.5 Flash (scoring, JSON schema mode), Gemini 2.5 Pro
  (diff synthesis, rich bootstrap)
- **Frontend:** Next.js 15, Tailwind, Recharts, SWR (dashboard);
  vanilla TS + esbuild (extensions); React via CDN (landing page)
- **MCP:** `@modelcontextprotocol/sdk`, STDIO transport
- **Build:** npm workspaces; per-package `tsc` / `esbuild`

---

## License

Hackathon project — no license declared. Treat as all-rights-reserved until
explicitly relicensed.
