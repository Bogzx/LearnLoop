// End-to-end smoke test: spawns the MCP server as a child process, speaks
// JSON-RPC over stdio, lists tools, calls every hero tool, asserts response
// shapes. No mocks — hits the live Railway API.
//
// Usage: node smoke-test.mjs   (env: TRAILHEAD_API_URL, TRAILHEAD_TEAM_TOKEN)
//
// Spec ref: docs/superpowers/specs/2026-04-25-mcp-plugin-ux-design.md
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
    // 60s — coach hits Gemini; cold start + retry backoff can push past 15s.
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

  // 2. tools/list — must contain the 3 hero tools + ping.
  const listRes = await send('tools/list', {});
  const tools = listRes.result?.tools ?? [];
  const names = tools.map((t) => t.name).sort();
  console.log(`tools: ${names.join(', ')}`);
  for (const expected of ['coach', 'wiki_lookup', 'wiki_save', 'wiki_bootstrap', 'ping']) {
    if (!names.includes(expected)) fail(`missing tool: ${expected}`);
  }
  // Old tool names must be gone — keeping them would re-introduce the
  // selector-confusion problem we collapsed the surface to fix.
  for (const old of [
    'coach_score',
    'coach_examples',
    'coach_augment',
    'wiki_update_learnings',
    'wiki_context_for',
    'wiki_rules_for',
    'wiki_search',
  ]) {
    if (names.includes(old)) fail(`legacy tool still registered: ${old}`);
  }

  // Directive must mention the new wiki_bootstrap tool too.

  // 3. resources/list — coaching-directive must be exposed.
  const resRes = await send('resources/list', {});
  const resources = resRes.result?.resources ?? [];
  const directive = resources.find((r) => r.uri === 'trailhead://coaching-directive');
  if (!directive) fail(`coaching-directive resource not advertised: ${JSON.stringify(resources)}`);
  console.log(`resource OK: ${directive.uri} (${directive.mimeType})`);

  // 4. resources/read — directive content must include the hero tool names.
  const readRes = await send('resources/read', { uri: 'trailhead://coaching-directive' });
  const directiveText = readRes.result?.contents?.[0]?.text ?? '';
  if (!directiveText.includes('coach')) fail('directive missing `coach` mention');
  if (!directiveText.includes('wiki_lookup')) fail('directive missing `wiki_lookup` mention');
  if (!directiveText.includes('wiki_save')) fail('directive missing `wiki_save` mention');
  if (!directiveText.includes('wiki_bootstrap')) fail('directive missing `wiki_bootstrap` mention');
  console.log(`resource read OK: ${directiveText.length} chars`);

  // 5. ping — health check.
  const pingRes = await send('tools/call', { name: 'ping', arguments: {} });
  if (pingRes.result?.isError) fail(`ping returned error: ${JSON.stringify(pingRes.result)}`);
  if (!pingRes.result?.structuredContent?.ok) fail(`ping missing ok=true: ${JSON.stringify(pingRes.result)}`);
  console.log('ping OK');

  // 6. wiki_save against the live stub.
  const wikiRes = await send('tools/call', {
    name: 'wiki_save',
    arguments: {
      node_path: 'src/api/webhooks/',
      insight: 'Use exponential backoff with jitter for webhook retries.',
    },
  });
  if (wikiRes.result?.isError) fail(`wiki_save error: ${JSON.stringify(wikiRes.result)}`);
  const sc = wikiRes.result?.structuredContent;
  if (!sc) fail('wiki_save missing structuredContent');
  if (!['created', 'reinforced', 'promoted'].includes(sc.action)) {
    fail(`wiki_save unexpected action: ${sc.action}`);
  }
  if (typeof sc.current_count !== 'number') fail('wiki_save missing current_count');
  console.log(`wiki_save OK: ${sc.action} count=${sc.current_count}`);

  // 7. invalid input rejected by zod.
  const badRes = await send('tools/call', {
    name: 'wiki_save',
    arguments: { node_path: '', insight: '' },
  });
  if (!badRes.result?.isError && !badRes.error) {
    fail(`expected error for empty input, got: ${JSON.stringify(badRes.result)}`);
  }
  console.log('input validation OK (rejected empty fields)');

  // 8. coach (mode='score' default) on a deliberately weak prompt.
  // Educational-loop shape: { proceed, text, next_round_inputs?, ... }.
  // Spec: docs/superpowers/specs/2026-04-26-trailhead-educational-loop-design.md
  const weakRes = await send('tools/call', {
    name: 'coach',
    arguments: { prompt: 'fix the retry' },
  });
  if (weakRes.result?.isError) fail(`coach error: ${JSON.stringify(weakRes.result)}`);
  const weakSc = weakRes.result?.structuredContent;
  if (!weakSc) fail('coach missing structuredContent');
  if (weakSc.mode !== 'score') fail(`coach default mode should be 'score', got ${weakSc.mode}`);
  if (typeof weakSc.overall !== 'number') fail('coach missing overall');
  if (typeof weakSc.proceed !== 'boolean') fail('coach missing proceed flag');
  if (weakSc.overall >= 7) {
    console.warn(`WARN: weak prompt scored ${weakSc.overall}/10 — coaching beat will not trigger.`);
  } else {
    if (weakSc.proceed !== false) fail(`coach < 7 must have proceed=false, got ${weakSc.proceed}`);
    if (!weakSc.text || typeof weakSc.text !== 'string') fail('coach < 7 must have non-empty text');
    if (!weakSc.next_round_inputs) fail('coach < 7 must have next_round_inputs for the loop');
    const nri = weakSc.next_round_inputs;
    for (const k of ['original_prompt', 'original_dimensions', 'previous_dimensions', 'round']) {
      if (nri[k] === undefined) fail(`coach next_round_inputs missing ${k}: ${JSON.stringify(nri)}`);
    }
    console.log(`coach OK: weak prompt → ${weakSc.overall}/10, proceed=false, round→${nri.round}`);
  }

  // 9. coach (mode='score') on a strong prompt — must score >= 7 with proceed=true and empty text.
  const strongRes = await send('tools/call', {
    name: 'coach',
    arguments: {
      prompt:
        'In src/api/webhooks/handler.ts, refactor the retry loop in handleWebhook() to use exponential backoff with jitter (max 5 attempts, base 200ms). Must remain idempotent and not change the public API. Return only the modified function with no explanation.',
      file_path: 'src/api/webhooks/handler.ts',
    },
  });
  if (strongRes.result?.isError) fail(`coach (strong) error: ${JSON.stringify(strongRes.result)}`);
  const strongSc = strongRes.result?.structuredContent;
  if (!strongSc) fail('coach (strong) missing structuredContent');
  if (strongSc.overall < 7) {
    console.warn(`WARN: strong prompt scored ${strongSc.overall}/10 — Gemini variance.`);
  } else {
    if (strongSc.proceed !== true) fail(`coach (strong) >= 7 must have proceed=true, got ${strongSc.proceed}`);
    // Round-1 silent fast path: text MUST be empty when score >= 7.
    if (strongSc.text && strongSc.text.length > 0) {
      fail(`coach (strong) >= 7 round 1 must have empty text, got: ${strongSc.text.slice(0, 80)}`);
    }
    console.log(`coach OK: strong prompt → ${strongSc.overall}/10, silent fast path`);
  }

  // 10. coach (mode='skip_reveal') — round-trip the weak prompt with the user
  // dismissing coaching. Must return proceed=true with a reveal block.
  const skipRes = await send('tools/call', {
    name: 'coach',
    arguments: {
      prompt: 'fix the retry',
      mode: 'skip_reveal',
      original_prompt: 'fix the retry',
      original_dimensions: weakSc.dimensions,
    },
  });
  if (skipRes.result?.isError) fail(`coach (skip_reveal) error: ${JSON.stringify(skipRes.result)}`);
  const skipSc = skipRes.result?.structuredContent;
  if (skipSc?.mode !== 'skip_reveal') fail(`coach mode should be 'skip_reveal', got ${skipSc?.mode}`);
  if (skipSc?.proceed !== true) fail(`coach (skip_reveal) must have proceed=true, got ${skipSc?.proceed}`);
  console.log(`coach skip_reveal OK: proceed=true, ${skipSc.text.length} chars of reveal text`);

  // 11. wiki_lookup with file_path — should return rules + learnings.
  const lookupRes = await send('tools/call', {
    name: 'wiki_lookup',
    arguments: { file_path: 'src/api/webhooks/handler.ts' },
  });
  if (lookupRes.result?.isError) fail(`wiki_lookup (file_path) error: ${JSON.stringify(lookupRes.result)}`);
  console.log(`wiki_lookup OK: ${(lookupRes.result?.content?.[0]?.text ?? '').slice(0, 60)}…`);

  // 12. wiki_lookup with no args — must return an isError.
  const lookupBadRes = await send('tools/call', {
    name: 'wiki_lookup',
    arguments: {},
  });
  if (!lookupBadRes.result?.isError) {
    fail(`wiki_lookup with no args should error, got: ${JSON.stringify(lookupBadRes.result)}`);
  }
  console.log('wiki_lookup validation OK (rejected empty args)');

  // 13. wiki_bootstrap with explicit mode='minimal' — idempotent against the
  // seeded demo team. paths_submitted should equal what we sent. We use
  // minimal so the smoke test stays fast and free; rich mode is exercised
  // separately by hand. Spec ref: 2026-04-26-wiki-bootstrap-rich-design.md
  const bootstrapRes = await send('tools/call', {
    name: 'wiki_bootstrap',
    arguments: {
      paths: ['src/api/', 'src/api/webhooks/', 'src/db/'],
      seed_from_files: false,
      mode: 'minimal',
    },
  });
  if (bootstrapRes.result?.isError) {
    fail(`wiki_bootstrap error: ${JSON.stringify(bootstrapRes.result)}`);
  }
  const bootSc = bootstrapRes.result?.structuredContent;
  if (!bootSc) fail('wiki_bootstrap missing structuredContent');
  if (bootSc.mode !== 'minimal') fail(`wiki_bootstrap mode should be 'minimal', got ${bootSc.mode}`);
  if (typeof bootSc.nodes_created !== 'number') fail('wiki_bootstrap missing nodes_created');
  if (typeof bootSc.nodes_total !== 'number') fail('wiki_bootstrap missing nodes_total');
  if (!Array.isArray(bootSc.paths_submitted) || bootSc.paths_submitted.length !== 3) {
    fail(`wiki_bootstrap paths_submitted shape: ${JSON.stringify(bootSc.paths_submitted)}`);
  }
  console.log(
    `wiki_bootstrap OK: ${bootSc.nodes_created} new, ${bootSc.nodes_total - bootSc.nodes_created} existed`,
  );

  console.log('\nALL CHECKS PASSED');
  child.kill();
  process.exit(0);
})().catch((e) => {
  console.error('test runner error:', e);
  child.kill();
  process.exit(1);
});
