// Exercise every MCP tool against the live Railway API and report what
// behaves correctly vs. what surfaces an upstream 404. Used as a verification
// harness — not a unit test.
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(__dirname, 'index.ts');

const child = spawn('npx', ['--yes', 'tsx', SERVER], {
  env: {
    ...process.env,
    TRAILHEAD_API_URL: 'https://trailheadapi-production.up.railway.app',
    TRAILHEAD_TEAM_TOKEN: 'trailhead_demo_acme_2026',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});

let buffer = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (c) => {
  buffer += c.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const m = JSON.parse(line);
      if (pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    } catch {}
  }
});

function send(method, params) {
  const id = nextId++;
  return new Promise((r) => {
    pending.set(id, r);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function callTool(name, args) {
  return send('tools/call', { name, arguments: args });
}

(async () => {
  await new Promise((r) => setTimeout(r, 1500));
  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'verify', version: '0' },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const cases = [
    ['ping', {}],
    ['wiki_update_learnings', { node_path: 'src/api/webhooks/', insight: 'Use exponential backoff with jitter for webhook retries.' }],
    ['wiki_context_for', { file_path: 'src/api/webhooks/handler.ts' }],
    ['wiki_rules_for', { file_path: 'src/api/webhooks/handler.ts' }],
    ['wiki_search', { query: 'webhook retry' }],
  ];

  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + pad('tool', 24) + pad('result', 8) + 'detail');
  console.log('─'.repeat(80));
  let ok = 0, errs = 0;
  for (const [name, args] of cases) {
    const res = await callTool(name, args);
    const r = res.result ?? {};
    const status = r.isError ? 'ERROR' : 'OK';
    if (r.isError) errs++; else ok++;
    let detail = '';
    if (r.structuredContent) {
      detail = JSON.stringify(r.structuredContent);
    } else if (r.content?.[0]?.text) {
      const t = r.content[0].text;
      detail = t.length > 70 ? t.slice(0, 70) + '…' : t;
    }
    console.log(pad(name, 24) + pad(status, 8) + detail);
  }
  console.log('─'.repeat(80));
  console.log(`${ok} ok, ${errs} error${errs === 1 ? '' : 's'}`);
  child.kill();
  process.exit(0);
})();
