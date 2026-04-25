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
    setTimeout: (fn, _ms) => 0,
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
  win.chrome = {
    storage: { local: { get: async () => ({ ['trailhead.disabled']: false }) } },
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
