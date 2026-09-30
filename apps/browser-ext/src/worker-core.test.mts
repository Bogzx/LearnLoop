// Service-worker side of the API bridge (worker-core.ts): config resolution,
// the route allowlist, host-permission gating, headers, timeouts, aborts and
// failure classification. Pure — fetch, storage and permissions are injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_MESSAGE,
  configFromStorage,
  handleApiRequest,
  isAllowedRoute,
  isApiAbort,
  isApiRequest,
  originPattern,
  TEAM_TOKEN_STORAGE_KEY,
  type ApiRequestMessage,
  type WorkerDeps,
} from './worker-core.ts';
import { API_URL_KEY, DEFAULT_API_URL, TEAM_TOKEN } from './config.ts';

const msg = (over: Partial<ApiRequestMessage> = {}): ApiRequestMessage => ({
  type: API_MESSAGE,
  id: 'r1',
  path: '/score',
  method: 'POST',
  body: { prompt: 'p' },
  timeoutMs: 5_000,
  ...over,
});

function deps(over: Partial<WorkerDeps> & { respond?: (url: string, init: RequestInit) => Promise<Response> | Response } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const d: WorkerDeps = {
    fetch: (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return (over.respond ?? (() => new Response('{"ok":1}', { status: 200 })))(String(url), init);
    }) as typeof fetch,
    readConfig: async () => ({ apiUrl: 'https://trailhead.example.com', teamToken: 'trailhead_sk_x' }),
    hasHostPermission: async () => true,
    ...over,
  };
  return { d, calls };
}

test('configFromStorage: stored URL (normalised) and secret, else the localhost default and demo team', () => {
  assert.deepEqual(configFromStorage({ [API_URL_KEY]: ' https://t.example.com/// ', [TEAM_TOKEN_STORAGE_KEY]: 'sk' }), {
    apiUrl: 'https://t.example.com',
    teamToken: 'sk',
  });
  assert.deepEqual(configFromStorage({}), { apiUrl: DEFAULT_API_URL, teamToken: TEAM_TOKEN });
  assert.deepEqual(configFromStorage({ [API_URL_KEY]: 'javascript:alert(1)', [TEAM_TOKEN_STORAGE_KEY]: '' }), {
    apiUrl: DEFAULT_API_URL,
    teamToken: TEAM_TOKEN,
  });
  assert.equal(originPattern('http://localhost:3000'), 'http://localhost:3000/*');
});

test('message guards', () => {
  assert.equal(isApiRequest(msg()), true);
  assert.equal(isApiRequest({ ...msg(), method: 'DELETE' }), false);
  assert.equal(isApiRequest({ ...msg(), type: 'other' }), false);
  assert.equal(isApiRequest(null), false);
  assert.equal(isApiAbort({ type: 'trailhead.api.abort', id: 'r1' }), true);
  assert.equal(isApiAbort({ type: 'trailhead.api.abort' }), false);
});

test('route allowlist: only what the content script uses; no admin or destructive routes, no other hosts', () => {
  assert.equal(isAllowedRoute('/score', 'POST'), true);
  assert.equal(isAllowedRoute('/wiki/recent?since=x', 'GET'), true);
  assert.equal(isAllowedRoute('/wiki/tree', 'GET'), true);
  assert.equal(isAllowedRoute('/score', 'GET'), false);
  assert.equal(isAllowedRoute('/team/data', 'POST'), false);
  assert.equal(isAllowedRoute('/teams/rotate-secret', 'POST'), false);
  assert.equal(isAllowedRoute('/teams', 'GET'), false);
  assert.equal(isAllowedRoute('//evil.example/score', 'POST'), false);
  assert.equal(isAllowedRoute('https://evil.example/score', 'POST'), false);
});

test('disallowed route → bad_request, and nothing is fetched', async () => {
  const { d, calls } = deps();
  const r = await handleApiRequest(msg({ path: '/teams/rotate-secret' }), d);
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'bad_request');
  assert.equal(calls.length, 0);
});

test('origin without a granted host permission → no_host_permission naming the popup, nothing fetched', async () => {
  const asked: string[] = [];
  const { d, calls } = deps({ hasHostPermission: async (p) => { asked.push(p); return false; } });
  const r = await handleApiRequest(msg(), d);
  assert.equal(r.failure, 'no_host_permission');
  assert.match(r.message ?? '', /popup/);
  assert.deepEqual(asked, ['https://trailhead.example.com/*']);
  assert.equal(calls.length, 0);
});

test('fetches <apiUrl><path> with the stored secret and JSON body; relays status, data and headers', async () => {
  const { d, calls } = deps({
    respond: () => new Response('{"overall":7}', { status: 200, headers: { Deprecation: 'true' } }),
  });
  const r = await handleApiRequest(msg(), d);
  assert.deepEqual(
    { ok: r.ok, status: r.status, data: r.data, deprecation: r.deprecation, apiUrl: r.apiUrl },
    { ok: true, status: 200, data: { overall: 7 }, deprecation: true, apiUrl: 'https://trailhead.example.com' },
  );
  assert.equal(calls[0]!.url, 'https://trailhead.example.com/score');
  assert.equal(calls[0]!.init.method, 'POST');
  assert.equal(calls[0]!.init.body, '{"prompt":"p"}');
  assert.equal((calls[0]!.init.headers as Record<string, string>)['X-Team-Token'], 'trailhead_sk_x');
});

test('GET sends no body; 429 relays Retry-After; error bodies are passed through', async () => {
  const { d, calls } = deps({
    respond: () => new Response('{"error":"rate_limited"}', { status: 429, headers: { 'Retry-After': '42' } }),
  });
  const r = await handleApiRequest(msg({ path: '/wiki/recent?since=x', method: 'GET', body: undefined }), d);
  assert.equal(calls[0]!.init.body, undefined);
  assert.deepEqual({ ok: r.ok, status: r.status, retryAfter: r.retryAfter, failure: r.failure }, {
    ok: false, status: 429, retryAfter: '42', failure: undefined,
  });
  assert.deepEqual(r.data, { error: 'rate_limited' });
});

test('2xx with a non-JSON body → bad_json; non-2xx with a non-JSON body → plain HTTP failure', async () => {
  const ok = await handleApiRequest(msg(), deps({ respond: () => new Response('<html>', { status: 200 }) }).d);
  assert.equal(ok.failure, 'bad_json');
  assert.equal(ok.ok, false);
  const bad = await handleApiRequest(msg(), deps({ respond: () => new Response('<html>', { status: 502 }) }).d);
  assert.deepEqual({ ok: bad.ok, status: bad.status, failure: bad.failure }, { ok: false, status: 502, failure: undefined });
});

test('network error → failure network with the reason', async () => {
  const r = await handleApiRequest(msg(), deps({ respond: () => { throw new TypeError('Failed to fetch'); } }).d);
  assert.equal(r.failure, 'network');
  assert.equal(r.message, 'Failed to fetch');
  assert.equal(r.status, 0);
});

const hangUntilAborted = (_url: string, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

test('timeout → failure timeout', async () => {
  const r = await handleApiRequest(msg({ timeoutMs: 20 }), deps({ respond: hangUntilAborted }).d);
  assert.equal(r.failure, 'timeout');
});

test('abort from the content script → failure aborted (also when already aborted)', async () => {
  const ac = new AbortController();
  const pending = handleApiRequest(msg(), deps({ respond: hangUntilAborted }).d, ac.signal);
  setTimeout(() => ac.abort(), 10);
  assert.equal((await pending).failure, 'aborted');
  const pre = new AbortController();
  pre.abort();
  const r = await handleApiRequest(msg(), deps({ respond: hangUntilAborted }).d, pre.signal);
  assert.equal(r.failure, 'aborted');
});

test('unreadable storage falls back to the defaults instead of failing', async () => {
  const { d, calls } = deps({ readConfig: async () => { throw new Error('storage gone'); } });
  await handleApiRequest(msg(), d);
  assert.equal(calls[0]!.url, `${DEFAULT_API_URL}/score`);
  assert.equal((calls[0]!.init.headers as Record<string, string>)['X-Team-Token'], TEAM_TOKEN);
});

test('timeouts are clamped to 60 s', async () => {
  let seen = 0;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => { seen = Math.max(seen, ms ?? 0); return realSetTimeout(fn, 2 ** 31 - 1); }) as typeof setTimeout; // recorded, never fires (cleared)
  try {
    await handleApiRequest(msg({ timeoutMs: 10 * 60_000 }), deps().d);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.equal(seen, 60_000);
});
