// Content-side API client tests — no DOM, no chrome.*, no real network.
//
// api.ts talks to the extension's service worker over a transport
// (chrome.runtime.sendMessage in the browser). Here the transport is a fake
// worker that runs the REAL worker core (worker-core.ts handleApiRequest)
// against a stubbed fetch, so these tests cover the whole path:
// content call → message → worker fetch → reply → content result.
// globalThis.fetch is booby-trapped: the content script must never fetch.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { capture, coach, diff, noteRateLimit, score, setWorkerTransport, wikiRecent, wikiTree } from './api.ts';
import {
  API_ABORT_MESSAGE,
  API_MESSAGE,
  handleApiRequest,
  type ApiAbortMessage,
  type ApiReply,
  type ApiRequestMessage,
} from './worker-core.ts';

const API = 'http://api.test:4000';
const SECRET = 'trailhead_sk_test';

interface FetchCall {
  url: string;
  init: RequestInit;
}

type Responder = (call: FetchCall) => Response | Promise<Response>;

function fakeWorker(responder: Responder) {
  const fetchCalls: FetchCall[] = [];
  const messages: Array<ApiRequestMessage | ApiAbortMessage> = [];
  const controllers = new Map<string, AbortController>();
  const stubFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    fetchCalls.push(call);
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return responder(call);
  }) as typeof fetch;
  setWorkerTransport(async (msg) => {
    messages.push(msg);
    if (msg.type === API_ABORT_MESSAGE) {
      controllers.get(msg.id)?.abort();
      return undefined;
    }
    const ac = new AbortController();
    controllers.set(msg.id, ac);
    // Round-trip through structured clone, like chrome.runtime messaging.
    const cloned = structuredClone(msg);
    const reply = await handleApiRequest(
      cloned,
      {
        fetch: stubFetch,
        readConfig: async () => ({ apiUrl: API, teamToken: SECRET }),
        hasHostPermission: async () => true,
      },
      ac.signal,
    );
    return structuredClone(reply);
  });
  return { fetchCalls, messages };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function captureWarnings() {
  const warnings: string[] = [];
  const real = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  return { warnings, restore: () => { console.warn = real; } };
}

const sampleScore = {
  overall: 4,
  dimensions: {
    goal_clarity: 8,
    specificity: 4,
    context_loading: 2,
    constraint_articulation: 1,
    output_specification: 3,
  },
  missing: { context_loading: 'no file referenced' },
};

const realFetch = globalThis.fetch;
test.beforeEach(() => {
  globalThis.fetch = (() => {
    throw new Error('the content script must not fetch the API directly');
  }) as typeof fetch;
});
test.afterEach(() => {
  globalThis.fetch = realFetch;
  setWorkerTransport(null);
});

test('score goes to the worker as a message; the worker fetches with the stored secret', async () => {
  const w = fakeWorker(() => jsonResponse(sampleScore));
  const res = await score({ prompt: 'fix the retry', user_id: 'u1' });
  assert.equal(res?.overall, 4);
  assert.equal(w.messages.length, 1);
  const msg = w.messages[0] as ApiRequestMessage;
  assert.equal(msg.type, API_MESSAGE);
  assert.equal(msg.path, '/score');
  assert.equal(msg.method, 'POST');
  assert.deepEqual(msg.body, { prompt: 'fix the retry', user_id: 'u1' });
  assert.ok(!JSON.stringify(msg).includes(SECRET), 'the secret is not in the message');
  assert.equal(w.fetchCalls[0]!.url, `${API}/score`);
  const headers = w.fetchCalls[0]!.init.headers as Record<string, string>;
  assert.equal(headers['X-Team-Token'], SECRET);
  assert.equal(headers['Content-Type'], 'application/json');
});

test('non-2xx → null (fail open)', async () => {
  for (const status of [401, 500]) {
    fakeWorker(() => jsonResponse({ error: 'x' }, status));
    const warn = captureWarnings();
    try {
      assert.equal(await score({ prompt: 'p', user_id: 'u' }), null);
      assert.ok(warn.warnings.some((w) => w.includes(`HTTP ${status}`)));
    } finally {
      warn.restore();
    }
  }
});

test('capture, diff, wikiRecent and wikiTree route to the right paths and methods', async () => {
  const w = fakeWorker((c) => jsonResponse(c.url.endsWith('/capture') ? { id: 'cap_1' } : { nodes: [], items: [] }));
  assert.equal((await capture({ surface: 'browser', user_prompt: 'p', user_id: 'u' }))?.id, 'cap_1');
  await diff({ user_prompt: 'p', user_id: 'u' });
  await wikiRecent('2026-04-25T00:00:00.000Z');
  await wikiTree();
  assert.deepEqual(
    w.fetchCalls.map((c) => `${c.init.method} ${c.url.slice(API.length)}`),
    ['POST /capture', 'POST /diff', 'GET /wiki/recent?since=2026-04-25T00%3A00%3A00.000Z', 'GET /wiki/tree'],
  );
});

test('network error → null, and the hint names the URL the worker actually used', async () => {
  fakeWorker(() => {
    throw new TypeError('Failed to fetch');
  });
  const warn = captureWarnings();
  try {
    assert.equal(await score({ prompt: 'p', user_id: 'u' }), null);
    assert.equal(warn.warnings.length, 1);
    assert.match(warn.warnings[0]!, new RegExp(`cannot reach the Trailhead API at ${API.replace(/\./g, '\\.')}`));
    assert.match(warn.warnings[0]!, /request: \/score/);
  } finally {
    warn.restore();
  }
});

test('429 → null (fail open), with one rate-limit warning per minute', async () => {
  fakeWorker(() => jsonResponse({ error: 'rate_limited' }, 429, { 'Retry-After': '30' }));
  const warn = captureWarnings();
  try {
    assert.equal(await score({ prompt: 'x', user_id: 'u' }), null);
    const limited = warn.warnings.filter((w) => w.includes('rate limiting'));
    assert.equal(limited.length, 1);
    assert.match(limited[0]!, /retry in 30s/);
    assert.ok(!warn.warnings.some((w) => w.includes('HTTP 429')), '429 is not also logged as a generic failure');
    // Throttled: another 429 within the minute logs nothing new.
    assert.equal(noteRateLimit({ status: 429, retryAfter: null }, Date.now() + 1_000), true);
    assert.equal(warn.warnings.filter((w) => w.includes('rate limiting')).length, 1);
    assert.equal(noteRateLimit({ status: 200, retryAfter: null }), false);
  } finally {
    warn.restore();
  }
});

test('the legacy-token Deprecation header is reported once', async () => {
  fakeWorker(() => jsonResponse(sampleScore, 200, { Deprecation: 'true' }));
  const warn = captureWarnings();
  try {
    await score({ prompt: 'a', user_id: 'u' });
    await score({ prompt: 'b', user_id: 'u' });
    assert.equal(warn.warnings.filter((w) => w.includes('legacy token')).length, 1);
  } finally {
    warn.restore();
  }
});

test('a newer /score supersedes the in-flight one: it resolves null at once and the worker aborts its fetch', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const w = fakeWorker(async (c) => {
    if (c.init.body && String(c.init.body).includes('first')) {
      await new Promise<void>((resolve, reject) => {
        c.init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        void gate.then(resolve);
      });
    }
    return jsonResponse(sampleScore);
  });
  const warn = captureWarnings();
  try {
    const first = score({ prompt: 'first', user_id: 'u' });
    await new Promise((r) => setImmediate(r));
    const second = score({ prompt: 'second', user_id: 'u' });
    assert.equal(await first, null);
    assert.equal((await second)?.overall, 4);
    const abort = w.messages.find((m) => m.type === API_ABORT_MESSAGE);
    assert.ok(abort, 'an abort message was sent');
    assert.equal(abort.id, (w.messages[0] as ApiRequestMessage).id);
    assert.equal(warn.warnings.length, 0, 'superseded requests are silent');
  } finally {
    release();
    warn.restore();
  }
});

test('/coach calls do not cancel each other', async () => {
  const w = fakeWorker(async () => {
    await new Promise((r) => setTimeout(r, 20));
    return jsonResponse({ proceed: true });
  });
  const [a, b] = await Promise.all([
    coach({ prompt: 'a', user_id: 'u' } as never),
    coach({ prompt: 'b', user_id: 'u' } as never),
  ]);
  assert.ok(a && b);
  assert.equal(w.messages.filter((m) => m.type === API_ABORT_MESSAGE).length, 0);
  assert.equal((w.messages[0] as ApiRequestMessage).timeoutMs, 25_000);
});

test('worker gone (extension reloaded under the tab) → null with a reload hint, never throws', async () => {
  setWorkerTransport(async () => {
    throw new Error('Extension context invalidated.');
  });
  const warn = captureWarnings();
  try {
    assert.equal(await score({ prompt: 'p', user_id: 'u' }), null);
    assert.ok(warn.warnings.some((w) => w.includes('background worker did not answer')));
  } finally {
    warn.restore();
  }
});

test('worker never answers → null after the local backstop', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  setWorkerTransport(() => new Promise<ApiReply | undefined>(() => {}));
  const warn = captureWarnings();
  try {
    const pending = score({ prompt: 'p', user_id: 'u' });
    mock.timers.tick(12_000 + 3_000);
    assert.equal(await pending, null);
    assert.ok(warn.warnings.some((w) => w.includes('background worker did not answer')));
  } finally {
    warn.restore();
    mock.timers.reset();
  }
});

test('a reply without a response (no listener) → null', async () => {
  setWorkerTransport(async () => undefined);
  const warn = captureWarnings();
  try {
    assert.equal(await wikiRecent('2026-01-01T00:00:00Z'), null);
  } finally {
    warn.restore();
  }
});
