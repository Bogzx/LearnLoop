// The team wiki: propose, context/examples lookups, search, recent changes, tree and export.
// Mounted by app.ts, which applies auth, body caps and rate limits first.
import { Hono } from 'hono';
import type {
  ContextNode,
  ContextResponse,
  ExamplesItem,
  ExamplesResponse,
  SearchResponse,
  WikiProposeRequest,
  WikiProposeResponse,
  WikiRecentItem,
  WikiRecentResponse,
  WikiTreeResponse,
} from '@trailhead/shared';
import { ancestorPaths, normalize, normalizePath } from '@trailhead/scoring';
import { q, upsertNode } from '../db.ts';
import { intParam } from '../request-params.ts';
import { loadWikiTree } from '../wiki-tree.ts';
import { exportFilename, renderWikiMarkdown } from '../wiki-export.ts';
import { invalidateTeamContext } from '../team-context.ts';
import type { AppEnv } from '../http.ts';

export const wikiRoutes = new Hono<AppEnv>();

// ----- POST /wiki/propose ----------------------------------------------------
// Normalize → dedup on (node_id, body_normalized) → increment count → promote
// to durable at >= 3. Idempotent: repeated calls for the same insight only
// reinforce the existing draft.

// Bigram-Jaccard similarity over normalized strings. Used as a paraphrase
// fallback when exact body_normalized match misses — catches "go through" /
// "flow through" style edits that the lowercase+strip-punct normalize can't
// collapse. Bigrams (vs unigrams) are deliberate: a polarity flip ("never"
// inserted into an otherwise identical sentence) drops the bigram score
// well below the threshold, so opposite-meaning insights stay distinct.
const PARAPHRASE_THRESHOLD = 0.7;

// Headroom under Postgres's ~2704-byte btree tuple limit for
// idx_learnings_node_normalized (the key also carries node_id + tuple header).
const MAX_INSIGHT_BYTES = 2048;

function bigramSet(normalized: string): Set<string> {
  const tokens = normalized.split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    out.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

function bigramJaccard(a: string, b: string): number {
  const aBg = bigramSet(a);
  const bBg = bigramSet(b);
  if (aBg.size === 0 || bBg.size === 0) return 0;
  let intersection = 0;
  for (const bg of aBg) if (bBg.has(bg)) intersection++;
  const union = aBg.size + bBg.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

wikiRoutes.post('/wiki/propose', async (c) => {
  const body = await c.req.json<WikiProposeRequest>().catch(() => null);
  if (!body || typeof body.node_path !== 'string' || typeof body.insight !== 'string') {
    return c.json({ error: 'bad_request' }, 400);
  }
  if (!body.insight.trim()) return c.json({ error: 'empty_insight' }, 400);

  // body_normalized is a btree index key, and Postgres rejects index rows over
  // ~2.7 KB — a longer insight failed the INSERT with a raw 500. Insights are
  // meant to be one-sentence conventions, so reject oversize ones up front.
  const bodyNormalized = normalize(body.insight);
  if (Buffer.byteLength(bodyNormalized, 'utf8') > MAX_INSIGHT_BYTES) {
    return c.json(
      { error: 'insight_too_long', detail: `max ${MAX_INSIGHT_BYTES} bytes after normalization` },
      400,
    );
  }

  const path = normalizePath(body.node_path);
  const nodeId = await upsertNode(c.get('team_token'), path);

  // Step 1: exact match on body_normalized — the cheap fast path. Hits when
  // the user (or LLM) sent the same insight verbatim or with only
  // punctuation/whitespace/case differences.
  const exact = await q<{
    id: string; reinforcement_count: number; status: 'draft' | 'durable';
  }>(
    `SELECT id, reinforcement_count, status
       FROM learnings
      WHERE node_id = $1 AND body_normalized = $2
      LIMIT 1`,
    [nodeId, bodyNormalized],
  );

  let matchId: string | null = null;
  let matchPriorStatus: 'draft' | 'durable' | null = null;
  if (exact.length) {
    matchId = exact[0]!.id;
    matchPriorStatus = exact[0]!.status;
  } else {
    // Step 2: paraphrase fallback. Pull this node's existing learnings and
    // compute bigram-Jaccard against each. Keeps the wiki from accumulating
    // near-duplicate drafts that never hit the 3× durability threshold.
    const candidates = await q<{
      id: string; body_normalized: string; status: 'draft' | 'durable';
    }>(
      `SELECT id, body_normalized, status
         FROM learnings
        WHERE node_id = $1`,
      [nodeId],
    );
    let best: { id: string; status: 'draft' | 'durable'; sim: number } | null = null;
    for (const cand of candidates) {
      const sim = bigramJaccard(bodyNormalized, cand.body_normalized);
      if (sim >= PARAPHRASE_THRESHOLD && (!best || sim > best.sim)) {
        best = { id: cand.id, status: cand.status, sim };
      }
    }
    if (best) {
      matchId = best.id;
      matchPriorStatus = best.status;
    }
  }

  let action: WikiProposeResponse['action'];
  let currentCount: number;
  let promotedToDurable = false;

  if (matchId === null) {
    const inserted = await q<{ reinforcement_count: number }>(
      `INSERT INTO learnings (node_id, body, body_normalized)
       VALUES ($1, $2, $3)
       RETURNING reinforcement_count`,
      [nodeId, body.insight.trim(), bodyNormalized],
    );
    action = 'created';
    currentCount = inserted[0]!.reinforcement_count;
  } else {
    const updated = await q<{ reinforcement_count: number; status: 'draft' | 'durable' }>(
      `UPDATE learnings
          SET reinforcement_count = reinforcement_count + 1,
              last_seen_at = NOW(),
              status = CASE WHEN reinforcement_count + 1 >= 3 THEN 'durable' ELSE status END
        WHERE id = $1
        RETURNING reinforcement_count, status`,
      [matchId],
    );
    const after = updated[0]!;
    currentCount = after.reinforcement_count;
    promotedToDurable = matchPriorStatus === 'draft' && after.status === 'durable';
    action = promotedToDurable ? 'promoted' : 'reinforced';
  }

  invalidateTeamContext(c.get('team_token'));
  const res: WikiProposeResponse = {
    action,
    current_count: currentCount,
    ...(promotedToDurable ? { promoted_to_durable: true } : {}),
  };
  return c.json(res);
});

// ----- GET /context?path= ----------------------------------------------------
// HCL ancestor walk: every node whose path is a prefix of the file path,
// shallow → deep, plus its top durable learnings.

wikiRoutes.get('/context', async (c) => {
  const filePath = c.req.query('path') ?? '';
  if (!filePath) return c.json({ error: 'missing_path' }, 400);

  const ancestors = ancestorPaths(filePath);
  if (ancestors.length === 0) {
    const res: ContextResponse = { nodes: [] };
    return c.json(res);
  }

  const rows = await q<{
    path: string; body_md: string; learning_body: string | null; reinforcement_count: number | null;
  }>(
    `SELECT n.path, n.body_md, l.body AS learning_body, l.reinforcement_count
       FROM nodes n
       LEFT JOIN learnings l
              ON l.node_id = n.id
             AND l.status = 'durable'
      WHERE n.team_token = $1
        AND n.path = ANY($2::text[])
      ORDER BY length(n.path) ASC, n.path ASC,
               COALESCE(l.reinforcement_count, 0) DESC`,
    [c.get('team_token'), ancestors],
  );

  const byPath = new Map<string, ContextNode>();
  for (const r of rows) {
    let node = byPath.get(r.path);
    if (!node) {
      node = { path: r.path, body_md: r.body_md, durable_learnings: [] };
      byPath.set(r.path, node);
    }
    if (r.learning_body) {
      node.durable_learnings.push({
        body: r.learning_body,
        reinforcement_count: r.reinforcement_count ?? 0,
      });
    }
  }

  const res: ContextResponse = {
    nodes: ancestors
      .map((p) => byPath.get(p))
      .filter((n): n is ContextNode => Boolean(n)),
  };
  return c.json(res);
});

// ----- GET /examples?path= ---------------------------------------------------
wikiRoutes.get('/examples', async (c) => {
  const filePath = c.req.query('path') ?? '';
  if (!filePath) return c.json({ error: 'missing_path' }, 400);
  const limit = intParam(c.req.query('limit'), 3, 1, 10);
  const ancestors = ancestorPaths(filePath);

  const rows = await q<{
    template: string; topic: string | null; reuse_count: number; node_path: string;
  }>(
    `SELECT p.template, p.topic, p.reuse_count, n.path AS node_path
       FROM prompts p
       JOIN nodes n ON n.id = p.node_id
      WHERE n.team_token = $1
        AND n.path = ANY($2::text[])
        AND p.status = 'graduated'
      ORDER BY p.reuse_count DESC, length(n.path) DESC
      LIMIT $3`,
    [c.get('team_token'), ancestors, limit],
  );

  const res: ExamplesResponse = { items: rows.map((r): ExamplesItem => ({
    template: r.template,
    topic: r.topic,
    reuse_count: r.reuse_count,
    node_path: r.node_path,
  })) };
  return c.json(res);
});

// ----- GET /search?q=&scope= -------------------------------------------------
// Free-text substring search across the team's wiki: rules (nodes.body_md),
// durable learnings (learnings.body), and graduated prompts (prompts.template).
// Optional `scope` constrains results to the ancestor paths of a file/folder
// (same shape as /context). Used by the wiki_lookup MCP tool when the caller
// passes only `query`, or `query` + `file_path` for a path-scoped search.
wikiRoutes.get('/search', async (c) => {
  const query = (c.req.query('q') ?? '').trim();
  if (!query) return c.json({ error: 'missing_q' }, 400);
  const limit = intParam(c.req.query('limit'), 50, 1, 100);
  const scope = c.req.query('scope');
  // ILIKE wildcards from user input shouldn't bleed into the pattern. Escape
  // %, _, and the escape char itself so a search for "100%" matches the
  // literal substring rather than "100<anything>".
  const escaped = query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const pattern = `%${escaped}%`;
  const teamToken = c.get('team_token');
  const ancestors = scope ? ancestorPaths(scope) : null;

  // Rule branch matches on body_md OR the node path itself — so a query like
  // "scoring" surfaces packages/scoring/ even when body_md doesn't repeat the
  // folder name. Path-only matches return a placeholder body so the renderer
  // doesn't dump the whole node narrative when the match was structural.
  const rows = await q<{ kind: 'rule' | 'learning' | 'prompt'; body: string; node_path: string }>(
    `SELECT 'rule'::text AS kind,
            CASE
              WHEN n.body_md ILIKE $2 THEN n.body_md
              ELSE '(matched on path: ' || n.path || ')'
            END AS body,
            n.path AS node_path
       FROM nodes n
      WHERE n.team_token = $1
        AND (n.body_md ILIKE $2 OR n.path ILIKE $2)
        AND ($3::text[] IS NULL OR n.path = ANY($3::text[]))
     UNION ALL
     SELECT 'learning'::text AS kind, l.body AS body, n.path AS node_path
       FROM learnings l
       JOIN nodes n ON n.id = l.node_id
      WHERE n.team_token = $1
        AND l.status = 'durable'
        AND l.body ILIKE $2
        AND ($3::text[] IS NULL OR n.path = ANY($3::text[]))
     UNION ALL
     SELECT 'prompt'::text AS kind, p.template AS body, n.path AS node_path
       FROM prompts p
       JOIN nodes n ON n.id = p.node_id
      WHERE n.team_token = $1
        AND p.status = 'graduated'
        AND p.template ILIKE $2
        AND ($3::text[] IS NULL OR n.path = ANY($3::text[]))
      LIMIT $4`,
    [teamToken, pattern, ancestors, limit],
  );

  const res: SearchResponse = { items: rows };
  return c.json(res);
});

// ----- GET /wiki/recent?since=ISO --------------------------------------------
wikiRoutes.get('/wiki/recent', async (c) => {
  const sinceParam = c.req.query('since');
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 60 * 60 * 1000);
  if (Number.isNaN(since.getTime())) return c.json({ error: 'bad_since' }, 400);
  const limit = intParam(c.req.query('limit'), 50, 1, 200);

  const rows = await q<{
    id: string;
    node_path: string;
    body: string;
    status: 'draft' | 'durable';
    reinforcement_count: number;
    last_seen_at: Date;
    created_at: Date;
  }>(
    `SELECT l.id, n.path AS node_path, l.body, l.status,
            l.reinforcement_count, l.last_seen_at, l.created_at
       FROM learnings l
       JOIN nodes n ON n.id = l.node_id
      WHERE n.team_token = $1
        AND l.last_seen_at > $2
      ORDER BY l.last_seen_at DESC
      LIMIT $3`,
    [c.get('team_token'), since.toISOString(), limit],
  );

  const res: WikiRecentResponse = {
    items: rows.map((r): WikiRecentItem => ({
      id: r.id,
      node_path: r.node_path,
      body: r.body,
      status: r.status,
      reinforcement_count: r.reinforcement_count,
      last_seen_at: r.last_seen_at.toISOString(),
      created_at: r.created_at.toISOString(),
    })),
  };
  return c.json(res);
});

// ----- GET /wiki/tree --------------------------------------------------------
// Full node list for the dashboard /wiki page. One row per node with its
// learnings split into durable vs draft. Sort by path (prefix-friendly).

wikiRoutes.get('/wiki/tree', async (c) => {
  const nodes = await loadWikiTree(c.get('team_token'));
  const res: WikiTreeResponse = { nodes };
  return c.json(res);
});

// ----- GET /wiki/export -----------------------------------------------------
// Markdown export of the whole team wiki. Teams will not pour knowledge into
// a store they cannot get it back out of, so this is a trust signal as much
// as a backup story.
//
//   GET /wiki/export                 -> text/markdown, as a download
//   GET /wiki/export?drafts=true     -> include draft learnings too
//   GET /wiki/export?format=json     -> { filename, markdown } for browser clients
wikiRoutes.get('/wiki/export', async (c) => {
  const teamToken = c.get('team_token');
  const [nodes, teamRows] = await Promise.all([
    loadWikiTree(teamToken),
    q<{ name: string }>('SELECT name FROM teams WHERE token = $1', [teamToken]),
  ]);
  const teamName = teamRows[0]?.name;
  const now = new Date();
  const markdown = renderWikiMarkdown(nodes, {
    teamName,
    generatedAt: now,
    includeDrafts: c.req.query('drafts') === 'true',
  });
  const filename = exportFilename(teamName, now);

  if (c.req.query('format') === 'json') {
    return c.json({ filename, markdown });
  }
  return new Response(markdown, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
});
