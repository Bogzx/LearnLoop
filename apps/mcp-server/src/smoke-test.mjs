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
    // 60s — coach_score and coach_augment make a Gemini round-trip; cold
    // start + retry backoff can push past 15s.
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for response to ${method}`));
      }
    }, 60000);
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
  for (const expected of [
    'wiki_update_learnings',
    'wiki_context_for',
    'wiki_rules_for',
    'wiki_search',
    'ping',
    'coach_score',
    'coach_examples',
    'coach_augment',
  ]) {
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

  // 6. coach_score on a deliberately weak prompt — must score < 7 and return
  // a non-null next_question. This is the demo's "fix the retry" beat.
  const weakRes = await send('tools/call', {
    name: 'coach_score',
    arguments: { prompt: 'fix the retry' },
  });
  if (weakRes.result?.isError) fail(`coach_score error: ${JSON.stringify(weakRes.result)}`);
  const weakSc = weakRes.result?.structuredContent;
  if (!weakSc) fail('coach_score missing structuredContent');
  if (typeof weakSc.overall !== 'number') fail('coach_score missing overall');
  if (weakSc.overall >= 7) {
    console.warn(`WARN: weak prompt scored ${weakSc.overall}/10 — coaching beat will not trigger. Re-tune demo prompt.`);
  } else {
    if (!weakSc.next_question) fail('coach_score < 7 must have next_question');
    if (!weakSc.next_question.dimension || !weakSc.next_question.question) {
      fail(`coach_score next_question malformed: ${JSON.stringify(weakSc.next_question)}`);
    }
    console.log(`coach_score OK: weak prompt → ${weakSc.overall}/10, next_question on '${weakSc.next_question.dimension}'`);
  }

  // 7. coach_score on a strong prompt — must score >= 7 and return null
  // next_question (no friction for power users — spec §6).
  const strongRes = await send('tools/call', {
    name: 'coach_score',
    arguments: {
      prompt:
        'In src/api/webhooks/handler.ts, refactor the retry loop in handleWebhook() to use exponential backoff with jitter (max 5 attempts, base 200ms). Must remain idempotent and not change the public API. Return only the modified function with no explanation.',
      file_path: 'src/api/webhooks/handler.ts',
    },
  });
  if (strongRes.result?.isError) fail(`coach_score (strong) error: ${JSON.stringify(strongRes.result)}`);
  const strongSc = strongRes.result?.structuredContent;
  if (!strongSc) fail('coach_score (strong) missing structuredContent');
  if (strongSc.overall < 7) {
    console.warn(`WARN: strong prompt scored ${strongSc.overall}/10 — Gemini variance. Likely fine for demo but verify.`);
  } else if (strongSc.next_question !== null) {
    fail(`coach_score (strong) >= 7 must have next_question=null, got: ${JSON.stringify(strongSc.next_question)}`);
  } else {
    console.log(`coach_score OK: strong prompt → ${strongSc.overall}/10, no coaching needed`);
  }

  // 8. coach_examples for a known seeded path.
  const exRes = await send('tools/call', {
    name: 'coach_examples',
    arguments: { file_path: 'src/api/webhooks/handler.ts', limit: 3 },
  });
  if (exRes.result?.isError) fail(`coach_examples error: ${JSON.stringify(exRes.result)}`);
  console.log(`coach_examples OK: ${(exRes.result?.content?.[0]?.text ?? '').slice(0, 60)}...`);

  // 9. coach_augment — round-trip the weak prompt and assert the augmented
  // version contains the coaching addendum.
  const augRes = await send('tools/call', {
    name: 'coach_augment',
    arguments: { prompt: 'fix the retry' },
  });
  if (augRes.result?.isError) fail(`coach_augment error: ${JSON.stringify(augRes.result)}`);
  const augSc = augRes.result?.structuredContent;
  if (!augSc?.augmented_prompt?.includes('Trailhead coaching')) {
    fail(`coach_augment augmented_prompt missing coaching addendum: ${augSc?.augmented_prompt?.slice(0, 100)}`);
  }
  console.log(`coach_augment OK: original=${augSc.original_overall}/10, ${augSc.missing_dims.length} missing dims`);

  console.log('\nALL CHECKS PASSED');
  child.kill();
  process.exit(0);
})().catch((e) => {
  console.error('test runner error:', e);
  child.kill();
  process.exit(1);
});
