// Tests for the wiki → markdown export.
//
// The renderer is pure, so these are real tests of the output contract rather
// than smoke tests around a DB. The interesting cases are the ones where a
// naive implementation silently corrupts the export: prompt templates that
// contain their own fences, learnings with embedded newlines, and duplicate
// anchor slugs.
//
// Run: npm --workspace=apps/api test

import test from 'node:test';
import assert from 'node:assert/strict';
import type { WikiTreeNode } from '@trailhead/shared';
import {
  exportFilename,
  fence,
  renderWikiMarkdown,
  slugify,
  sortNodes,
} from './wiki-export.ts';

const AT = new Date('2026-08-17T12:00:00.000Z');

function node(partial: Partial<WikiTreeNode> & { path: string }): WikiTreeNode {
  return {
    body_md: '',
    durable_learnings: [],
    draft_learnings: [],
    graduated_prompts: [],
    ...partial,
  };
}

test('empty wiki renders a valid document, not a crash or a blank string', () => {
  const md = renderWikiMarkdown([], { teamName: 'Acme', generatedAt: AT });
  assert.match(md, /^# Acme — Trailhead wiki export/);
  assert.match(md, /_This wiki is empty\._/);
});

test('header tallies nodes, learnings and prompts', () => {
  const md = renderWikiMarkdown(
    [
      node({
        path: 'src/api/',
        durable_learnings: [
          { id: '1', body: 'Always use the pg pool', status: 'durable', reinforcement_count: 3 },
        ],
        graduated_prompts: [
          { id: 'p1', template: 'do a thing', topic: 'retry', reuse_count: 2, author_user_id: 'bo' },
        ],
      }),
      node({ path: 'src/web/' }),
    ],
    { generatedAt: AT },
  );
  assert.match(md, /2 nodes, 1 learning, 1 graduated prompt/);
  assert.match(md, /Exported 2026-08-17T12:00:00\.000Z/);
});

test('drafts are excluded by default and included on request', () => {
  const nodes = [
    node({
      path: 'a/',
      draft_learnings: [{ id: 'd1', body: 'unconfirmed hunch', status: 'draft', reinforcement_count: 1 }],
    }),
  ];
  const without = renderWikiMarkdown(nodes, { generatedAt: AT });
  assert.ok(!without.includes('unconfirmed hunch'));
  assert.ok(!without.includes('Draft learnings'));

  const with_ = renderWikiMarkdown(nodes, { generatedAt: AT, includeDrafts: true });
  assert.ok(with_.includes('unconfirmed hunch'));
  assert.match(with_, /### Draft learnings/);
});

// ---------------------------------------------------------------------------
// The case a naive implementation gets wrong. Prompt templates routinely
// contain ``` blocks; a hardcoded three-backtick fence closes early and
// truncates the export mid-document.
// ---------------------------------------------------------------------------
test('a prompt containing a fenced code block does not terminate its own fence', () => {
  const template = 'Rewrite this:\n```ts\nconst x = 1;\n```\nMake it faster.';
  const md = renderWikiMarkdown(
    [node({ path: 'src/', graduated_prompts: [{ id: 'p', template, topic: null, reuse_count: 0, author_user_id: null }] })],
    { generatedAt: AT },
  );
  assert.ok(md.includes(template), 'the template must survive verbatim');
  // The opening fence must be longer than the longest run inside the body.
  assert.ok(md.includes('````\nRewrite this:'), 'expected a four-backtick fence');
});

test('fence widens past the longest backtick run', () => {
  assert.equal(fence('plain'), '```\nplain\n```');
  assert.equal(fence('a ``` b'), '````\na ``` b\n````');
  assert.equal(fence('a ````` b').split('\n')[0], '``````');
});

test('fence does not double a trailing newline', () => {
  assert.equal(fence('x\n'), '```\nx\n```');
});

test('multi-line learnings are collapsed so they cannot break the bullet list', () => {
  const md = renderWikiMarkdown(
    [
      node({
        path: 'a/',
        durable_learnings: [
          { id: '1', body: 'line one\n\nline two', status: 'durable', reinforcement_count: 1 },
        ],
      }),
    ],
    { generatedAt: AT },
  );
  assert.ok(md.includes('- line one line two'));
  assert.ok(!md.includes('- line one\n\nline two'));
});

test('reinforcement count is shown only when it is above one', () => {
  const mk = (n: number) =>
    renderWikiMarkdown(
      [node({ path: 'a/', durable_learnings: [{ id: '1', body: 'x', status: 'durable', reinforcement_count: n }] })],
      { generatedAt: AT },
    );
  assert.ok(!mk(1).includes('reinforced'));
  assert.ok(mk(4).includes('reinforced 4×'));
});

test('duplicate slugs get distinct anchors so the table of contents works', () => {
  // 'src/api/' and 'src.api.' both slugify to 'src-api'.
  const md = renderWikiMarkdown([node({ path: 'src/api/' }), node({ path: 'src.api.' })], {
    generatedAt: AT,
  });
  assert.ok(md.includes('<a id="src-api"></a>'));
  assert.ok(md.includes('<a id="src-api-1"></a>'));
  assert.ok(md.includes('(#src-api)'));
  assert.ok(md.includes('(#src-api-1)'));
});

test('slugify never returns an empty anchor', () => {
  assert.equal(slugify('///'), 'node');
  assert.equal(slugify('!!!'), 'node');
  assert.equal(slugify('src/api/auth.ts'), 'src-api-auth-ts');
});

test('nodes are emitted in stable path order regardless of input order', () => {
  const sorted = sortNodes([node({ path: 'b/' }), node({ path: 'a/' }), node({ path: 'a/c.ts' })]);
  assert.deepEqual(sorted.map((n) => n.path), ['a/', 'a/c.ts', 'b/']);
});

test('node body_md is included verbatim', () => {
  const md = renderWikiMarkdown([node({ path: 'a/', body_md: '## Handwritten\n\nSome prose.' })], {
    generatedAt: AT,
  });
  assert.ok(md.includes('## Handwritten'));
  assert.ok(md.includes('Some prose.'));
});

test('prompt metadata is rendered when present and omitted when not', () => {
  const withMeta = renderWikiMarkdown(
    [node({ path: 'a/', graduated_prompts: [{ id: 'p', template: 't', topic: 'retry', reuse_count: 3, author_user_id: 'bo' }] })],
    { generatedAt: AT },
  );
  assert.match(withMeta, /\*\*Prompt\*\* — topic: retry, reused 3×, by bo/);

  const bare = renderWikiMarkdown(
    [node({ path: 'a/', graduated_prompts: [{ id: 'p', template: 't', topic: null, reuse_count: 0, author_user_id: null }] })],
    { generatedAt: AT },
  );
  assert.ok(bare.includes('**Prompt**\n'));
  assert.ok(!bare.includes('**Prompt** —'));
});

test('exportFilename is filesystem-safe and date-stamped', () => {
  assert.equal(exportFilename('Acme Fintech', AT), 'acme-fintech-wiki-2026-08-17.md');
  assert.equal(exportFilename(undefined, AT), 'trailhead-wiki-2026-08-17.md');
  assert.ok(!exportFilename('a/b:c*d', AT).match(/[/:*]/));
});
