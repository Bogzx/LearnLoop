# LearnLoop

A prompting coach for teams. Every prompt sent through Claude.ai, Claude Code,
VS Code or Copilot Chat is scored on five dimensions before it goes out. Weak
prompts get a short teaching loop; strong ones join the team's prompt library,
and the conventions people state are collected into a team wiki that is fed
back into the next person's context. A team's way of prompting compounds
without anyone writing docs.

- **Try the scorer in your browser:** <https://learnloop-gules.vercel.app/#try>
- **Video walkthrough:** <https://www.youtube.com/watch?v=kD6nnJAmRK8>
- **Run the whole stack, no API key needed:** [Try it](#try-it) below

Built at PoliHack v19 (April 2026, BMW track "Applications that encourage AI
adoption") by [@Bogzx](https://github.com/Bogzx),
[@KunMihai1](https://github.com/KunMihai1),
[@bbeatricecretu](https://github.com/bbeatricecretu) and
[@CosovanuGabi912](https://github.com/CosovanuGabi912). Open source (MIT) and
self-hosted: there is no hosted service to sign up for.

> *Trailhead* is the codename used inside the code (package names, settings,
> env vars); *LearnLoop* is the product name.

<table>
<tr>
<td width="40%" valign="top">
<img src="docs/images/extension.jpeg" alt="LearnLoop browser-extension popup — Coaching toggle, team picker, and active context path" />
<br />
<sub><b>Browser-extension popup.</b> Toggle coaching, pick the team, scope scoring to a wiki node so the rubric reads against that subtree's conventions.</sub>
</td>
<td width="60%" valign="top">
<img src="docs/images/chat_feedback.jpeg" alt="In-chat Coach output — overall 2/10 with per-dimension scores and a constraint-articulation explanation" />
<br />
<sub><b>Coach output inside Claude Code.</b> Five dimensions, a per-dimension breakdown, and a teaching paragraph for the weakest one — surfaced through the MCP <code>coach</code> tool before the prompt is sent.</sub>
</td>
</tr>
</table>

---

## How it works

```mermaid
flowchart LR
  subgraph clients["Where people prompt"]
    BX["Chrome extension<br/>on claude.ai"]
    VS["VS Code extension<br/>sidebar"]
    MCP["MCP server<br/>Claude Code · Copilot Chat"]
  end
  DASH["Dashboard<br/>Next.js"]
  subgraph api["apps/api · Hono"]
    ROUTES["/score · /coach · /improve · /diff<br/>/wiki/* · /prompts/* · /onboard/*"]
    LLM["llm.ts"]
  end
  PG[("Postgres<br/>wiki · library · score history")]
  GEM["Gemini<br/>gemini-3-flash-preview"]
  RULES["rule-based scorer<br/>TRAILHEAD_LLM=offline"]
  LF["Langfuse<br/>optional"]

  BX -- "X-Team-Token" --> ROUTES
  VS -- "X-Team-Token" --> ROUTES
  MCP -- "X-Team-Token" --> ROUTES
  DASH -- "read-only proxy" --> ROUTES
  ROUTES --> PG
  ROUTES --> LLM
  LLM --> GEM
  LLM -.-> RULES
  GEM -. traces .-> LF
```

The loop, end to end:

1. **Score.** A prompt is sent (Chrome extension) or a code task starts
   (Claude Code / Copilot Chat via the MCP `coach` tool). The API scores it on
   the five dimensions below and records the scores for the team's skill arc.
2. **Coach.** At 7/10 or more it goes through untouched. Below 7, the
   extension holds the send and offers *Improve* / *Send as-is* / *Edit*;
   nothing is sent automatically. In Claude Code the `coach` tool runs a short
   teach → revise loop (at most 5 rounds) on the weakest dimension, using a
   teammate's proven prompt as the example when there is one.
3. **Promote.** A prompt that clears a strict bar (unrounded mean ≥ 7, no
   dimension below 5, and an independent re-score that agrees) joins the
   team's prompt library, optionally after a teammate's review.
4. **Remember.** When someone states a team convention, `wiki_save` records
   it; repeated mentions are deduplicated and become *durable* after three.
5. **Reuse.** The next prompt about the same part of the codebase is scored
   and coached with that wiki node's conventions and library prompts in
   context, so the rubric reads against how this team works.

---

## The rubric, and how the score is measured

Every prompt is scored 0–10 on:

1. `goal_clarity` — the desired outcome is stated unambiguously
2. `specificity` — the change itself is named (files, functions, errors)
3. `context_loading` — the relevant code, docs or examples are referenced
4. `constraint_articulation` — what must not change; limits and invariants
5. `output_specification` — the shape the answer should take

`overall` is the rounded mean. The rubric text lives in
`packages/scoring/src/score-prompt.mjs`, and the score comes from one Gemini
call, so it varies from run to run. `apps/api/eval/` measures how much on a
golden set of 30 prompts plus a held-out set of 16, reporting run-to-run
spread, how often the coaching and library gates flip, band hits, and whether
better prompts are ranked above worse ones.

What has been measured so far is the **rule-based scorer**
(`packages/scoring/src/heuristic-score.mjs`), a transparent baseline that a
model scorer should beat; the two have not been compared yet. CI checks it on
every change:

| Prompt set | Overall in expected band | Pairs ranked the right way round |
|---|---|---|
| golden (30, visible while its rules were written) | 29/30 | 152/152 |
| held-out (16; per its author, written before the rules were frozen and not tuned on, but added in the same commit, so this can't be checked from history) | 14/16 | 38/38 |

The bands were written in this repo, not by independent reviewers, and the
Gemini scorer has not been run on either set yet (it needs a key; one command
in [`apps/api/eval/README.md`](apps/api/eval/README.md)). Known misses and
the full method are documented there.

---

## Try it

**In your browser, 10 seconds:** the [Try it section of the landing
page](https://learnloop-gules.vercel.app/#try) runs the rule-based scorer on
whatever you type. Nothing leaves the page.

**The whole stack, no key, about 2 minutes** (Docker with Compose v2):

```bash
git clone https://github.com/Bogzx/LearnLoop && cd LearnLoop
TRAILHEAD_LLM=offline docker compose --profile demo up --build
# API on http://localhost:3000, Postgres schema applied, demo team seeded
curl -s -X POST localhost:3000/score -H 'content-type: application/json' \
  -H 'X-Team-Token: trailhead_demo_acme_2026' \
  -d '{"prompt":"fix the retry","user_id":"me"}'
```

Offline mode has no model: scoring uses the rule-based scorer, coaching uses
the static templates, and every response says so. `--profile demo` loads a
fictional team ("Acme Fintech") with a small wiki, four library prompts and
six days of synthetic activity, so the dashboard has something to show.

**With Gemini:** `cp .env.example .env`, put a key from
<https://aistudio.google.com/apikey> in it, and `docker compose up`.

Then point the clients at it, all described in
[SELFHOSTING.md](SELFHOSTING.md):

```bash
# Dashboard on http://localhost:3001 (server-side env; the secret never reaches the browser)
TRAILHEAD_API_URL=http://localhost:3000 TRAILHEAD_TEAM_TOKEN=trailhead_demo_acme_2026 \
  npm --workspace=apps/dashboard run dev

# Claude Code / Copilot Chat in one of your repos (the MCP package is not on npm,
# so the CLI runs from this clone; `init` registers the repo's team)
cd /path/to/your/repo
node /path/to/LearnLoop/apps/mcp-server/bin/cli.mjs init
```

Packages of the Chrome extension (`.zip`, load unpacked) and the VS Code
extension (`.vsix`) are built by every CI run (the `extensions` artifact) and
attached to [GitHub releases](https://github.com/Bogzx/LearnLoop/releases)
from v0.1.0; neither is on a store.

Before exposing the API beyond `localhost`, read
[SELFHOSTING.md → Security model](SELFHOSTING.md#security-model).

---

## What's in the box

| Surface | What it does | Code |
|---|---|---|
| API | Hono + TypeScript on Node 22, raw `pg`. Multi-tenant: each team has a public id and a server-minted secret (stored hashed). Scoring, coaching, library, wiki, rich bootstrap, rate limits, Langfuse tracing. | [`apps/api`](apps/api) — routes in [its README](apps/api/README.md) |
| Chrome extension | MV3, on claude.ai. Score card under the composer, score badges on each message, *Compare to team* diff, *Improve* chat, outcome chips, wiki toasts, context picker. Every API call goes through the service worker. | [`apps/browser-ext`](apps/browser-ext) |
| VS Code extension | Sidebar with the same score card, team examples for the open file, wiki-update toasts. | [`apps/vscode-ext`](apps/vscode-ext) |
| MCP server | STDIO server for Claude Code and Copilot Chat: `coach`, `wiki_lookup`, `wiki_save`, `wiki_bootstrap`, `wiki_proven_prompts` (+ `ping`), and a CLI: `init`, `bootstrap`, `reset`. | [`apps/mcp-server`](apps/mcp-server) |
| Dashboard | Next.js 16: team skill arc, metrics, wiki tree, onboarding view; reads through a server-side proxy so the team secret stays on the server. | [`apps/dashboard`](apps/dashboard) |
| Landing page | Static page with the in-browser scorer. | [`apps/landing-page`](apps/landing-page) |
| Shared packages | `shared` (every request/response type), `scoring` (prompts, rubric, rule-based scorer, renderers), `score-card` (DOM score card), `db` (schema, migrations, demo seed). | [`packages/`](packages) |

Postgres holds eight tables (`packages/db/schema.sql`): teams, wiki nodes,
learnings, library prompts, captures, skill observations, and the two
rich-bootstrap job tables.

---

## Development

Node ≥ 22.6, npm workspaces.

```bash
npm ci
npm run typecheck    # tsc --noEmit in every workspace
npm run lint         # ESLint flat config
npm test             # every workspace's tests, including the scorer baseline
npm run build        # every workspace with a build script

# API integration tests against a throwaway Postgres (they wipe it):
docker run -d --rm --name trailhead-it -p 55432:5432 -e POSTGRES_USER=trailhead \
  -e POSTGRES_PASSWORD=trailhead -e POSTGRES_DB=trailhead_it postgres:16-alpine
TRAILHEAD_IT_DATABASE_URL=postgresql://trailhead:trailhead@127.0.0.1:55432/trailhead_it \
  npm --workspace=apps/api run test:integration
```

CI runs all of that, plus `npm audit`, a Docker build with a
`docker compose up` smoke test in offline mode, and packaging of both
extensions. A `v*` tag attaches the extension packages to a draft release
(`.github/workflows/release.yml`).

Without Docker, the API runs against any Postgres:
`psql "$DATABASE_URL" -f packages/db/schema.sql`, optionally
`node packages/db/seed.mjs`, then `npm run dev` (reads `.env`).

## Deployment

- **API:** self-hosted. `docker compose` as above, or any Node 22 host
  (`railway.json` is kept for Railway). Every environment variable is in
  [SELFHOSTING.md → All variables](SELFHOSTING.md#all-variables).
- **Dashboard:** Vercel or any Next.js host. Set `TRAILHEAD_API_URL` and
  `TRAILHEAD_TEAM_TOKEN` server-side; anyone who can open it can read that
  team's data, so restrict access.
- **Landing page:** static files on Vercel.
- **Extensions:** from the release packages, loaded unpacked / installed from
  the `.vsix`.

## Specs

The project was specced before it was built; the specs are the record of
*why*:

- `docs/superpowers/specs/2026-04-25-trailhead-design.md` — master spec
- `docs/superpowers/specs/2026-04-25-mcp-plugin-ux-design.md` — MCP install
  story and (then) four-tool surface
- `docs/superpowers/specs/2026-04-25-trailhead-browser-ext-design.md` —
  Claude.ai content-script architecture
- `docs/superpowers/specs/2026-04-25-demo-completion-design.md` — dashboard
  and seeding plan
- `docs/superpowers/specs/2026-04-26-trailhead-educational-loop-design.md` —
  the teach → reveal coaching loop
- `docs/superpowers/specs/2026-04-26-wiki-bootstrap-rich-design.md` — async
  rich bootstrap
- `docs/superpowers/specs/2026-04-26-improve-widget-design.md` — multi-turn
  improve widget
- `docs/roadmaps/` — per-surface 24-hour build plans

Each app and package has its own README with surface-specific details.

## License

MIT — see [LICENSE](LICENSE).
