# Rich `wiki_bootstrap` — Karpathy-style auto-generated wiki

**Date:** 2026-04-26
**Status:** Draft, pending implementation plan
**Scope:** Extend `wiki_bootstrap` so it actually populates the wiki database with rich, code-derived content — folder narratives, per-file summaries, and a repo-root tour. Today the tool only creates empty `nodes` rows (one per folder) and seeds `body_md` from `CLAUDE.md` for the root node. After this work, a single bootstrap run produces a DeepWiki-flavored wiki end-to-end.

**Non-scope:** No dashboard markdown/mermaid rendering changes (stays as `<pre>` for now — rich content displays as raw markdown source). No new LLM provider; Gemini stays. No browser-ext, Stop-hook, scoring, or coaching-directive changes.

## 1. Goal

A new joiner running `trailhead-mcp bootstrap --rich` (or the model calling `wiki_bootstrap` in `mode='rich'`) ends up with:

- A repo root node containing a coherent textbook-style overview of the codebase.
- A per-folder node for every source folder, each with a multi-section narrative tour: what it does, key files, conventions, gotchas, cross-links.
- A per-file node for every source file, each a short summary (~100-200 words) of what the file does and its public exports.
- Conventions extracted from the code surfaced as `learnings` rows (status `draft`) so the prompt coach picks them up via `/context` automatically.
- Re-runs that never silently destroy user-written content.

## 2. Why

Today's `wiki_bootstrap` creates the *skeleton* of a wiki — folder paths with empty `body_md`. The downstream consumers (the prompt coach via `/context`, the dashboard `/wiki` view) work but have nothing to surface until a human types rules into `wiki_save`. That gap kills the demo and slows real adoption.

A rich bootstrap means the wiki has signal from minute one: the coach can score against actual conventions, the dashboard shows a real codebase tour, and the team has something concrete to edit and reinforce.

## 3. Architecture

### 3.1 End-to-end flow

```
MCP client (apps/mcp-server)              API server (apps/api)              Gemini
─────────────────────────────             ────────────────────              ──────
discoverPaths()    folder list
discoverFiles()    file list (same walk)
read & cap each file
       │
       │  POST /onboard/repo/full
       │  { paths, files: [{path, content}], force? }
       └──────────────────────►
                                  insert wiki_jobs row (status=pending)
                                  insert wiki_job_paths rows (one per node)
                                  return { job_id, paths_total }
                                  setImmediate(() => runJob(jobId))
                                                                ┌── pass 1: per-folder ──┐
                                                                ├── pass 2: per-file ────┼─►
                                                                └── pass 3: root ────────┘
                                  upsert nodes(body_md, body_source='bootstrap')
                                  insert learnings (conventions, status='draft')
                                  update wiki_jobs (paths_done++, status='done')

CLI / MCP poll GET /onboard/jobs/:id every 2s
shows progress bar, returns when status ∈ {done, failed}
```

### 3.2 Component split

| Layer | Responsibility |
|---|---|
| `apps/mcp-server/src/bootstrap.ts` | Walk cwd, discover folders + files, read file contents subject to caps, build the request bundle |
| `apps/mcp-server/src/api-client.ts` | `onboardRepoFull(body)`, `jobStatus(id)` |
| `apps/mcp-server/src/tools.ts` | `wiki_bootstrap` extended with `mode`, `force`, `job_id`; in-tool polling |
| `apps/mcp-server/src/bootstrap-cli.ts` | `--rich`, `--force` flags; live progress bar |
| `apps/api/src/index.ts` | `POST /onboard/repo/full`, `GET /onboard/jobs/:id` |
| `apps/api/src/wiki-bootstrap-job.ts` (new) | The 3-pass worker — Gemini calls, concurrency cap, row writes |
| `packages/db/schema.sql` | `nodes.body_source`, `wiki_jobs`, `wiki_job_paths` |
| `packages/scoring/src/path-helpers.mjs` | `ancestorPaths` includes the file path itself |
| `packages/shared/src/index.ts` | Types for the new request/response shapes |

## 4. Schema changes

Three small additions. No existing columns/tables are altered.

### 4.1 `nodes.body_source`

```sql
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS body_source TEXT NOT NULL DEFAULT 'manual';
-- values: 'manual' | 'bootstrap'
```

Bootstrap upsert rule:

- Default (no `force`):
  - If `body_md = ''` → write generated content, set `body_source='bootstrap'`.
  - Else (any non-empty body, regardless of source) → leave untouched. Re-runs are a no-op for already-populated rows. This is the safest default and makes incidental re-runs cheap (no surprise LLM bill).
- With `force=true`:
  - If `body_source ∈ {'bootstrap'}` or `body_md = ''` → overwrite with generated content, set `body_source='bootstrap'`.
  - Else (`body_source='manual'` with non-empty body) → still leave untouched. Manual edits survive even forced re-runs.

Net: `--force` refreshes bootstrap-generated rows; manual edits are inviolate; the only way to wipe a manual row is the existing `DELETE /team/data` reset path.

### 4.2 `wiki_jobs`

```sql
CREATE TABLE IF NOT EXISTS wiki_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES teams(id),
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  paths_total   INT NOT NULL,
  paths_done    INT NOT NULL DEFAULT 0,
  paths_failed  INT NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wiki_jobs_team_created ON wiki_jobs(team_id, created_at DESC);
```

### 4.3 `wiki_job_paths`

```sql
CREATE TABLE IF NOT EXISTS wiki_job_paths (
  job_id  UUID NOT NULL REFERENCES wiki_jobs(id) ON DELETE CASCADE,
  path    TEXT NOT NULL,
  kind    TEXT NOT NULL,                     -- 'folder' | 'file' | 'root'
  status  TEXT NOT NULL DEFAULT 'pending',   -- pending | running | done | failed
  error   TEXT,
  PRIMARY KEY (job_id, path)
);
```

## 5. Page schemas

Mermaid diagrams are deliberately **off** for V1 — the dashboard renders `body_md` as `<pre>` so mermaid would display as text source anyway, and the token cost isn't justified yet.

### 5.1 Per-folder page (target ~800-1500 words)

`# {folder_path}`

- **Overview** — 2-4 sentence answer to "what is this folder for?"
- **Architecture / data flow** — prose description of how the folder's pieces interact. No diagrams.
- **Key files** — bullet list, each entry: `**filename.ext**` + 2-3 sentence annotation citing the most important exports / functions. Optional 5-15 line code excerpt where it clarifies behavior.
- **Conventions** — bullet list of rules visible in the code (e.g., "All errors return JSON `{error, detail}`", "Idempotent on `event_id`"). Each bullet is **also** persisted as a `learnings` row with `status='draft'`.
- **Gotchas** — non-obvious invariants, comments saying "don't do X", workarounds for specific bugs.
- **See also** — cross-links to parent + sibling folders, e.g. `[src/api/](src/api/)`.

### 5.2 Per-file page (target ~100-200 words)

`# {file_path}`

- One-paragraph summary of what the file does.
- **Key exports** — bullet list, one line each (function name + one-line purpose).
- **Notes** — optional bullet for any gotcha or non-obvious behavior.

### 5.3 Repo root page (target ~1500-2500 words)

`# {repo_name}`

- **The pitch** — what this codebase is, written for a new joiner.
- **Subsystem index** — every top-level folder, one line each, linked.
- **Tech stack** — parsed from `package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` (whichever exist).
- **Conventions inherited from root files** — verbatim from `CLAUDE.md` + `.github/copilot-instructions.md` (preserves the existing seed behavior in `readSeedRules`).

## 6. LLM strategy

- **Model:** `gemini-2.5-flash` for all three passes. Reasoning: ~200-700 calls per real-repo bootstrap; Flash's cost (~$0.10 worst case) and latency (~1-3s/call) beat Gemma 4 31B at this volume, and Flash's `responseSchema` enforcement is what makes structured conventions extraction reliable.
- **Reuse:** `apps/api/src/gemini.ts`'s existing `withRetry` wrapper (handles 429/503/500 retries, 20s per-call timeout — the latter intentionally non-retryable per the 2026-04-25 incident note).
- **Three passes** inside the worker (`apps/api/src/wiki-bootstrap-job.ts`):
  1. **Folders** — parallel, concurrency cap 4. Input: folder path + each file's `(relpath, content)`. Output: `{ narrative_md, conventions: string[], gotchas: string[] }`.
  2. **Files** — parallel, concurrency cap 4. Input: file path + content + the folder's narrative (cross-context). Output: `{ narrative_md, conventions: string[] }`.
  3. **Root** — single call. Input: every folder's narrative (not raw code) + manifest snippets + root-file seed text. Output: `{ narrative_md }`.
- **Conventions persistence:** every `conventions[]` entry from passes 1 and 2 is written as a `learnings` row with `status='draft'` against the corresponding node. Existing dedup on `body_normalized` handles re-runs.
- **Cross-context (pass 2 sees pass 1):** files inside a folder are processed only after their folder's pass-1 output completes, and the folder's narrative is injected into the file prompt so file pages can reference siblings without each one re-deriving the picture from raw code.

## 7. Caps & budget

| Knob | Default | CLI flag | Why |
|---|---|---|---|
| Max chars per file | 8000 | `--max-chars-per-file` | Head + tail truncation if larger; covers most files; preserves imports + main exports |
| Max files per folder | 30 | `--max-files-per-folder` | Sample largest + entry-point files if more (`index.*`, `main.*`, files with `default export`) |
| Max files in bundle | 500 | `--max-files` | Hard ceiling per repo |
| Max bundle bytes | 5 MB | `--max-bundle-mb` | HTTP-payload sanity |
| LLM concurrency | 4 | `--concurrency` | Comfort zone for a single Gemini key |
| Job time budget | 10 min | (not flagged) | Kill + mark partial if exceeded |

If a cap forces sampling, the bundle includes a `truncated: true` note so the LLM can hedge ("partial view of the folder").

## 8. Idempotency / re-run policy

- Default re-run: a no-op for any row that already has `body_md`. Only empty rows get filled. New folders/files added since the last run get bootstrapped; everything else is left alone. This keeps incidental re-runs cheap and surprise-free.
- `--force` re-run: refreshes bootstrap-generated content (`body_source='bootstrap'` or empty rows). Manual edits via `wiki_save` always survive (`body_source='manual'` rows are skipped even with `--force`).
- `learnings`: re-runs hit the existing `body_normalized` dedup path (`/wiki/propose`-style); duplicates increment `reinforcement_count` instead of inserting.
- Job rows accumulate (one per run). A small `DELETE FROM wiki_jobs WHERE created_at < NOW() - INTERVAL '30 days'` cleanup is left as a future cron — not in scope here.

## 9. MCP tool / CLI surface

### 9.1 `wiki_bootstrap` tool — extended, no new tools

```ts
// inputSchema additions:
mode?: 'minimal' | 'rich'   // default 'minimal' (existing behavior preserved)
force?: boolean             // default false
job_id?: string             // poll a previous run instead of starting a new one
```

`mode='minimal'` (default): identical to today — folder discovery + path-only POST to `/onboard/repo`. No regression.

`mode='rich'`:
1. Tool walks cwd, builds the file bundle, POSTs `/onboard/repo/full`, gets `{ job_id, paths_total }`.
2. Tool polls `/onboard/jobs/:id` every 2s for up to **60s**.
3. If the job finishes within 60s: tool returns the full structured summary.
4. If still running at 60s: tool returns `{ job_id, status: 'running', paths_done, paths_total }` and a text message telling the model to either wait or call `wiki_bootstrap({ job_id })` again later. The 3-tool surface stays intact.

Per the 3-hero-tools doctrine (`docs/superpowers/specs/2026-04-25-mcp-plugin-ux-design.md` §3), no new tool is added.

### 9.2 `trailhead-mcp bootstrap` CLI

New flags:
- `--rich` — opt into the new flow.
- `--force` — overwrite bootstrap-generated content.
- All cap flags from §7.

When `--rich`:
- CLI POSTs the bundle, gets `job_id`, polls every 2s.
- Renders a live progress bar:
  ```
  Bootstrapping rich wiki... [###############----] 47/63 paths · 2 failed · 1m 12s
  ```
- Returns when `status ∈ {done, failed}`.
- Prints a per-path failure summary at the end (so the user can re-run targeted paths).

The existing default behavior (no flags) stays identical to today.

## 10. `ancestorPaths` extension

`packages/scoring/src/path-helpers.mjs` — extend the function to include the file path itself when the input is file-shaped:

```js
ancestorPaths('src/api/auth/issue.ts')
// today: ['', 'src/', 'src/api/', 'src/api/auth/']
// after: ['', 'src/', 'src/api/', 'src/api/auth/', 'src/api/auth/issue.ts']

ancestorPaths('src/api/auth/')          // unchanged: ['', 'src/', 'src/api/', 'src/api/auth/']
ancestorPaths('')                       // unchanged: ['']
```

Detection: if the input has no trailing `/` after normalization, append the un-slashed input as the deepest ancestor. Folder-shaped inputs are unaffected. The `/context` ancestor walk now naturally surfaces per-file pages to the prompt coach when the user is editing that exact file.

## 11. Error handling & partial success

- Per-path failures (Gemini timeout, malformed response, etc.) are isolated: that node's `wiki_job_paths.status='failed'` with the error text, but other paths continue. The job ends `status='done'` with `paths_failed > 0`.
- A whole-job failure (DB connection lost, etc.) sets `wiki_jobs.status='failed'` and the per-path rows that haven't started are left `pending` (the worker re-checks `status` before each path; on `failed`, it stops).
- Hard time budget (10 min): worker checks `started_at + 10m` before each path; on hit, sets `status='done'` with remaining paths marked `failed: 'time_budget_exceeded'`.

## 12. File touchpoints (preview)

- **New** `apps/api/src/wiki-bootstrap-job.ts` — the 3-pass worker.
- `apps/api/src/index.ts` — `POST /onboard/repo/full`, `GET /onboard/jobs/:id`.
- `packages/db/schema.sql` — `nodes.body_source`, `wiki_jobs`, `wiki_job_paths`.
- `apps/mcp-server/src/bootstrap.ts` — `discoverFiles`, file content reader with caps.
- `apps/mcp-server/src/api-client.ts` — `onboardRepoFull(body)`, `jobStatus(id)`.
- `apps/mcp-server/src/tools.ts` — extend `wiki_bootstrap` (`mode`, `force`, `job_id`, in-tool polling).
- `apps/mcp-server/src/bootstrap-cli.ts` — `--rich`, `--force`, cap flags, progress bar.
- `packages/scoring/src/path-helpers.mjs` — extend `ancestorPaths`.
- `packages/shared/src/index.ts` — types for `OnboardRepoFullRequest`, `OnboardRepoFullResponse`, `JobStatusResponse`.

## 13. Success criteria

- `trailhead-mcp bootstrap --rich` from a real ~50-folder, ~300-file repo completes in under 5 minutes wall clock.
- Every folder node has a non-empty `body_md` matching the §5.1 schema.
- Every code-extension file gets a node + short summary matching §5.2.
- Repo root node body matches §5.3.
- The prompt coach (`coach` tool) called against a file path inside the bootstrapped repo includes content from the matching folder node + the file node in its `/context` response.
- Re-running without `--force` is a no-op for any node that already has content; only newly-discovered empty paths get filled.
- Re-running with `--force` refreshes bootstrap content; nodes that the user has edited via `wiki_save` keep their content (`body_source='manual'` is still skipped under `--force`).

## 14. Risks

- **Gemini cost spike on a giant repo.** Mitigation: hard caps in §7 + visible CLI flags so a user can dial down before running.
- **Repetition-loop class of failures (cf. 2026-04-25 incident).** Mitigation: `responseSchema` enforcement + `maxOutputTokens` ceiling + non-retryable timeouts (existing `withRetry` policy).
- **Source-code privacy.** The MCP client sends repo source to the API server as part of the bundle. Mitigation: documented in the CLI's confirmation prompt; team's API server is the same one already receiving every coach prompt; bundle is discarded after the job completes (only generated `body_md` is persisted, not raw source).
- **Multi-instance race conditions.** API server is single-instance on Railway today. If we scale out, `setImmediate` won't survive across instances — the job needs a real worker queue. Mitigation: V1 is single-instance; revisit if/when we deploy >1 instance.
- **Coach noise from per-file pages.** Per-file pages add narrative content the coach pulls via `/context`. Mitigation: per-file pages are short (§5.2 cap of ~200 words), and the coach's `renderContext` already handles multi-node bundles.

## 15. Testing posture

Per project guidance, no `*.test.ts` files. Verification is end-to-end smoke tests:

- Run `trailhead-mcp bootstrap --rich --dry-run` against the repo itself and confirm the bundle structure / counts.
- Run `trailhead-mcp bootstrap --rich` against a small fixture repo (a copy of `apps/mcp-server` is fine), wait for completion, then:
  - `curl /wiki/tree` and confirm node count + non-empty `body_md` per node.
  - `curl /context?path=apps/mcp-server/src/tools.ts` and confirm the response includes both the folder node and the file node.
- Re-run without `--force` and confirm `updated_at` changes only on `body_source='bootstrap'` rows.
- Re-run with `--force` after `wiki_save`-ing a learning on one node and confirm the manual edit survives.
