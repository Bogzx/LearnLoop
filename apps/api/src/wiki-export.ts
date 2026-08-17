// Wiki → Markdown export.
//
// Why this exists: a team pours accumulated knowledge into this wiki, and
// until now there was no way to get it back out. That makes the store a
// roach motel — knowledge checks in, it doesn't check out — which is a
// reasonable thing for a team to refuse to adopt. Export is both the trust
// signal and the backup story.
//
// Everything here is pure: nodes in, markdown string out. No DB, no network,
// no clock unless one is passed in. That is what makes it testable, and the
// tests are the spec.

import type { WikiTreeNode } from '@trailhead/shared';

export interface WikiExportOptions {
  /** Team display name for the document header. */
  teamName?: string;
  /** Timestamp for the header. Injected so tests are deterministic. */
  generatedAt?: Date;
  /** Include draft (un-reinforced) learnings. Default false — drafts are noise. */
  includeDrafts?: boolean;
}

/**
 * Fence a block of text so that any backticks inside it cannot terminate the
 * fence early. CommonMark: a fenced block is closed only by a run of at least
 * as many backticks as opened it, so we open with (longest inner run + 1),
 * minimum 3.
 *
 * Prompt templates routinely contain ``` blocks, so a naive three-backtick
 * fence would truncate the export mid-prompt and silently corrupt the output.
 */
export function fence(body: string, info = ''): string {
  let longest = 0;
  for (const run of body.match(/`+/g) ?? []) {
    if (run.length > longest) longest = run.length;
  }
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  // A trailing newline keeps the closing fence on its own line even when the
  // body does not end in one.
  const sep = body.endsWith('\n') ? '' : '\n';
  return `${ticks}${info}\n${body}${sep}${ticks}`;
}

/**
 * Turn a wiki path into a GitHub-style anchor slug, for the table of contents.
 * Deliberately simple and deterministic; collisions get a numeric suffix from
 * the caller.
 */
export function slugify(path: string): string {
  return (
    path
      .toLowerCase()
      .replace(/[^a-z0-9/_. -]/g, '')
      .replace(/[/_. ]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'node'
  );
}

/** Sort nodes by path, folders (trailing '/') before files at the same level. */
export function sortNodes(nodes: readonly WikiTreeNode[]): WikiTreeNode[] {
  return [...nodes].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Render the whole team wiki as one self-contained markdown document.
 */
export function renderWikiMarkdown(
  nodes: readonly WikiTreeNode[],
  opts: WikiExportOptions = {},
): string {
  const { teamName, generatedAt, includeDrafts = false } = opts;
  const sorted = sortNodes(nodes);
  const out: string[] = [];

  out.push(`# ${teamName ? `${teamName} — ` : ''}Trailhead wiki export`);
  out.push('');
  const stamp = generatedAt ? generatedAt.toISOString() : null;
  const counts = tally(sorted, includeDrafts);
  out.push(
    `> ${counts.nodes} node${counts.nodes === 1 ? '' : 's'}, ` +
      `${counts.learnings} learning${counts.learnings === 1 ? '' : 's'}, ` +
      `${counts.prompts} graduated prompt${counts.prompts === 1 ? '' : 's'}` +
      (stamp ? `. Exported ${stamp}.` : '.'),
  );
  out.push('');

  if (sorted.length === 0) {
    out.push('_This wiki is empty._');
    out.push('');
    return out.join('\n');
  }

  // Table of contents.
  out.push('## Contents');
  out.push('');
  const seen = new Map<string, number>();
  const anchors: string[] = [];
  for (const n of sorted) {
    const base = slugify(n.path);
    const dup = seen.get(base) ?? 0;
    seen.set(base, dup + 1);
    const anchor = dup === 0 ? base : `${base}-${dup}`;
    anchors.push(anchor);
    out.push(`- [${n.path}](#${anchor})`);
  }
  out.push('');

  sorted.forEach((n, i) => {
    out.push('---');
    out.push('');
    out.push(`## ${n.path}`);
    out.push('');
    // An explicit anchor keeps the TOC links working regardless of how the
    // renderer derives heading ids.
    out.push(`<a id="${anchors[i]}"></a>`);
    out.push('');

    if (n.body_md.trim()) {
      out.push(n.body_md.trim());
      out.push('');
    }

    const durable = n.durable_learnings ?? [];
    if (durable.length) {
      out.push('### Durable learnings');
      out.push('');
      for (const l of durable) {
        const rc = l.reinforcement_count ?? 0;
        out.push(`- ${oneLine(l.body)}${rc > 1 ? ` _(reinforced ${rc}×)_` : ''}`);
      }
      out.push('');
    }

    const drafts = n.draft_learnings ?? [];
    if (includeDrafts && drafts.length) {
      out.push('### Draft learnings');
      out.push('');
      for (const l of drafts) {
        out.push(`- ${oneLine(l.body)}`);
      }
      out.push('');
    }

    const prompts = n.graduated_prompts ?? [];
    if (prompts.length) {
      out.push('### Graduated prompts');
      out.push('');
      for (const p of prompts) {
        const bits: string[] = [];
        if (p.topic) bits.push(`topic: ${p.topic}`);
        if (p.reuse_count) bits.push(`reused ${p.reuse_count}×`);
        if (p.author_user_id) bits.push(`by ${p.author_user_id}`);
        out.push(`**Prompt**${bits.length ? ` — ${bits.join(', ')}` : ''}`);
        out.push('');
        out.push(fence(p.template));
        out.push('');
      }
    }
  });

  return out.join('\n');
}

function tally(nodes: readonly WikiTreeNode[], includeDrafts: boolean) {
  let learnings = 0;
  let prompts = 0;
  for (const n of nodes) {
    learnings += (n.durable_learnings ?? []).length;
    if (includeDrafts) learnings += (n.draft_learnings ?? []).length;
    prompts += (n.graduated_prompts ?? []).length;
  }
  return { nodes: nodes.length, learnings, prompts };
}

/**
 * Collapse a learning body to a single line so it cannot break out of the
 * bullet it is rendered in.
 */
function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ').trim();
}

/** Filename for the downloaded export. */
export function exportFilename(teamName: string | undefined, at: Date): string {
  const slug = slugify(teamName ?? 'trailhead') || 'trailhead';
  const day = at.toISOString().slice(0, 10);
  return `${slug}-wiki-${day}.md`;
}
