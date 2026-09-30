// Loads the bundled IIFE under a JS DOM-like global stub and asserts:
//   - the bundle parses + executes without throwing
//   - manifest.json was copied next to content.js
//   - the bundle wires `console.info` with the [trailhead] tag when selectors
//     resolve (we leave selectors unresolved so it just schedules a retry)
//
// This is the page-free equivalent of "load unpacked into Chrome".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '../dist');
const bundlePath = resolve(distDir, 'content.js');
const manifestPath = resolve(distDir, 'manifest.json');

test('manifest.json is copied to dist/', async () => {
  const s = await stat(manifestPath);
  assert.ok(s.isFile());
  const m = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.content_scripts[0].js, ['content.js']);
  assert.ok(m.host_permissions.includes('https://claude.ai/*'));
  assert.equal(m.background.service_worker, 'background.js');
  await stat(resolve(distDir, 'background.js'));
});

test('content.js bundle loads in a minimal DOM-like sandbox', async () => {
  const code = await readFile(bundlePath, 'utf8');

  // A vanishingly small DOM stub. The bundle calls things like
  // document.addEventListener / document.head.appendChild / setTimeout /
  // window.addEventListener at top-level; we don't care if they do anything,
  // only that they don't blow up.
  const noop = () => {};
  const fakeEl = () => ({
    setAttribute: noop, appendChild: noop, prepend: noop, replaceChildren: noop,
    addEventListener: noop, removeEventListener: noop, classList: { add: noop, remove: noop },
    dataset: {}, style: {}, hidden: false, isConnected: false, dispatchEvent: () => true,
    insertAdjacentElement: noop, remove: noop, querySelector: () => null,
    querySelectorAll: () => [], matches: () => false,
    closest: () => null, parentElement: null, previousElementSibling: null,
    childElementCount: 0, innerText: '', textContent: '', attributes: {},
    children: [], setAttributeNS: noop,
  });
  const document = {
    readyState: 'complete',
    addEventListener: noop,
    removeEventListener: noop,
    createElement: () => fakeEl(),
    head: { appendChild: noop },
    body: fakeEl(),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    visibilityState: 'hidden',
  };
  const calls = { warn: [], info: [] };
  const win = {
    addEventListener: noop,
    setTimeout: (_fn, _ms) => 0,
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
    document,
    location: { href: 'https://claude.ai/' },
    HTMLTextAreaElement: function HTMLTextAreaElement() {},
    HTMLElement: function HTMLElement() {},
    InputEvent: function InputEvent() {},
    KeyboardEvent: function KeyboardEvent() {},
    Event: function Event() {},
    MutationObserver: function MutationObserver() {
      return { observe: noop, disconnect: noop };
    },
    AbortController: globalThis.AbortController,
    URLSearchParams: globalThis.URLSearchParams,
    fetch: () => Promise.reject(new Error('no network in test')),
    DOMException: globalThis.DOMException,
    Response: globalThis.Response,
    Promise: globalThis.Promise,
    console: {
      log: noop,
      warn: (...a) => calls.warn.push(a),
      info: (...a) => calls.info.push(a),
      error: noop,
      debug: noop,
    },
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  // Provide a minimal `chrome` so isDisabled() can early-out via storage.
  // storage.local.get supports both the callback form (the state modules)
  // and the promise form (isDisabled), like Chrome's.
  const stored = { ['trailhead.disabled']: false };
  win.chrome = {
    storage: {
      local: {
        get: (_keys, cb) => (cb ? void cb(stored) : Promise.resolve(stored)),
        set: noop,
      },
      onChanged: { addListener: noop },
    },
  };

  const ctx = vm.createContext(win);
  // The bundle is an IIFE; just running it executes main().
  vm.runInContext(code, ctx, { filename: 'content.js' });

  // Yield once to let the async main() promise settle.
  await new Promise((r) => setImmediate(r));

  // Either the dom-mismatch retry was scheduled, or we mounted (we won't
  // mount with our shallow stub). Either way we should not see crashes.
  const allMsgs = [...calls.warn.flat(), ...calls.info.flat()].map(String).join('\n');
  assert.ok(
    allMsgs.includes('[trailhead]'),
    `expected a [trailhead] log line, got:\n${allMsgs || '(none)'}`,
  );
});

// The service worker bundle: registers one onMessage listener that performs
// the fetch with the stored API URL and secret, replies asynchronously, and
// ignores messages from anyone but this extension.
test('background.js worker answers API messages from this extension only', async () => {
  const code = await readFile(resolve(distDir, 'background.js'), 'utf8');
  let listener = null;
  const fetches = [];
  const storage = { 'trailhead.apiUrl': 'http://localhost:55802/', 'trailhead.selectedTeamToken': 'trailhead_sk_bundle' };
  const sandbox = {
    console: { log() {}, warn() {}, info() {}, error() {} },
    setTimeout, clearTimeout, AbortController, URL, JSON, Promise, Response,
    fetch: async (url, init) => {
      fetches.push({ url, init });
      return new Response('{"overall":9}', { status: 200 });
    },
    chrome: {
      runtime: { id: 'ext-id', onMessage: { addListener: (fn) => { listener = fn; } } },
      storage: { local: { get: (_keys, cb) => cb(storage) } },
      permissions: { contains: (_q, cb) => cb(true) },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInContext(code, vm.createContext(sandbox), { filename: 'background.js' });
  assert.equal(typeof listener, 'function', 'onMessage listener registered');

  const msg = { type: 'trailhead.api', id: 'b1', path: '/score', method: 'POST', body: { prompt: 'p' }, timeoutMs: 5000 };
  // Foreign sender: ignored, no fetch.
  assert.equal(listener(msg, { id: 'other-ext' }, () => assert.fail('must not reply')), false);
  assert.equal(fetches.length, 0);

  const reply = await new Promise((res) => {
    assert.equal(listener(msg, { id: 'ext-id' }, res), true, 'replies asynchronously');
  });
  assert.equal(reply.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(reply.data)), { overall: 9 });
  assert.equal(reply.apiUrl, 'http://localhost:55802');
  assert.equal(fetches[0].url, 'http://localhost:55802/score');
  assert.equal(fetches[0].init.headers['X-Team-Token'], 'trailhead_sk_bundle');
});
