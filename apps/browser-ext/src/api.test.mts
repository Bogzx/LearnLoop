// API wrapper tests — no DOM, no real network. We swap `globalThis.fetch`
// with a stub that records calls and returns canned responses, then assert:
//   - 200 → parsed body
//   - 401/500 → null
//   - X-Team-Token header is set on every request
//   - capture/diff/wikiRecent route to the right paths
import test from 'node:test';
import assert from 'node:assert/strict';
import { capture, diff, score, wikiRecent } from './api.ts';
import { TEAM_TOKEN } from './config.ts';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function withFetchStub(
  responder: (call: FetchCall) => Response | Promise<Response>,
): { calls: FetchCall[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const call = { url, init };
    calls.push(call);
    if (init.signal?.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    return responder(call);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

test('score returns parsed body and sends X-Team-Token', async () => {
  const stub = withFetchStub(() => jsonResponse(sampleScore));
  try {
    const res = await score({ prompt: 'fix the retry', user_id: 'demo' });
    assert.ok(res);
    assert.equal(res.overall, 4);
    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0]!.url, /\/score$/);
    const headers = stub.calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers['X-Team-Token'], TEAM_TOKEN);
    assert.equal(headers['Content-Type'], 'application/json');
  } finally {
    stub.restore();
  }
});

test('score returns null on 500', async () => {
  const stub = withFetchStub(() => jsonResponse({ error: 'oops' }, 500));
  try {
    const res = await score({ prompt: 'fix the retry', user_id: 'demo' });
    assert.equal(res, null);
  } finally {
    stub.restore();
  }
});

test('score returns null on 401', async () => {
  const stub = withFetchStub(() => jsonResponse({ error: 'unauthorized' }, 401));
  try {
    const res = await score({ prompt: 'fix the retry', user_id: 'demo' });
    assert.equal(res, null);
  } finally {
    stub.restore();
  }
});

test('capture POSTs to /capture with the body', async () => {
  const stub = withFetchStub(() => jsonResponse({ id: 'cap_123' }));
  try {
    const res = await capture({
      surface: 'browser',
      user_prompt: 'fix the retry',
      user_id: 'demo',
    });
    assert.ok(res);
    assert.equal(res.id, 'cap_123');
    assert.equal(stub.calls[0]!.init.method, 'POST');
    assert.match(stub.calls[0]!.url, /\/capture$/);
  } finally {
    stub.restore();
  }
});

test('diff POSTs to /diff', async () => {
  const stub = withFetchStub(() => jsonResponse({ user: {}, team: {}, narrative: '' }));
  try {
    await diff({ user_prompt: 'fix the retry', user_id: 'demo' });
    assert.match(stub.calls[0]!.url, /\/diff$/);
    assert.equal(stub.calls[0]!.init.method, 'POST');
  } finally {
    stub.restore();
  }
});

test('wikiRecent GETs /wiki/recent with the since query', async () => {
  const stub = withFetchStub(() => jsonResponse({ items: [] }));
  try {
    await wikiRecent('2026-04-25T00:00:00.000Z');
    assert.match(stub.calls[0]!.url, /\/wiki\/recent\?since=/);
    assert.equal(stub.calls[0]!.init.method, 'GET');
  } finally {
    stub.restore();
  }
});

test('network error returns null instead of throwing', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  try {
    const res = await score({ prompt: 'fix the retry', user_id: 'demo' });
    assert.equal(res, null);
  } finally {
    globalThis.fetch = original;
  }
});
