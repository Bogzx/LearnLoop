// API integration tests against a real Postgres.
//
// What this pins down, for every route the API advertises in GET /:
//   - tenant isolation: two teams (A, B) with real secrets; whatever A writes,
//     B's reads never see and B's deletes never touch;
//   - auth: secrets, rotation, legacy tokens behind the flag, and that a
//     team's public id is never a credential;
//   - /score persistence rules: 5 rows per scored prompt, deduped for 30 s,
//     and NOTHING written on an upstream failure, an unparseable score, or an
//     over-cap prompt.
// The last test cross-checks the route catalog in GET / against the routes
// these tests exercised, so a new endpoint without isolation coverage fails CI.
//
// Gemini is stubbed at the fetch layer (no key, no network). Postgres is real:
//
//   TRAILHEAD_IT_DATABASE_URL=postgresql://trailhead:trailhead@127.0.0.1:5432/trailhead_it \
//     npm --workspace=apps/api run test:integration
//
// The database is WIPED (DROP SCHEMA public CASCADE) — its name must end in
// `_it` or `_test` or the suite refuses to run. Without the variable every
// test is skipped. See apps/api/README.md for a one-line docker setup.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const IT_URL = process.env.TRAILHEAD_IT_DATABASE_URL;
const skip = IT_URL ? false : 'TRAILHEAD_IT_DATABASE_URL not set';

if (IT_URL) {
  const dbName = new URL(IT_URL).pathname.replace(/^\//, '');
  if (!/(_it|_test)$/.test(dbName)) {
    throw new Error(
      `Refusing to run: integration tests wipe the database, and "${dbName}" does not end in _it or _test.`,
    );
  }
  process.env.DATABASE_URL = IT_URL;
  process.env.GEMINI_API_KEY = 'it-test-key-not-a-credential';
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  delete process.env.TRAILHEAD_ADMIN_TOKEN;
  process.env.TRAILHEAD_ACCEPT_LEGACY_TOKENS = 'true';
  process.env.TRAILHEAD_AUTO_CREATE_TEAMS = 'false';
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(resolve(HERE, '../../../packages/db/schema.sql'), 'utf8');

// ---------------------------------------------------------------------------
// Gemini stub. Recognises the call by its response schema and answers with
// something the parser accepts. Score dimensions are chosen by marker words
// in the prompt, so each test controls its own score.
// ---------------------------------------------------------------------------

type Dims = Record<'goal_clarity' | 'specificity' | 'context_loading' | 'constraint_articulation' | 'output_specification', number>;
const dims = (n: number): Dims => ({
  goal_clarity: n, specificity: n, context_loading: n, constraint_articulation: n, output_specification: n,
});

let geminiMode: 'ok' | 'garbage' | 'error' = 'ok';
let geminiCalls = 0;

function scoreFor(promptText: string): { dimensions: Dims; missing: Record<string, string> } {
  if (promptText.includes('[strong]')) return { dimensions: dims(9), missing: {} };
  if (promptText.includes('[mid]')) return { dimensions: dims(6), missing: { specificity: 'no file named' } };
  return { dimensions: dims(3), missing: { goal_clarity: 'no outcome stated', specificity: 'no file named' } };
}

function geminiAnswer(body: any): string {
  const props = body?.generationConfig?.responseSchema?.properties ?? {};
  const text: string = (body?.contents ?? [])
    .flatMap((c: any) => c.parts ?? [])
    .map((p: any) => p.text ?? '')
    .join('\n');
  if ('dimensions' in props) return JSON.stringify(scoreFor(text));
  if ('rewritten_prompt' in props) return JSON.stringify({ rewritten_prompt: 'In src/x.ts, do Y. Return only the diff.', tip: 'Name the file.' });
  if ('kind' in props) return JSON.stringify({ kind: 'question', text: 'Which file?' });
  if ('path' in props) return JSON.stringify({ path: 'src/api/', topic: props.topic?.enum?.[0] ?? 'other' });
  if ('topic' in props) return JSON.stringify({ topic: props.topic?.enum?.[0] ?? 'other' });
  return 'Stub narrative.';
}

const realFetch = globalThis.fetch;
function installGeminiStub(): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes('generativelanguage.googleapis.com')) return realFetch(input, init);
    geminiCalls++;
    if (geminiMode === 'error') {
      return new Response(JSON.stringify({ error: { code: 400, message: 'stubbed upstream failure', status: 'INVALID_ARGUMENT' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const answer = geminiMode === 'garbage' ? 'not json at all, no dimensions here' : geminiAnswer(body);
    return new Response(
      JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: answer }] }, finishReason: 'STOP' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let db: pg.Client;
let closePool: () => Promise<void>;
const covered = new Set<string>();

function cover(route: string): void {
  covered.add(route.replace(/\s+/g, ' ').trim());
}

async function call(
  method: string,
  path: string,
  { token, body, admin }: { token?: string; body?: unknown; admin?: string } = {},
): Promise<{ status: number; json: any; headers: Headers; text: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Team-Token'] = token;
  if (admin) headers['X-Admin-Token'] = admin;
  const res = await app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, headers: res.headers, text };
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query(sql, params);
  return Number(r.rows[0].n);
}

async function eventually(check: () => Promise<boolean>, what: string, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`timed out waiting for: ${what}`);
}

// Registered in `before`.
const A = { id: 'team_it_alpha', secret: '' };
const B = { id: 'team_it_bravo', secret: '' };

before(async () => {
  if (skip) return;
  db = new pg.Client({ connectionString: IT_URL });
  await db.connect();
  await db.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await db.query(SCHEMA);
  installGeminiStub();
  const mod = await import('../src/app.ts');
  app = mod.app;
  await mod.ensureRecentMigrations();
  const { pool } = await import('../src/db.ts');
  closePool = () => pool.end();

  for (const t of [A, B]) {
    const r = await call('POST', '/teams', { body: { team_id: t.id, name: t.id } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    t.secret = r.json.secret;
  }
  cover('POST /teams');
});

after(async () => {
  if (skip) return;
  globalThis.fetch = realFetch;
  // Let fire-and-forget work (prompt promotion, bootstrap jobs) settle before
  // the pool closes under it.
  await new Promise((r) => setTimeout(r, 300));
  await closePool?.();
  await db?.end();
});

// ---------------------------------------------------------------------------
// Auth and team lifecycle
// ---------------------------------------------------------------------------

test('GET / is public and lists the endpoints', { skip }, async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.endpoints));
  cover('GET /');
});

test('secrets are stored hashed, never in plain text', { skip }, async () => {
  const rows = await db.query('SELECT token, secret_hash FROM teams WHERE token = ANY($1)', [[A.id, B.id]]);
  assert.equal(rows.rows.length, 2);
  for (const row of rows.rows) {
    assert.match(row.secret_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(row.secret_hash, A.secret);
    assert.notEqual(row.secret_hash, B.secret);
  }
  assert.match(A.secret, /^trailhead_sk_/);
});

test('GET /teams resolves only the caller, with its public id and never a secret', { skip }, async () => {
  const r = await call('GET', '/teams', { token: A.secret });
  assert.equal(r.status, 200);
  assert.equal(r.json.teams.length, 1);
  assert.equal(r.json.teams[0].team_id, A.id);
  assert.equal(r.json.teams[0].legacy, false);
  assert.ok(!r.text.includes(A.secret) && !r.text.includes(B.id));
  assert.equal((await call('GET', '/teams')).status, 401);
  assert.equal((await call('GET', '/teams', { token: 'nope' })).status, 401);
  cover('GET /teams');
});

test('a public team id is not a credential (with legacy tokens on)', { skip }, async () => {
  assert.equal((await call('GET', '/wiki/tree', { token: A.id })).status, 401);
});

test('registration: 409 for a taken id (join flow), 400 for a bad id, random id when omitted', { skip }, async () => {
  const taken = await call('POST', '/teams', { body: { team_id: A.id } });
  assert.equal(taken.status, 409);
  assert.equal(taken.json.error, 'team_exists');
  assert.ok(!taken.text.includes(A.secret));
  assert.equal((await call('POST', '/teams', { body: { team_id: 'a b' } })).status, 400);
  const anon = await call('POST', '/teams', { body: {} });
  assert.equal(anon.status, 201);
  assert.match(anon.json.team_id, /^team_local_[0-9a-f]{16}$/);
});

test('TRAILHEAD_ADMIN_TOKEN gates registration', { skip }, async () => {
  process.env.TRAILHEAD_ADMIN_TOKEN = 'op-secret';
  try {
    assert.equal((await call('POST', '/teams', { body: { team_id: 'team_it_gated' } })).status, 403);
    assert.equal((await call('POST', '/teams', { body: { team_id: 'team_it_gated' }, admin: 'wrong' })).status, 403);
    assert.equal((await call('POST', '/teams', { body: { team_id: 'team_it_gated' }, admin: 'op-secret' })).status, 201);
  } finally {
    delete process.env.TRAILHEAD_ADMIN_TOKEN;
  }
});

test('legacy tokens: accepted with Deprecation while the flag is on, rejected when off', { skip }, async () => {
  await db.query(`INSERT INTO teams (token, name) VALUES ('repo_legacy_it_0001', 'legacy')`);
  const on = await call('GET', '/teams', { token: 'repo_legacy_it_0001' });
  assert.equal(on.status, 200);
  assert.equal(on.json.teams[0].legacy, true);
  assert.equal(on.json.teams[0].team_id, undefined, 'a legacy id is its credential and must not be echoed');
  assert.equal(on.headers.get('deprecation'), 'true');
  process.env.TRAILHEAD_ACCEPT_LEGACY_TOKENS = 'false';
  try {
    assert.equal((await call('GET', '/teams', { token: 'repo_legacy_it_0001' })).status, 401);
    // Secret teams are unaffected.
    assert.equal((await call('GET', '/teams', { token: A.secret })).status, 200);
  } finally {
    process.env.TRAILHEAD_ACCEPT_LEGACY_TOKENS = 'true';
  }
});

test('legacy auto-create never adopts an existing team, and GET /teams never creates', { skip }, async () => {
  process.env.TRAILHEAD_AUTO_CREATE_TEAMS = 'true';
  try {
    // A's public id collides with an existing (secret) team: must not authenticate as A.
    assert.equal((await call('GET', '/wiki/tree', { token: A.id })).status, 401);
    // Probing does not create.
    assert.equal((await call('GET', '/teams', { token: 'repo_probe_it_0001' })).status, 401);
    assert.equal(await count(`SELECT count(*) n FROM teams WHERE token = 'repo_probe_it_0001'`), 0);
    // Any other route does (legacy demo behaviour), as a legacy team.
    const r = await call('GET', '/wiki/tree', { token: 'repo_auto_it_0001' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('deprecation'), 'true');
  } finally {
    process.env.TRAILHEAD_AUTO_CREATE_TEAMS = 'false';
  }
});

test('rotate-secret: new secret works, old one is dead; upgrades a legacy team', { skip }, async () => {
  const reg = await call('POST', '/teams', { body: { team_id: 'team_it_rotate' } });
  const old = reg.json.secret;
  const rot = await call('POST', '/teams/rotate-secret', { token: old });
  assert.equal(rot.status, 200);
  assert.equal(rot.json.team_id, 'team_it_rotate');
  assert.equal((await call('GET', '/teams', { token: old })).status, 401);
  assert.equal((await call('GET', '/teams', { token: rot.json.secret })).status, 200);

  await db.query(`INSERT INTO teams (token, name) VALUES ('repo_upgrade_it_01', 'up')`);
  await call('POST', '/wiki/propose', { token: 'repo_upgrade_it_01', body: { node_path: 'src/', insight: 'kept across upgrade' } });
  const up = await call('POST', '/teams/rotate-secret', { token: 'repo_upgrade_it_01' });
  assert.equal(up.status, 200);
  assert.equal((await call('GET', '/teams', { token: 'repo_upgrade_it_01' })).status, 401);
  const tree = await call('GET', '/wiki/tree', { token: up.json.secret });
  assert.ok(tree.text.includes('kept across upgrade'), 'data survives the upgrade');
  const teams = await call('GET', '/teams', { token: up.json.secret });
  assert.equal(teams.json.teams[0].legacy, false);
  assert.equal(teams.json.teams[0].team_id, 'repo_upgrade_it_01');

  assert.equal((await call('POST', '/teams/rotate-secret', { token: 'trailhead_demo_acme_2026' })).status, 403);
  cover('POST /teams/rotate-secret');
});

test('the demo team works through its public secret', { skip }, async () => {
  const r = await call('GET', '/teams', { token: 'trailhead_demo_acme_2026' });
  assert.equal(r.status, 200);
  assert.equal(r.json.teams[0].legacy, false);
  assert.equal(r.json.teams[0].name, 'Acme Fintech');
});

// ---------------------------------------------------------------------------
// /score persistence rules
// ---------------------------------------------------------------------------

const obsFor = (teamId: string) =>
  count('SELECT count(*) n FROM skill_observations WHERE team_token = $1', [teamId]);

test('/score writes 5 observations under the caller only, deduped within 30 s', { skip }, async () => {
  const before = await obsFor(A.id);
  const r = await call('POST', '/score', { token: A.secret, body: { prompt: '[mid] tidy the handler', user_id: 'alice' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.overall, 6);
  assert.equal(await obsFor(A.id), before + 5);
  const again = await call('POST', '/score', { token: A.secret, body: { prompt: '[mid] tidy the handler', user_id: 'alice' } });
  assert.equal(again.status, 200);
  assert.equal(await obsFor(A.id), before + 5, 'same user + prompt within 30 s is deduped');
  await call('POST', '/score', { token: A.secret, body: { prompt: '[mid] tidy the handler', user_id: 'bob' } });
  assert.equal(await obsFor(A.id), before + 10, 'a different user is a different observation');
  assert.equal(await obsFor(B.id), 0, 'nothing lands on team B');
  cover('POST /score');
});

test('/score writes nothing when Gemini output is unparseable (502)', { skip }, async () => {
  const before = await obsFor(A.id);
  geminiMode = 'garbage';
  try {
    const r = await call('POST', '/score', { token: A.secret, body: { prompt: 'unparseable case', user_id: 'alice' } });
    assert.equal(r.status, 502);
    assert.equal(r.json.error, 'score_unparseable');
  } finally {
    geminiMode = 'ok';
  }
  assert.equal(await obsFor(A.id), before);
});

test('/score writes nothing when Gemini fails (500)', { skip }, async () => {
  const before = await obsFor(A.id);
  geminiMode = 'error';
  try {
    const r = await call('POST', '/score', { token: A.secret, body: { prompt: 'upstream failure case', user_id: 'alice' } });
    assert.equal(r.status, 500);
  } finally {
    geminiMode = 'ok';
  }
  assert.equal(await obsFor(A.id), before);
});

test('/score rejects over-cap and malformed bodies without calling Gemini or writing', { skip }, async () => {
  const before = await obsFor(A.id);
  const calls = geminiCalls;
  assert.equal((await call('POST', '/score', { token: A.secret, body: { prompt: 'a'.repeat(64_001), user_id: 'u' } })).status, 413);
  assert.equal((await call('POST', '/score', { token: A.secret, body: { prompt: 42 } })).status, 400);
  assert.equal(geminiCalls, calls);
  assert.equal(await obsFor(A.id), before);
});

// ---------------------------------------------------------------------------
// Tenant isolation, route by route. A writes; B must see none of it.
// ---------------------------------------------------------------------------

const SECRET_RULE = 'alpha-only convention: payments go through ledger.ts';

test('/wiki/propose + /wiki/tree + /wiki/recent + /context + /search + /wiki/export are team-scoped', { skip }, async () => {
  for (let i = 0; i < 3; i++) {
    const r = await call('POST', '/wiki/propose', { token: A.secret, body: { node_path: 'src/pay/', insight: SECRET_RULE } });
    assert.equal(r.status, 200);
  }
  cover('POST /wiki/propose');

  const aTree = await call('GET', '/wiki/tree', { token: A.secret });
  assert.ok(aTree.text.includes(SECRET_RULE));
  const bTree = await call('GET', '/wiki/tree', { token: B.secret });
  assert.equal(bTree.status, 200);
  assert.ok(!bTree.text.includes(SECRET_RULE));
  cover('GET /wiki/tree');

  assert.ok((await call('GET', '/wiki/recent', { token: A.secret })).text.includes(SECRET_RULE));
  assert.deepEqual((await call('GET', '/wiki/recent', { token: B.secret })).json.items, []);
  cover('GET /wiki/recent');

  assert.ok((await call('GET', '/context?path=src/pay/x.ts', { token: A.secret })).text.includes(SECRET_RULE));
  assert.deepEqual((await call('GET', '/context?path=src/pay/x.ts', { token: B.secret })).json.nodes, []);
  cover('GET /context');

  assert.ok((await call('GET', '/search?q=ledger', { token: A.secret })).json.items.length > 0);
  assert.deepEqual((await call('GET', '/search?q=ledger', { token: B.secret })).json.items, []);
  cover('GET /search');

  assert.ok((await call('GET', '/wiki/export', { token: A.secret })).text.includes(SECRET_RULE));
  const bExport = await call('GET', '/wiki/export?format=json&drafts=true', { token: B.secret });
  assert.equal(bExport.status, 200);
  assert.ok(!bExport.text.includes(SECRET_RULE));
  cover('GET /wiki/export');
});

test('/onboard/repo nodes are team-scoped', { skip }, async () => {
  const r = await call('POST', '/onboard/repo', {
    token: A.secret,
    body: { paths: ['svc/alpha-private/'], initial_rules: { 'svc/alpha-private/': 'alpha rules body' } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.nodes_created, 1);
  assert.ok(!(await call('GET', '/wiki/tree', { token: B.secret })).text.includes('alpha-private'));
  // Same path for B is B's own node, not A's.
  const b = await call('POST', '/onboard/repo', { token: B.secret, body: { paths: ['svc/alpha-private/'] } });
  assert.equal(b.json.nodes_created, 1);
  assert.ok(!(await call('GET', '/wiki/tree', { token: B.secret })).text.includes('alpha rules body'));
  cover('POST /onboard/repo');
});

test('/onboard/repo/full jobs are visible only to their team', { skip }, async () => {
  const r = await call('POST', '/onboard/repo/full', {
    token: A.secret,
    body: { folders: ['src/'], files: [{ path: 'src/a.ts', content: 'export const a = 1;' }] },
  });
  assert.equal(r.status, 200);
  const jobId = r.json.job_id;
  assert.equal((await call('GET', `/onboard/jobs/${jobId}`, { token: A.secret })).status, 200);
  assert.equal((await call('GET', `/onboard/jobs/${jobId}`, { token: B.secret })).status, 404);
  assert.equal((await call('GET', '/onboard/jobs/not-a-uuid', { token: A.secret })).status, 400);
  cover('POST /onboard/repo/full');
  cover('GET /onboard/jobs/:id');
});

test('/capture + /skill-arc + /team/metrics are team-scoped', { skip }, async () => {
  const cap = await call('POST', '/capture', {
    token: A.secret,
    body: { surface: 'browser', user_prompt: 'alpha prompt', ai_response: 'alpha reply', outcome: 'helpful', user_id: 'alice' },
  });
  assert.equal(cap.status, 200);
  assert.equal(await count('SELECT count(*) n FROM captures WHERE team_token = $1', [A.id]), 1);
  assert.equal(await count('SELECT count(*) n FROM captures WHERE team_token = $1', [B.id]), 0);
  cover('POST /capture');

  const aArc = await call('GET', '/skill-arc', { token: A.secret });
  assert.ok(aArc.json.observations.length > 0);
  assert.deepEqual((await call('GET', '/skill-arc', { token: B.secret })).json.observations, []);
  assert.ok((await call('GET', '/skill-arc?user_id=alice', { token: A.secret })).json.observations.length > 0);
  cover('GET /skill-arc');

  const aM = await call('GET', '/team/metrics', { token: A.secret });
  const bM = await call('GET', '/team/metrics', { token: B.secret });
  assert.ok(aM.json.total_obs > 0);
  assert.equal(aM.json.reuse_rate, 1);
  assert.equal(bM.json.total_obs, 0);
  assert.equal(bM.json.reuse_rate, 0);
  assert.equal(bM.json.durable_count, 0);
  cover('GET /team/metrics');
});

test('/coach: promotion lands in the caller\'s library only; /prompts/proven, /examples, /diff are scoped', { skip }, async () => {
  const strong = '[strong] In src/pay/ledger.ts add idempotency keys; keep the public API; return only the diff.';
  const r = await call('POST', '/coach', { token: A.secret, body: { prompt: strong, user_id: 'alice', file_path: 'src/pay/ledger.ts' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.proceed, true);
  await eventually(
    async () => (await call('GET', '/prompts/proven', { token: A.secret })).json.items.length > 0,
    'promotion into team A library',
  );
  cover('POST /coach');

  assert.deepEqual((await call('GET', '/prompts/proven', { token: B.secret })).json.items, []);
  cover('GET /prompts/proven');

  assert.ok((await call('GET', '/examples?path=src/pay/ledger.ts', { token: A.secret })).json.items.length > 0);
  assert.deepEqual((await call('GET', '/examples?path=src/pay/ledger.ts', { token: B.secret })).json.items, []);
  cover('GET /examples');

  // B has no graduated prompts, so /diff must not fall back to A's.
  const bDiff = await call('POST', '/diff', { token: B.secret, body: { user_prompt: 'fix it', user_id: 'bob' } });
  assert.equal(bDiff.status, 404);
  const aDiff = await call('POST', '/diff', { token: A.secret, body: { user_prompt: 'fix it', user_id: 'alice', file_path: 'src/pay/x.ts' } });
  assert.equal(aDiff.status, 200);
  assert.equal(aDiff.json.team.prompt, strong);
  cover('POST /diff');

  // A weak prompt from B is coached with a Gemini rewrite, never A's prompt.
  const bCoach = await call('POST', '/coach', { token: B.secret, body: { prompt: 'fix it', user_id: 'bob', file_path: 'src/pay/ledger.ts' } });
  assert.equal(bCoach.json.proceed, false);
  assert.ok(!bCoach.text.includes('idempotency keys'));
});

test('/improve works per team', { skip }, async () => {
  const r = await call('POST', '/improve', {
    token: B.secret,
    body: { original_prompt: 'fix it', user_id: 'bob', history: [], command: 'next' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.kind, 'question');
  cover('POST /improve');
});

test('DELETE /team/data wipes only the caller', { skip }, async () => {
  const aNodes = await count('SELECT count(*) n FROM nodes WHERE team_token = $1', [A.id]);
  assert.ok(aNodes > 0);
  assert.equal((await call('DELETE', '/team/data', { token: B.secret, body: {} })).status, 400, 'confirm required');
  const r = await call('DELETE', '/team/data', { token: B.secret, body: { confirm: true } });
  assert.equal(r.status, 200);
  assert.equal(await count('SELECT count(*) n FROM nodes WHERE team_token = $1', [B.id]), 0);
  assert.equal(await count('SELECT count(*) n FROM nodes WHERE team_token = $1', [A.id]), aNodes);
  assert.ok(await obsFor(A.id) > 0);
  assert.equal(
    (await call('DELETE', '/team/data', { token: 'trailhead_demo_acme_2026', body: { confirm: true } })).status,
    403,
    'demo team protected',
  );
  cover('DELETE /team/data');
});

// Must stay last: every route in GET /'s catalog needs a test above.
test('every advertised route is covered by these tests', { skip }, async () => {
  const r = await call('GET', '/');
  const advertised: string[] = r.json.endpoints.map((e: string) => {
    const [method, path] = e.trim().split(/\s+/);
    return `${method} ${path!.split('?')[0]}`;
  });
  advertised.push('GET /');
  const missing = advertised.filter((route) => !covered.has(route));
  assert.deepEqual(missing, [], `routes without integration coverage: ${missing.join(', ')}`);
});
