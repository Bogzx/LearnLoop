// Loads a team's whole wiki tree.
//
// Extracted verbatim from the GET /wiki/tree handler so that the markdown
// export (wiki-export.ts) reads the same rows through the same query rather
// than growing a second, subtly-different copy that drifts.

import type { WikiTreeLearning, WikiTreeNode } from '@trailhead/shared';
import { q } from './db.ts';

export async function loadWikiTree(teamToken: string): Promise<WikiTreeNode[]> {
  // Two queries instead of a three-way LEFT JOIN to avoid the cartesian
  // row explosion (nodes × learnings × prompts). Run in parallel — the
  // round-trip overhead is negligible at hackathon scale.
  const [rows, promptRows] = await Promise.all([
    q<{
      node_id: string;
      path: string;
      body_md: string;
      learning_id: string | null;
      learning_body: string | null;
      learning_status: 'draft' | 'durable' | null;
      reinforcement_count: number | null;
    }>(
      `SELECT n.id AS node_id, n.path, n.body_md,
              l.id AS learning_id, l.body AS learning_body,
              l.status AS learning_status, l.reinforcement_count
         FROM nodes n
         LEFT JOIN learnings l ON l.node_id = n.id
        WHERE n.team_token = $1
        ORDER BY n.path ASC,
                 COALESCE(l.reinforcement_count, 0) DESC`,
      [teamToken],
    ),
    q<{
      path: string;
      prompt_id: string;
      template: string;
      topic: string | null;
      reuse_count: number;
      author_user_id: string | null;
    }>(
      `SELECT n.path,
              p.id AS prompt_id,
              p.template,
              p.topic,
              p.reuse_count,
              p.author_user_id
         FROM prompts p
         JOIN nodes n ON n.id = p.node_id
        WHERE n.team_token = $1
          AND p.status = 'graduated'
        ORDER BY n.path ASC,
                 p.reuse_count DESC,
                 p.created_at DESC`,
      [teamToken],
    ),
  ]);

  const byPath = new Map<string, WikiTreeNode>();
  for (const r of rows) {
    let node = byPath.get(r.path);
    if (!node) {
      node = {
        path: r.path,
        body_md: r.body_md,
        durable_learnings: [],
        draft_learnings: [],
        graduated_prompts: [],
      };
      byPath.set(r.path, node);
    }
    if (r.learning_id && r.learning_body && r.learning_status) {
      const learning: WikiTreeLearning = {
        id: r.learning_id,
        body: r.learning_body,
        status: r.learning_status,
        reinforcement_count: r.reinforcement_count ?? 0,
      };
      if (r.learning_status === 'durable') node.durable_learnings.push(learning);
      else node.draft_learnings.push(learning);
    }
  }
  for (const r of promptRows) {
    // Fallback init covers the rare case where a node carries prompts but
    // never appeared in the learnings query (shouldn't happen since the
    // first query LEFT JOINs every node, but defense-in-depth).
    let node = byPath.get(r.path);
    if (!node) {
      node = {
        path: r.path,
        body_md: '',
        durable_learnings: [],
        draft_learnings: [],
        graduated_prompts: [],
      };
      byPath.set(r.path, node);
    }
    node.graduated_prompts.push({
      id: r.prompt_id,
      template: r.template,
      topic: r.topic,
      reuse_count: r.reuse_count,
      author_user_id: r.author_user_id,
    });
  }

  return Array.from(byPath.values());
}
