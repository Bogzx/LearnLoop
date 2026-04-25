// Loads the bundled CJS extension with a stub `vscode` module and asserts:
// - the bundle exports `activate` + `deactivate`
// - calling `activate(ctx)` registers a webview view provider
// - the `onDidChangeActiveTextEditor` listener is wired
// This is the VS-Code-free equivalent of "F5 → Extension Development Host".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(__dirname, '../dist/extension.js');
const require = createRequire(import.meta.url);

function makeVscodeStub() {
  const calls = {
    registerWebviewViewProvider: 0,
    onDidChangeActiveTextEditor: 0,
    registerCommand: 0,
    showInformationMessage: [],
  };
  const subscriptions = [];
  const Module = require('node:module');
  const realResolve = Module._resolveFilename;
  const realLoad = Module._load;
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'vscode') return 'vscode';
    return realResolve.call(this, request, ...rest);
  };
  Module._load = function (request, ...rest) {
    if (request === 'vscode') return vscode;
    return realLoad.call(this, request, ...rest);
  };
  const restore = () => {
    Module._resolveFilename = realResolve;
    Module._load = realLoad;
  };
  const vscode = {
    window: {
      registerWebviewViewProvider: (_id, _provider, _opts) => {
        calls.registerWebviewViewProvider++;
        return { dispose() {} };
      },
      onDidChangeActiveTextEditor: (_cb) => {
        calls.onDidChangeActiveTextEditor++;
        return { dispose() {} };
      },
      activeTextEditor: undefined,
      showInformationMessage: (s) => {
        calls.showInformationMessage.push(s);
      },
    },
    commands: {
      registerCommand: (_id, _cb) => {
        calls.registerCommand++;
        return { dispose() {} };
      },
    },
    workspace: {
      getConfiguration: () => ({ get: () => undefined }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      getWorkspaceFolder: () => undefined,
      asRelativePath: (s) => String(s),
    },
  };
  return { vscode, calls, subscriptions, restore };
}

test('bundle loads, activate registers all subscriptions', () => {
  const { vscode, calls, restore } = makeVscodeStub();
  let mod;
  try {
    delete require.cache[require.resolve(bundlePath)];
    mod = require(bundlePath);
    assert.equal(typeof mod.activate, 'function');
    assert.equal(typeof mod.deactivate, 'function');

    const subs = [];
    const ctx = { subscriptions: subs, extensionUri: {} };
    mod.activate(ctx);

    assert.equal(calls.registerWebviewViewProvider, 1, 'webview provider registered');
    assert.equal(calls.onDidChangeActiveTextEditor, 1, 'editor change listener registered');
    assert.equal(calls.registerCommand, 1, 'refresh command registered');
    assert.equal(subs.length, 3, 'all 3 subscriptions tracked');

    mod.deactivate();
  } finally {
    restore();
  }
});
