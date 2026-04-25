# Roadmap — VS Code Extension + MCP Server (Person C)

**Date:** 2026-04-25 (PoliHack 24h hackathon)
**Spec:** [`docs/superpowers/specs/2026-04-25-trailhead-design.md`](../superpowers/specs/2026-04-25-trailhead-design.md) — read §3, §7, §8 first
**Status as of writing:** unblocker complete (shared types locked, schema written, Hono stub deployed at `https://trailheadapi-production.up.railway.app`)

> **Note (post-hackathon edit):** The Stop hook autonomy backstop was removed. The wiki now grows only when Claude Code calls the MCP tool `wiki.update_learnings`. Sections referencing a hook are out of date and should be ignored.

---

## 1. What you own

Two artifacts, one TypeScript codebase, two independent deployment targets:

1. **VS Code extension** (`apps/vscode-ext/`) — the visible IDE coaching UI: sidebar webview with pre-prompt examples, score-card, wiki view, wiki-update toasts.
2. **MCP server** (`apps/mcp-server/`) — standalone Node binary registered in Claude Code / Claude Desktop. Exposes `wiki.update_learnings`, `wiki.context_for`, `wiki.search`, `wiki.rules_for`.

The pitch story is "the AI updates the wiki mid-conversation" — Claude Code calls `wiki.update_learnings` when it notices a learning the user wants captured. Server-side dedup on `(node_id, body_normalized)` makes repeated calls for the same insight idempotent.

---

## 2. Integration handshake (locked — do not change)

The unblocker phase already settled the API URL, the team token, and the request/response shapes. Wire to these directly.

```ts
// In your apps/*/.env
TRAILHEAD_API_URL=https://trailheadapi-production.up.railway.app
TRAILHEAD_TEAM_TOKEN=trailhead_demo_acme_2026

// Every request:
// headers: {
//   "Content-Type": "application/json",
//   "X-Team-Token": process.env.TRAILHEAD_TEAM_TOKEN
// }
```

Types live in `packages/shared/types.ts` — import as `@trailhead/shared`.

**Locked already** (you can build against these now):
- `ScoreRequest / ScoreResponse` (POST /score)
- `CaptureRequest / CaptureResponse` (POST /capture)
- `WikiProposeRequest / WikiProposeResponse` (POST /wiki/propose)

**Backend (Person D) will add by hour 8** — confirm the shapes are in `types.ts` before you implement the calls:

```ts
// GET /examples?path=...
interface ExamplesItem  { template: string; topic: string | null; reuse_count: number; node_path: string; }
interface ExamplesResponse { items: ExamplesItem[]; }

// GET /context?path=...   (HCL bundle, ordered shallow → deep)
interface ContextNode {
  path: string;
  body_md: string;
  durable_learnings: { body: string; reinforcement_count: number }[];
}
interface ContextResponse { nodes: ContextNode[]; }

// GET /wiki/recent?since=ISO   (sidebar polling endpoint)
interface WikiRecentItem {
  id: string;
  node_path: string;
  body: string;
  status: 'draft' | 'durable';
  reinforcement_count: number;
  last_seen_at: string;
  created_at: string;
}
interface WikiRecentResponse { items: WikiRecentItem[]; }
```

The unblocker stub on Railway already returns the locked shapes. Build against the live URL from minute one — never spin up your own backend.

---

## 3. Schema validation

The current `packages/db/schema.sql` covers everything you need:

| Need | Query | Schema OK? |
|---|---|---|
| `wiki.context_for(file_path)` — layered node.md + learnings stack | HCL ancestor query on `nodes` + `learnings WHERE status='durable' ORDER BY reinforcement_count DESC` | ✅ |
| `wiki.update_learnings(node_path, insight)` | Backend handles via `/wiki/propose`; dedup keyed by `(node_id, body_normalized)` (already indexed) | ✅ |
| `wiki.search(query, scope)` | ILIKE on `learnings.body`, `nodes.body_md`, `prompts.template` | ✅ (no GIN index needed at hackathon scale) |
| `wiki.rules_for(file_path)` | Ancestor `body_md` from `nodes` | ✅ |
| Sidebar pre-prompt panel | `prompts JOIN nodes WHERE ancestor ORDER BY reuse_count DESC LIMIT 3` | ✅ |
| Sidebar wiki-update toast | `learnings WHERE last_seen_at > $since`; sidebar derives action client-side | ✅ |

**One index Person D should add** (cheap insurance for the polling query):
```sql
CREATE INDEX IF NOT EXISTS idx_learnings_last_seen_at ON learnings(last_seen_at DESC);
```

**Two conventions that live in code, not schema:**
1. **All `nodes.path` values stored with a trailing slash** (`'src/api/auth/'`, never `'src/api/auth'`). The HCL `LIKE path || '%'` query depends on the trailing slash to avoid `'src/api/auth_helpers.ts'` matching `'src/api/auth/'` falsely. Bake into seed data and into any insert helper you write.
2. **`body_normalized` = lowercase + strip non-alphanumeric.** The MCP tool and `/wiki/propose` must use the **same** normalizer. Lives in a small shared helper imported by both (e.g. `packages/scoring/normalize.ts`).

No new tables, no new columns. The schema as-shipped works.

---

## 4. The roadmap (22 hours, hours 2–24 of the build)

You're starting at hour 2. The unblocker is done. Five phases.

### Phase 1 · Three skeletons running locally (hours 2–6)

Goal: every artifact boots and round-trips a hello-world. No real logic yet. Do these *sequentially* — they're confidence-builders, not parallel work.

#### 1A. VS Code extension scaffold (~1 h)

```bash
cd apps/vscode-ext
npx --package=yo --package=generator-code -- yo code
# Choose: New Extension (TypeScript), name 'trailhead', publisher 'trailhead',
# bundler 'esbuild', package manager 'npm', no git init (already in one)
```

Add the sidebar contribution in `package.json`:

```json
"contributes": {
  "viewsContainers": {
    "activitybar": [{
      "id": "trailhead",
      "title": "Trailhead",
      "icon": "$(rocket)"
    }]
  },
  "views": {
    "trailhead": [{
      "type": "webview",
      "id": "trailhead.coach",
      "name": "Coach"
    }]
  }
}
```

Register a `WebviewViewProvider` in `src/extension.ts` returning `<h1>Trailhead</h1>`. Press F5 → Extension Development Host opens → click the rocket in the activity bar → see the panel.

**Milestone:** sidebar visible in VS Code.

#### 1B. MCP server scaffold (~1.5 h)

```bash
cd apps/mcp-server
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D tsx typescript @types/node
```

Implement a single stub tool `wiki.update_learnings` that just echoes its args. Use `StdioServerTransport`. Register in `~/.claude.json` (or `.mcp.json` at the project root):

```json
{
  "mcpServers": {
    "trailhead": {
      "command": "npx",
      "args": ["tsx", "/abs/path/to/apps/mcp-server/src/index.ts"],
      "env": {
        "TRAILHEAD_API_URL": "https://trailheadapi-production.up.railway.app",
        "TRAILHEAD_TEAM_TOKEN": "trailhead_demo_acme_2026"
      }
    }
  }
}
```

> Use **absolute paths** in the MCP config. Claude Code's CWD is not yours; relative paths will fail.

In a Claude Code session: *"call the trailhead update_learnings tool with node_path='src/api/' and insight='hello'"* — confirm the echo response in chat.

**Milestone:** Claude Code can call your MCP tool.

**End of Phase 1:** both pieces alive. From here, integration is straightforward.

---

### Phase 2 · Wire to the live API (hours 6–10)

Now the skeletons do real work. You depend on Person D for some endpoints; my delivery order matches your need order.

| You need | Person D delivers by hour |
|---|---|
| `/score` real (or stub remains — types match either way) | 6 |
| `/wiki/propose` real (normalize + dedup + counter) | 8 |
| `/examples?path=` | 8 |

Stubs always match the real shapes, so you're never *blocked* — only the demo behavior changes when the real impl lands.

#### 2A. Sidebar pre-prompt panel (~1 h)

In the extension:
- Listen on `vscode.window.onDidChangeActiveTextEditor`
- Derive folder path from the active file (`src/api/webhooks/handler.ts` → `src/api/webhooks/`)
- `fetch(`${API_URL}/examples?path=${path}`, { headers: {...} })`
- Render the top 3 examples in the webview: topic + reuse_count + first ~80 chars of template

#### 2B. Sidebar score-card webview (~2 h)

Below the examples panel, add a textarea + score display:
- 250ms debounce on input
- POST `/score` with `{ prompt, file_path: activeFilePath, user_id: 'demo' }`
- Render the 5-dimension breakdown identically to the browser ext

**Coordinate with Person B (browser ext):** write a vanilla DOM render function in `packages/score-card` and import it from both surfaces. The score JSON is identical; the rendering should be too.

#### 2C. MCP `wiki.update_learnings` for real (~30 min)

Replace the echo with `fetch(`${API_URL}/wiki/propose`, ...)`. Return the response (`action`, `current_count`, `promoted_to_durable`) to Claude Code — that's your demo drama.

**End of Phase 2:** demonstrable end-to-end flow. Claude Code conversation → MCP `wiki.update_learnings` → `/wiki/propose` returns `created`/`reinforced`/`promoted` from real DB rows.

---

### Phase 3 · The autonomous demo moment + remaining MCP tools (hours 10–14)

The demo's Act III becomes real here.

#### 3A. Sidebar polls `/wiki/recent` (~1 h)

Every 2s while the panel is visible:

```ts
const since = lastSeenTimestamp;
const res = await fetch(`${API_URL}/wiki/recent?since=${since}`, { headers: {...} });
const { items } = await res.json();
for (const item of items) {
  const prev = state.get(item.id);
  if (!prev) {
    toast(`Wiki updated: «${truncate(item.body)}» — created`);
  } else if (item.reinforcement_count > prev.reinforcement_count) {
    if (item.status === 'durable' && prev.status === 'draft') {
      toast(`Wiki updated: «${truncate(item.body)}» — reinforced ${item.reinforcement_count}/3, promoted to durable`);
    } else {
      toast(`Wiki updated: «${truncate(item.body)}» — reinforced ${item.reinforcement_count}`);
    }
  }
  state.set(item.id, item);
  lastSeenTimestamp = max(lastSeenTimestamp, item.last_seen_at);
}
```

Render toasts via `vscode.window.showInformationMessage`. Update the sidebar's wiki list as items change.

#### 3B. MCP `wiki.context_for` (~30 min)

`fetch(`${API_URL}/context?path=${path}`)` → render the layered HCL bundle as a single text block returned to Claude Code.

#### 3C. MCP `wiki.search` (~30 min)

For hackathon: client-side filter from `wiki.context_for`'s output, OR call a `/search?q=...` endpoint if Person D ships it. Either is acceptable.

#### 3D. MCP `wiki.rules_for` (~30 min)

Thin wrapper around `wiki.context_for`: return only `body_md` content from each ancestor node, no learnings.

#### 3E. `npx trailhead-mcp init` install script (~1.5 h)

A small Node CLI in `apps/mcp-server/bin/init.mjs` that:
1. Locates `~/.claude.json` (creates if absent)
2. Adds the `trailhead` entry to `mcpServers`
3. Appends the always-on coach directive to `./CLAUDE.md` (unless `--no-auto-coach`)
4. Prints `trailhead is registered. Restart Claude Code.`

This is a demo moment in itself: *"one command, wired in"* > 6-step config copy-paste.

#### 3F. Articulation scaffold (Cmd+Shift+K) — defer

Spec §2 says cut this first. Skip until Phase 5 if time permits.

**End of Phase 3:** sidebar shows live toasts on wiki updates; full MCP tool suite works.

---

### Phase 4 · Integration testing (hours 14–18)

Most demos die in this window. Don't skip.

1. **Run the §13 storyboard verbatim, 3 times in a row** — VS Code with integrated terminal running Claude Code, MCP registered.
2. **Rehearse the trigger phrase** that reliably gets Claude Code to call `wiki.update_learnings`. If it misses, the demonstrator can fall back to telling Claude Code to call it explicitly.
3. **Force the API-down case** — stop the Railway service for 30s. Confirm the sidebar shows a graceful "couldn't reach coach" state (or just nothing).
4. **Verify dedup** — trigger the same insight three times via MCP within the same session. Confirm `current_count` increments correctly and `status='durable'` flips exactly once.

After this phase, screen-record the full demo flow (Claude Code → sidebar toast → wiki update). Refresh the recording at hour 22.

---

### Phase 5 · Polish + rehearsal (hours 18–24)

Slack absorber. Order if you fall behind:

1. Make sure §13 demo runs flawlessly 3 times in a row → that's the bar
2. Refresh the fallback recording
3. (only if time) Articulation scaffold Cmd+Shift+K
4. (only if time) MCP `wiki.search` polish

---

## 5. Risks specific to this lane

1. **MCP server disconnect mid-demo.** If your MCP process dies, Claude Code shows a tool-not-available state. Smoke-test the MCP startup at hour 6, again at hour 18, and one more time before the demo.
2. **MCP autonomous call doesn't fire.** Claude Code may not call `wiki.update_learnings` for every insight. Rehearse the trigger phrase so it's reliable; if it misses on stage, the demonstrator tells Claude Code to call it explicitly.
3. **Webview CSP / network.** VS Code webviews enforce a Content Security Policy. The sidebar's `fetch` to Railway needs the right `<meta http-equiv="Content-Security-Policy">`. Test from a cold open at hour 6, not hour 22.
4. **`tsx` path resolution from MCP config.** Absolute paths in `~/.claude.json` work; relative paths don't. If you must use a wrapper script, `cd` in the wrapper.
5. **Settings file format drift.** Claude Code has changed file layouts before. Verify the file path your installed Claude Code version uses; document it.

---

## 6. Cuts (in priority order if behind)

1. **Articulation scaffold (Cmd+Shift+K)** — score-card + sidebar are the visible demo elements
2. **MCP `wiki.search`** — `wiki.context_for` and `wiki.rules_for` cover most demo needs
3. **`npx trailhead-mcp init` install script** — manual config also works
4. **VS Code score-card webview** — if pre-prompt panel + wiki updates work, that's enough on the IDE side

**Don't cut:** the sidebar wiki-update toast (this is the demo's autonomous moment) and the MCP `wiki.update_learnings` tool (the dramatic call).

---

## 7. Definition of done

- [ ] VS Code extension loads; sidebar visible in activity bar
- [ ] Sidebar shows team-anchored example prompts for the active file
- [ ] Sidebar shows live score-card matching browser-ext UI
- [ ] MCP server registered in Claude Code; `wiki.update_learnings` succeeds with real `/wiki/propose` response
- [ ] When the same insight is reinforced 3 times across MCP calls, it promotes to `durable`
- [ ] Sidebar shows toast on wiki update within 2s
- [ ] Full §13 demo runs end-to-end in VS Code with integrated terminal, 3 times in a row
- [ ] Fallback screen recording exists for the autonomous wiki-update segment

---

## 8. Reference: useful files in this repo

- **Spec:** `docs/superpowers/specs/2026-04-25-trailhead-design.md`
- **Shared types:** `packages/shared/types.ts`
- **Schema:** `packages/db/schema.sql`
- **API stub source (live shape reference):** `apps/api/src/index.ts`
- **Env template:** `.env.example`
- **Browser ext lane (your sibling):** `docs/roadmaps/2026-04-25-roadmap-browser-extension.md`
