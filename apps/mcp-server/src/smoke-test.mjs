// End-to-end smoke test: spawns the MCP server as a child process, speaks
// JSON-RPC over stdio, lists tools, calls wiki_update_learnings, asserts the
// response shape. No mocks — hits the live Railway API.
//
// Usage: node smoke-test.mjs   (env: TRAILHEAD_API_URL, TRAILHEAD_TEAM_TOKEN)
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(__dirname, 'index.ts');

// Load env from repo root .env if present.
for (const candidate of ['../../../.env', '../../.env', '.env']) {
  const p = resolve(__dirname, candidate);
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

const env = {
  ...process.env,
  TRAILHEAD_API_URL: process.env.TRAILHEAD_API_URL ?? 'https://trailheadapi-production.up.railway.app',
  TRAILHEAD_TEAM_TOKEN: process.env.TRAILHEAD_TEAM_TOKEN ?? 'trailhead_demo_acme_2026',
};

const child = spawn('npx', ['--yes', 'tsx', SERVER], {
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});

let buffer = '';
const responses = new Map();
const pending = new Map();

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      console.error('non-JSON stdout:', line);
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve: r } = pending.get(msg.id);
      pending.delete(msg.id);
      responses.set(msg.id, msg);
      r(msg);
    }
  }
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(`[server] ${chunk}`);
});

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  const req = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify(req)}\n`);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for response to ${method}`));
      }
    }, 15000);
  });
}

function notify(method, params) {
  const req = { jsonrpc: '2.0', method, params };
  child.stdin.write(`${JSON.stringify(req)}\n`);
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  child.kill();
  process.exit(1);
}

(async () => {
  // Wait for the server to be ready.
  await new Promise((r) => setTimeout(r, 1500));

  // 1. initialize handshake.
  const initRes = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0.0.1' },
  });
  if (!initRes.result?.serverInfo) fail('initialize missing serverInfo');
  console.log(`init OK: ${initRes.result.serverInfo.name}@${initRes.result.serverInfo.version}`);
  notify('notifications/initialized');

  // 2. tools/list.
  const listRes = await send('tools/list', {});
  const tools = listRes.result?.tools ?? [];
  const names = tools.map((t) => t.name).sort();
  console.log(`tools: ${names.join(', ')}`);
  for (const expected of ['wiki_update_learnings', 'wiki_context_for', 'wiki_rules_for', 'wiki_search', 'ping']) {
    if (!names.includes(expected)) fail(`missing tool: ${expected}`);
  }

  // 3. call ping.
  const pingRes = await send('tools/call', { name: 'ping', arguments: {} });
  if (pingRes.result?.isError) fail(`ping returned error: ${JSON.stringify(pingRes.result)}`);
  if (!pingRes.result?.structuredContent?.ok) fail(`ping missing ok=true: ${JSON.stringify(pingRes.result)}`);
  console.log('ping OK');

  // 4. call wiki_update_learnings against the live stub.
  const wikiRes = await send('tools/call', {
    name: 'wiki_update_learnings',
    arguments: {
      node_path: 'src/api/webhooks/',
      insight: 'Use exponential backoff with jitter for webhook retries.',
    },
  });
  if (wikiRes.result?.isError) fail(`wiki_update_learnings error: ${JSON.stringify(wikiRes.result)}`);
  const sc = wikiRes.result?.structuredContent;
  if (!sc) fail('wiki_update_learnings missing structuredContent');
  if (!['created', 'reinforced', 'promoted'].includes(sc.action)) {
    fail(`wiki_update_learnings unexpected action: ${sc.action}`);
  }
  if (typeof sc.current_count !== 'number') fail('wiki_update_learnings missing current_count');
  console.log(`wiki_update_learnings OK: ${sc.action} count=${sc.current_count}`);

  // 5. invalid input rejected by zod.
  const badRes = await send('tools/call', {
    name: 'wiki_update_learnings',
    arguments: { node_path: '', insight: '' },
  });
  if (!badRes.result?.isError && !badRes.error) {
    fail(`expected error for empty input, got: ${JSON.stringify(badRes.result)}`);
  }
  console.log('input validation OK (rejected empty fields)');

  console.log('\nALL CHECKS PASSED');
  child.kill();
  process.exit(0);
})().catch((e) => {
  console.error('test runner error:', e);
  child.kill();
  process.exit(1);
});
