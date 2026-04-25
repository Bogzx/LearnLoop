# Roadmap — VS Code Extension + MCP Server + Stop Hook (Person C)

**Date:** 2026-04-25 (PoliHack 24h hackathon)
**Spec:** [`docs/superpowers/specs/2026-04-25-trailhead-design.md`](../superpowers/specs/2026-04-25-trailhead-design.md) — read §3, §7, §8 first
**Status as of writing:** unblocker complete (shared types locked, schema written, Hono stub deployed at `https://trailheadapi-production.up.railway.app`)

---

## 1. What you own

Three artifacts, one TypeScript codebase, three independent deployment targets:

1. **VS Code extension** (`apps/vscode-ext/`) — the visible IDE coaching UI: sidebar webview with pre-prompt examples, score-card, wiki view, wiki-update toasts.
2. **MCP server** (`apps/mcp-server/`) — standalone Node binary registered in Claude Code / Claude Desktop. Exposes `wiki.update_learnings`, `wiki.context_for`, `wiki.search`, `wiki.rules_for`.
3. **Claude Code Stop hook** (`apps/stop-hook/`) — deterministic backstop that fires after every assistant turn; extracts learnings via Haiku and POSTs to `/wiki/propose`.

**Why both MCP and hook?**
- The MCP tool is the demo *drama* — Claude Code visibly calls `wiki.update_learnings` mid-conversation.
- The Stop hook is the demo *reliability* — fires deterministically whether or not the model chose to call the tool.
- Server-side dedup on `(node_id, body_normalized)` makes both paths idempotent: if both fire for the same insight, the count only increments once.

The pitch story is "the AI updates the wiki mid-conversation." That stays true via either path. The hook's job is to make sure it's true *every* time, not 80% of the time.

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
| Stop hook → `/wiki/propose` | Same backend path; idempotent dedup | ✅ |

**One index Person D should add** (cheap insurance for the polling query):
```sql
CREATE INDEX IF NOT EXISTS idx_learnings_last_seen_at ON learnings(last_seen_at DESC);
```

**Two conventions that live in code, not schema:**
1. **All `nodes.path` values stored with a trailing slash** (`'src/api/auth/'`, never `'src/api/auth'`). The HCL `LIKE path || '%'` query depends on the trailing slash to avoid `'src/api/auth_helpers.ts'` matching `'src/api/auth/'` falsely. Bake into seed data and into any insert helper you write.
2. **`body_normalized` = lowercase + strip non-alphanumeric.** The MCP tool, the Stop hook, and `/wiki/propose` must use the **same** normalizer. Lives in a small shared helper imported by both backend and hook (e.g. `packages/scoring/normalize.ts`).

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

#### 1C. Stop hook scaffold (~30 min)

Create `apps/stop-hook/trailhead-hook.mjs` (Node, not bash — Windows compatibility):

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const stdin = readFileSync(0, 'utf8');
const payload = JSON.parse(stdin);
console.error(`[trailhead-hook] fired at ${new Date().toISOString()}: ${stdin.length} bytes`);
process.exit(0);
```

Register in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "node /abs/path/to/apps/stop-hook/trailhead-hook.mjs"
      }]
    }]
  }
}
```

Also pipe to a file you can `tail -f`, because Claude Code suppresses hook stderr from the user:

```js
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const LOG = join(homedir(), '.trailhead-hook.log');
appendFileSync(LOG, `[${new Date().toISOString()}] fired, ${stdin.length}b\n`);
```

Trigger any Claude Code turn → `tail -f ~/.trailhead-hook.log` → see the entry.

**Milestone:** hook fires after every assistant turn, log file confirms.

**End of Phase 1:** all three pieces alive. From here, integration is straightforward.

---

### Phase 2 · Wire to the live API (hours 6–10)

Now the skeletons do real work. You depend on Person D for some endpoints; my delivery order matches your need order.

| You need | Person D delivers by hour |
|---|---|
| `/score` real (or stub remains — types match either way) | 6 |
| `/wiki/propose` real (normalize + dedup + counter) | 8 |
| `/examples?path=` | 8 |
| `packages/scoring/extract-prompt.ts` (Haiku learning-extractor) | 8 |

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

#### 2D. Stop hook → `/wiki/propose` for real (~1.5 h)

The hook earns its keep here. Pseudocode:

```js
import { readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const LOG = join(homedir(), '.trailhead-hook.log');
const log = (msg) => appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);

try {
  const stdin = readFileSync(0, 'utf8');
  const payload = JSON.parse(stdin);
  const { user_prompt, assistant_response } = extractTurn(payload);

  // Cheap bail-out: short responses rarely contain durable learnings.
  if (!assistant_response || assistant_response.length < 80) {
    log('skipped: short response');
    process.exit(0);
  }

  const client = new Anthropic();   // reads ANTHROPIC_API_KEY from env
  const haiku = await client.messages.create({
    model: 'claude-haiku-4-5',
    system: EXTRACT_PROMPT,         // imported from packages/scoring
    messages: [{
      role: 'user',
      content: `Prompt: ${user_prompt}\n\nResponse: ${assistant_response}`,
    }],
    max_tokens: 200,
  });

  const learning = parseLearning(haiku);   // null if no learning detected
  if (!learning) { log('no learning extracted'); process.exit(0); }

  const res = await fetch(`${process.env.TRAILHEAD_API_URL}/wiki/propose`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Team-Token': process.env.TRAILHEAD_TEAM_TOKEN,
    },
    body: JSON.stringify({ node_path: learning.node_path, insight: learning.insight }),
  });
  log(`posted: ${res.status} ${await res.text()}`);
} catch (e) {
  log(`error: ${e.message}`);
  process.exit(0);  // NEVER throw; hook errors must never reach the user
}
```

> Wrap the entire body in `try / catch`. Failures must NOT propagate. Even `process.exit(1)` is fine — Claude Code suppresses hook errors from the user — but the `tail -f ~/.trailhead-hook.log` is your only signal during testing.

**End of Phase 2:** demonstrable end-to-end flow. Claude Code conversation → MCP path or hook path → `/wiki/propose` returns `created`/`reinforced`/`promoted` from real DB rows.

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
1. Locates `~/.claude/settings.json` (creates if absent)
2. Adds the `trailhead` entry to `mcpServers`
3. Adds the Stop hook command to `hooks.Stop`
4. Writes/updates `apps/mcp-server/.env` with the Railway URL + token
5. Prints `trailhead is registered. Restart Claude Code.`

This is a demo moment in itself: *"one command, wired in"* > 6-step config copy-paste.

#### 3F. Articulation scaffold (Cmd+Shift+K) — defer

Spec §2 says cut this first. Skip until Phase 5 if time permits.

**End of Phase 3:** sidebar shows live toasts on wiki updates; full MCP tool suite works.

---

### Phase 4 · Integration testing (hours 14–18)

Most demos die in this window. Don't skip.

1. **Run the §13 storyboard verbatim, 3 times in a row** — VS Code with integrated terminal running Claude Code, MCP registered, hook installed.
2. **Force the MCP-skips-tool case** — prompt Claude Code in a way that *doesn't* trigger an MCP tool call (e.g., "summarize this code"). Confirm the Stop hook still extracts and posts. **This proves the backstop works.**
3. **Force the hook-fails case** — temporarily add `process.exit(1)` to the hook. Confirm Claude Code keeps running and the user sees no error. Revert.
4. **Force the API-down case** — stop the Railway service for 30s. Confirm the sidebar shows a graceful "couldn't reach coach" state (or just nothing) and the hook silently no-ops.
5. **Verify dedup** — trigger the same insight twice via MCP, then once via hook within the same session. Confirm `current_count` increments correctly and `status='durable'` flips exactly once.

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

1. **Hook crashes silently.** Claude Code suppresses hook stderr. Always `try/catch` the entire hook body and log to `~/.trailhead-hook.log`. A bug discovered at hour 23 = demo lost.
2. **MCP server disconnect mid-demo.** If your MCP process dies, Claude Code shows a tool-not-available state. Test with the MCP server intentionally killed — the Stop hook path must still work. The hook is the deterministic backstop.
3. **Webview CSP / network.** VS Code webviews enforce a Content Security Policy. The sidebar's `fetch` to Railway needs the right `<meta http-equiv="Content-Security-Policy">`. Test from a cold open at hour 6, not hour 22.
4. **`tsx` path resolution from MCP config.** Absolute paths in `~/.claude.json` work; relative paths don't. If you must use a wrapper script, `cd` in the wrapper.
5. **Hook fires on every turn** including one-word answers. Mitigation: bail in the hook if `assistant_response.length < 80`. Saves ~50% of Haiku calls without losing demo signal.
6. **Settings file format drift.** `~/.claude.json` vs `~/.claude/settings.json` — Claude Code has changed file layouts before. Verify the file path your installed Claude Code version uses; document it.

---

## 6. Cuts (in priority order if behind)

1. **Articulation scaffold (Cmd+Shift+K)** — score-card + sidebar are the visible demo elements
2. **MCP `wiki.search`** — `wiki.context_for` and `wiki.rules_for` cover most demo needs
3. **`npx trailhead-mcp init` install script** — manual config also works
4. **VS Code score-card webview** — if pre-prompt panel + wiki updates work, that's enough on the IDE side
5. **The Stop hook itself** — if you can't ship it, the MCP path alone still works; the hook is the *backstop*, not the only path

**Don't cut:** the sidebar wiki-update toast (this is the demo's autonomous moment) and the MCP `wiki.update_learnings` tool (the dramatic call).

---

## 7. Definition of done

- [ ] VS Code extension loads; sidebar visible in activity bar
- [ ] Sidebar shows team-anchored example prompts for the active file
- [ ] Sidebar shows live score-card matching browser-ext UI
- [ ] MCP server registered in Claude Code; `wiki.update_learnings` succeeds with real `/wiki/propose` response
- [ ] Stop hook fires on every assistant turn (verified in `~/.trailhead-hook.log`)
- [ ] When the same insight is reinforced 3 times across MCP + hook calls, it promotes to `durable`
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
