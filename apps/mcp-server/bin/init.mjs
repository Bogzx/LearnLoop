// `trailhead-mcp init` — idempotent installer.
//
// Writes two files (creating dirs as needed):
// 1. ~/.claude.json (Claude Code) — adds `mcpServers.trailhead` entry
//    pointing at our server with TRAILHEAD_API_URL + TRAILHEAD_TEAM_TOKEN env.
// 2. ~/.claude/settings.json — adds a `Stop` hook command pointing at
//    apps/stop-hook/trailhead-hook.mjs.
//
// Idempotency rules:
// - If `mcpServers.trailhead` already exists, it's overwritten with our
//   current paths (so re-running after `git pull` updates them).
// - If a Stop hook entry containing "trailhead-hook.mjs" already exists, we
//   leave the Stop section alone (the user may have customized it).
// - All other keys preserved exactly.
//
// Logic is split out from cli.mjs so we can unit-test it on temp dirs.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// InitOptions = { serverEntry, hookEntry, apiUrl, teamToken, anthropicKey,
//                 home?, preservePaths? }
// InitResult  = { claudeJsonPath, settingsJsonPath,
//                 serverInstalled: 'created' | 'updated' | 'unchanged',
//                 hookInstalled:  'created' | 'unchanged' }

// Read JSON safely; return {} on missing file or parse failure.
function readJsonOr(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    const raw = readFileSync(path, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function normalize(p) {
  return resolve(p).replace(/\\/g, '/');
}

export async function runInit(opts) {
  const result = await applyInit(opts);
  // CLI reporting — kept here so tests can call applyInit silently.
  console.log(`✓ MCP server registered (${result.serverInstalled}): ${result.claudeJsonPath}`);
  console.log(`✓ Stop hook registered (${result.hookInstalled}):    ${result.settingsJsonPath}`);
  console.log('\nTrailhead is registered. Restart Claude Code to pick up the changes.');
  return result;
}

export async function applyInit(opts) {
  const home = opts.home ?? homedir();
  const claudeJsonPath = join(home, '.claude.json');
  const settingsJsonPath = join(home, '.claude', 'settings.json');
  const serverEntry = opts.preservePaths ? opts.serverEntry : normalize(opts.serverEntry);
  const hookEntry = opts.preservePaths ? opts.hookEntry : normalize(opts.hookEntry);

  // 1) MCP server entry in ~/.claude.json
  const claudeJson = readJsonOr(claudeJsonPath, {});
  if (!claudeJson || typeof claudeJson !== 'object' || Array.isArray(claudeJson)) {
    throw new Error(`~/.claude.json is not a JSON object`);
  }
  const mcpServers = claudeJson.mcpServers && typeof claudeJson.mcpServers === 'object'
    ? claudeJson.mcpServers
    : {};
  const existed = Boolean(mcpServers.trailhead);
  const env = {
    TRAILHEAD_API_URL: opts.apiUrl,
    TRAILHEAD_TEAM_TOKEN: opts.teamToken,
  };
  if (opts.anthropicKey) env.ANTHROPIC_API_KEY = opts.anthropicKey;

  const entry = {
    command: 'npx',
    args: ['--yes', 'tsx', serverEntry],
    env,
  };
  // Only count as "unchanged" if the entire entry deep-equals the existing one.
  const before = mcpServers.trailhead;
  const newClaudeJson = { ...claudeJson, mcpServers: { ...mcpServers, trailhead: entry } };
  const serverInstalled = !existed
    ? 'created'
    : JSON.stringify(before) === JSON.stringify(entry)
      ? 'unchanged'
      : 'updated';
  if (serverInstalled !== 'unchanged') writeJson(claudeJsonPath, newClaudeJson);

  // 2) Stop hook in ~/.claude/settings.json
  const settings = readJsonOr(settingsJsonPath, {});
  if (settings && typeof settings !== 'object') {
    throw new Error('~/.claude/settings.json is not a JSON object');
  }
  const hooks = (settings.hooks && typeof settings.hooks === 'object') ? settings.hooks : {};
  const stopBlocks = Array.isArray(hooks.Stop) ? hooks.Stop : [];

  const ourCommand = `node "${hookEntry}"`;
  // We consider the hook "already installed" if any registered Stop command
  // references our hook entry (by exact path or by its basename — the latter
  // catches the case where the user installed via a relative path or symlink).
  const hookBasename = hookEntry.split(/[/\\]/).filter(Boolean).pop() ?? '';
  const alreadyHasOurHook = stopBlocks.some((block) => {
    if (!block?.hooks) return false;
    return block.hooks.some((h) => {
      if (typeof h?.command !== 'string') return false;
      if (h.command.includes(hookEntry)) return true;
      // Only match by basename if it's a recognizable hook script (not generic
      // names like "hook.mjs" — must contain "trailhead" to be considered ours).
      if (hookBasename && hookBasename.includes('trailhead')) {
        return h.command.includes(hookBasename);
      }
      return false;
    });
  });

  let hookInstalled = 'unchanged';
  if (!alreadyHasOurHook) {
    const newBlock = {
      hooks: [{ type: 'command', command: ourCommand }],
    };
    const newSettings = {
      ...settings,
      hooks: { ...hooks, Stop: [...stopBlocks, newBlock] },
    };
    writeJson(settingsJsonPath, newSettings);
    hookInstalled = 'created';
  }

  return {
    claudeJsonPath,
    settingsJsonPath,
    serverInstalled,
    hookInstalled,
  };
}
