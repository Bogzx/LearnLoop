// Wiki bootstrap: POST /onboard/repo (skeleton), /onboard/repo/full (async rich job) and job status.
// Mounted by app.ts, which applies auth, body caps and rate limits first.
import { Hono } from 'hono';
import type {
  OnboardRepoFullRequest,
  OnboardRepoFullResponse,
  OnboardRepoRequest,
  OnboardRepoResponse,
  WikiJobPathKind,
  WikiJobPathStatus,
  WikiJobStatusResponse,
} from '@trailhead/shared';
import { normalizePath } from '@trailhead/scoring';
import { applyTeamNameIfPlaceholder, q } from '../db.ts';
import { isUuid } from '../request-params.ts';
import { invalidateTeamContext } from '../team-context.ts';
import { bundleFromRequest, runJob } from '../wiki-bootstrap-job.ts';
import type { AppEnv } from '../http.ts';
import { llmMode } from '../llm-mode.ts';

export const onboardRoutes = new Hono<AppEnv>();

// ----- POST /onboard/repo ----------------------------------------------------
// Bootstrap a team wiki by upserting one node per path. Idempotent: re-running
// with the same paths is a no-op (the existing node row is left untouched).
// `initial_rules[path]` lets the caller seed `body_md` for any/all of the
// supplied paths — useful when the caller has, say, scanned a repo's existing
// CLAUDE.md or copied conventions from another tool.
//
// Spec ref:
//   docs/superpowers/specs/2026-04-25-demo-completion-design.md §C.1
//   docs/superpowers/specs/2026-04-25-mcp-plugin-ux-design.md (bootstrap UX
//     follow-up — wired through wiki_bootstrap MCP tool + `trailhead-mcp
//     bootstrap` CLI subcommand).

const ONBOARD_MAX_PATHS = 200;

onboardRoutes.post('/onboard/repo', async (c) => {
  const body = await c.req.json<OnboardRepoRequest>().catch(() => null);
  if (!body || !Array.isArray(body.paths)) {
    return c.json({ error: 'bad_request', detail: 'paths: string[] required' }, 400);
  }
  if (body.paths.length === 0) {
    return c.json({ error: 'bad_request', detail: 'paths must not be empty' }, 400);
  }
  if (body.paths.length > ONBOARD_MAX_PATHS) {
    return c.json(
      { error: 'too_many_paths', detail: `max ${ONBOARD_MAX_PATHS} paths per request` },
      400,
    );
  }
  const initialRules =
    body.initial_rules && typeof body.initial_rules === 'object' && !Array.isArray(body.initial_rules)
      ? body.initial_rules
      : {};

  // Normalize + dedupe paths so we don't issue duplicate inserts inside one
  // request (the UNIQUE constraint would catch it but the per-row upsert
  // round-trip is wasted).
  const seen = new Set<string>();
  const normalized: { raw: string; path: string }[] = [];
  for (const raw of body.paths) {
    if (typeof raw !== 'string') continue;
    const path = normalizePath(raw);
    if (!path) continue;                  // empty string after normalization — skip
    if (seen.has(path)) continue;
    seen.add(path);
    normalized.push({ raw, path });
  }

  if (normalized.length === 0) {
    return c.json({ error: 'bad_request', detail: 'no valid paths after normalization' }, 400);
  }

  if (typeof body.team_name === 'string' && body.team_name.trim()) {
    await applyTeamNameIfPlaceholder(c.get('team_token'), body.team_name);
  }

  const nodes: { path: string; id: string }[] = [];
  let nodes_created = 0;

  for (const { raw, path } of normalized) {
    // body_md from initial_rules — match against either the normalized form
    // or the caller's raw string so callers don't need to pre-normalize keys.
    const seedBody =
      typeof initialRules[path] === 'string'
        ? initialRules[path]
        : typeof initialRules[raw] === 'string'
          ? initialRules[raw]
          : '';

    // xmax = 0 in the RETURNING row means the tuple was newly inserted (PG
    // marks it 0 on fresh inserts; ON CONFLICT updates set xmax to the
    // current xid). Lets us count creates without a second query.
    const rows = await q<{ id: string; inserted: boolean }>(
      `INSERT INTO nodes (team_token, path, body_md)
         VALUES ($1, $2, $3)
       ON CONFLICT (team_token, path) DO UPDATE
         SET body_md = CASE
               WHEN $3 <> '' AND nodes.body_md = '' THEN $3
               ELSE nodes.body_md
             END,
             updated_at = NOW()
       RETURNING id, (xmax = 0) AS inserted`,
      [c.get('team_token'), path, seedBody],
    );
    const row = rows[0]!;
    if (row.inserted) nodes_created += 1;
    nodes.push({ path, id: row.id });
  }

  invalidateTeamContext(c.get('team_token'));
  const res: OnboardRepoResponse = { nodes_created, nodes };
  return c.json(res);
});

// ----- POST /onboard/repo/full -----------------------------------------------
// Rich (LLM-generated) bootstrap. Accepts the discovered folder paths plus
// the file contents (already capped client-side) plus optional manifest
// snippets and CLAUDE.md seed text. Creates a wiki_jobs row + one
// wiki_job_paths row per node and kicks off the worker via setImmediate.
// Returns the job_id immediately; the worker fills body_md asynchronously.
//
// Spec: docs/superpowers/specs/2026-04-26-wiki-bootstrap-rich-design.md §9

// Server-side hard ceilings. Independent of the client's CLI flags so a
// rogue client can't blow the API host's RAM. Conservative — these are
// "abuse cap" not "expected size".
const ONBOARD_FULL_MAX_FOLDERS = 1_000;
const ONBOARD_FULL_MAX_FILES = 2_000;
const ONBOARD_FULL_MAX_FILE_CHARS = 32_000;   // per file
const ONBOARD_FULL_MAX_BUNDLE_BYTES = 16 * 1024 * 1024;  // 16 MB

onboardRoutes.post('/onboard/repo/full', async (c) => {
  if (llmMode() === 'offline') {
    return c.json(
      {
        error: 'llm_unavailable',
        detail:
          'The rich wiki bootstrap needs an LLM and this server runs with TRAILHEAD_LLM=offline. ' +
          'Use `bootstrap --minimal` for the skeleton wiki, or set GEMINI_API_KEY.',
      },
      503,
    );
  }
  const body = await c.req.json<OnboardRepoFullRequest>().catch(() => null);
  if (!body || !Array.isArray(body.folders) || !Array.isArray(body.files)) {
    return c.json(
      { error: 'bad_request', detail: 'folders: string[] and files: {path,content}[] required' },
      400,
    );
  }
  if (body.folders.length > ONBOARD_FULL_MAX_FOLDERS) {
    return c.json({ error: 'too_many_folders', detail: `max ${ONBOARD_FULL_MAX_FOLDERS}` }, 400);
  }
  if (body.files.length > ONBOARD_FULL_MAX_FILES) {
    return c.json({ error: 'too_many_files', detail: `max ${ONBOARD_FULL_MAX_FILES}` }, 400);
  }
  let bundleBytes = 0;
  for (const f of body.files) {
    if (typeof f?.path !== 'string' || typeof f?.content !== 'string') {
      return c.json({ error: 'bad_request', detail: 'each file requires path:string and content:string' }, 400);
    }
    if (f.content.length > ONBOARD_FULL_MAX_FILE_CHARS) {
      return c.json(
        { error: 'file_too_large', detail: `${f.path}: max ${ONBOARD_FULL_MAX_FILE_CHARS} chars per file` },
        400,
      );
    }
    bundleBytes += Buffer.byteLength(f.content, 'utf8');
    if (bundleBytes > ONBOARD_FULL_MAX_BUNDLE_BYTES) {
      return c.json(
        { error: 'bundle_too_large', detail: `max ${ONBOARD_FULL_MAX_BUNDLE_BYTES / (1024 * 1024)} MB` },
        400,
      );
    }
  }

  const teamToken = c.get('team_token');

  if (typeof body.team_name === 'string' && body.team_name.trim()) {
    await applyTeamNameIfPlaceholder(teamToken, body.team_name);
  }

  // Normalize folder paths (trailing slash) and dedupe.
  const folderSet = new Set<string>();
  for (const raw of body.folders) {
    const p = normalizePath(raw);
    if (p) folderSet.add(p);
  }
  const folders = [...folderSet];
  // De-dupe files on path; preserve first occurrence.
  const seenFiles = new Set<string>();
  const files = body.files.filter((f) => {
    const p = String(f.path).trim();
    if (!p || p.endsWith('/') || seenFiles.has(p)) return false;
    seenFiles.add(p);
    return true;
  });

  // paths_total = folders + files + 1 root pass.
  const pathsTotal = folders.length + files.length + 1;

  // Insert job header and per-path rows in one transaction so a partial
  // failure doesn't leave a job with no work items.
  const jobRows = await q<{ id: string }>(
    `INSERT INTO wiki_jobs (team_token, paths_total) VALUES ($1, $2) RETURNING id`,
    [teamToken, pathsTotal],
  );
  const jobId = jobRows[0]!.id;

  // Build wiki_job_paths rows. Use a single multi-row insert for speed.
  const pathRows: Array<[string, string, WikiJobPathKind]> = [
    [jobId, '', 'root'],
    ...folders.map((p): [string, string, WikiJobPathKind] => [jobId, p, 'folder']),
    ...files.map((f): [string, string, WikiJobPathKind] => [jobId, f.path, 'file']),
  ];
  // Pg parameter array unrolling — keep it simple with one INSERT per row;
  // the volume is low enough (typically 100-700 rows) that batching isn't
  // critical, and the simpler code is harder to get wrong.
  for (const [job, p, kind] of pathRows) {
    await q(
      `INSERT INTO wiki_job_paths (job_id, path, kind) VALUES ($1, $2, $3)
       ON CONFLICT (job_id, path) DO NOTHING`,
      [job, p, kind],
    );
  }

  // Kick off the worker. setImmediate keeps it strictly fire-and-forget —
  // the response returns now; runJob handles its own errors and never
  // throws to here.
  const bundle = bundleFromRequest({ ...body, folders, files });
  setImmediate(() => {
    runJob(jobId, teamToken, bundle).catch((e) => {
      console.error(`[wiki-job ${jobId}] uncaught:`, e);
    });
  });

  const res: OnboardRepoFullResponse = { job_id: jobId, paths_total: pathsTotal };
  return c.json(res);
});

// ----- GET /onboard/jobs/:id -------------------------------------------------
// Status snapshot for a rich-bootstrap job. Clients (CLI, MCP tool) poll
// this every 2s. Returns the job header counters plus per-path rows so the
// UI can render which path is processing / which failed.
//
// Cross-team safety: the auth middleware sets team_token from the X-Team-Token
// header; the WHERE clause filters on it. A team can only see its own jobs
// (otherwise a leaked job_id would be a tenancy break).

onboardRoutes.get('/onboard/jobs/:id', async (c) => {
  const id = c.req.param('id');
  if (!id || !isUuid(id)) {
    return c.json({ error: 'bad_request', detail: 'invalid job id' }, 400);
  }
  const teamToken = c.get('team_token');

  const headers = await q<{
    id: string;
    status: 'pending' | 'running' | 'done' | 'failed';
    paths_total: number;
    paths_done: number;
    paths_failed: number;
    started_at: Date | null;
    finished_at: Date | null;
    error: string | null;
  }>(
    `SELECT id, status, paths_total, paths_done, paths_failed, started_at, finished_at, error
       FROM wiki_jobs WHERE team_token = $1 AND id = $2`,
    [teamToken, id],
  );
  if (headers.length === 0) return c.json({ error: 'not_found' }, 404);
  const h = headers[0]!;

  const pathRows = await q<{
    path: string; kind: WikiJobPathKind; status: WikiJobPathStatus['status']; error: string | null;
  }>(
    `SELECT path, kind, status, error FROM wiki_job_paths WHERE job_id = $1 ORDER BY kind, path`,
    [id],
  );

  const res: WikiJobStatusResponse = {
    job_id: h.id,
    status: h.status,
    paths_total: h.paths_total,
    paths_done: h.paths_done,
    paths_failed: h.paths_failed,
    started_at: h.started_at ? h.started_at.toISOString() : null,
    finished_at: h.finished_at ? h.finished_at.toISOString() : null,
    error: h.error,
    paths: pathRows.map((r) => ({
      path: r.path,
      kind: r.kind,
      status: r.status,
      ...(r.error ? { error: r.error } : {}),
    })),
  };
  return c.json(res);
});
