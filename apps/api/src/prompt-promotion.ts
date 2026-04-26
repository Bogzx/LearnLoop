// Auto-promotion of /coach-submitted prompts that score >=7 into the
// per-folder prompt library (the `prompts` table that /examples, /search,
// and /coach's strong-example lookup all read from).
//
// Fired async via setImmediate from /coach so the caller's response time
// is unaffected. Best-effort: any failure is logged and swallowed; we
// never block the coaching path.
//
// MCP-only by design — only /coach calls this. Browser ext / VS Code ext
// are deliberately out of scope: the team's library reflects what users
// pair-prompted with Claude Code well enough to bypass coaching, not
// every prompt typed anywhere.

import { ancestorPaths, normalizePath } from '@trailhead/scoring';
import type { DimensionScores } from '@trailhead/shared';

import { q, upsertNode } from './db.ts';
import { extractPathAndTopic } from './gemini.ts';

interface PromoteArgs {
  teamId: string;
  prompt: string;
  filePath: string | null | undefined;
  // Reserved so the call site can pass scoring context without a re-shape
  // later (e.g. min-dim threshold gating). Today the gate lives at the
  // call site (overall >= 7).
  dimensions: DimensionScores;
}

// Drop the file segment off a possibly-file-shaped path. Returns the
// trailing-slash folder form expected by `nodes.path` upsert convention.
//
//   'src/api/webhooks/handler.ts' -> 'src/api/webhooks/'
//   'src/api/webhooks/'           -> 'src/api/webhooks/'
//   'src'                         -> ''
//   ''                            -> ''
function deepestFolderOf(p: string): string {
  if (p === '') return '';
  if (p.endsWith('/')) return normalizePath(p);
  const parts = p.split('/');
  parts.pop();
  return normalizePath(parts.join('/'));
}

// Resolve the target node id for a graduated prompt.
//
//   1. If a path hint is available (explicit file_path, then Gemini
//      extraction as fallback), look up the deepest existing ancestor
//      node. Found → use it.
//   2. If no ancestor exists yet, upsert a node at the path's deepest
//      folder ancestor — this lets the wiki grow into uncovered subtrees
//      organically as users prompt about them.
//   3. If no path hint at all (Gemini returned empty), file under the
//      team's synthetic root node ('').
//
// Returns the node id and any topic Gemini extracted along the way.
async function resolveTargetNode(
  teamId: string,
  prompt: string,
  filePath: string | null | undefined,
): Promise<{ nodeId: string; topic: string | null }> {
  let pathHint: string | null = filePath?.trim() ? filePath.trim() : null;
  let topic: string | null = null;

  if (!pathHint) {
    const extracted = await extractPathAndTopic(prompt);
    pathHint = extracted.path;
    topic = extracted.topic;
  }

  if (pathHint) {
    const ancestors = ancestorPaths(pathHint);
    const rows = await q<{ id: string }>(
      `SELECT id FROM nodes
        WHERE team_id = $1 AND path = ANY($2::text[])
        ORDER BY length(path) DESC
        LIMIT 1`,
      [teamId, ancestors],
    );
    if (rows.length) return { nodeId: rows[0]!.id, topic };
    // No ancestor exists → upsert at the path's deepest folder so the
    // library entry sits as close to the work as possible.
    const nodeId = await upsertNode(teamId, deepestFolderOf(pathHint));
    return { nodeId, topic };
  }

  const nodeId = await upsertNode(teamId, '');
  return { nodeId, topic };
}

// Public entry point. Caller must already have validated overall >= 7.
// Wraps every error and never throws — promotion is fire-and-forget.
export async function tryPromotePrompt(args: PromoteArgs): Promise<void> {
  try {
    const trimmed = args.prompt.trim();
    if (!trimmed) return;

    const { nodeId, topic } = await resolveTargetNode(
      args.teamId,
      trimmed,
      args.filePath,
    );

    // Dedup on (node_id, template). Hit → bump reuse_count so /examples'
    // popularity ranking reflects real reuse. Miss → insert as graduated.
    // Mirrors the seed-script idempotency pattern (packages/db/seed.mjs).
    const existing = await q<{ id: string }>(
      `SELECT id FROM prompts WHERE node_id = $1 AND template = $2 LIMIT 1`,
      [nodeId, trimmed],
    );
    if (existing.length) {
      await q(
        `UPDATE prompts SET reuse_count = reuse_count + 1 WHERE id = $1`,
        [existing[0]!.id],
      );
      console.log(`[promote] reinforced prompt ${existing[0]!.id} (reuse++)`);
      return;
    }

    const inserted = await q<{ id: string }>(
      `INSERT INTO prompts (node_id, template, topic, status, reuse_count)
       VALUES ($1, $2, $3, 'graduated', 0)
       RETURNING id`,
      [nodeId, trimmed, topic],
    );
    console.log(
      `[promote] graduated prompt ${inserted[0]!.id} ` +
      `(node=${nodeId}, topic=${topic ?? 'null'})`,
    );
  } catch (err) {
    console.warn('[promote] tryPromotePrompt failed', err);
  }
}
