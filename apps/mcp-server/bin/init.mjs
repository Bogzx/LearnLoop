// `trailhead-mcp init` — idempotent installer.
//
// Writes up to three locations (creating dirs as needed):
// 1. ~/.claude.json (Claude Code) — adds `mcpServers.trailhead` entry
//    pointing at our server with TRAILHEAD_API_URL + TRAILHEAD_TEAM_TOKEN env.
// 2. ~/.claude/settings.json — adds a `Stop` hook command pointing at
//    apps/stop-hook/trailhead-hook.mjs.
// 3. ./CLAUDE.md (project-scoped, default) and/or ~/.claude/CLAUDE.md
//    (user-scoped, opt-in) — appends the always-on coaching directive
//    that drives spec §4 (B.2). Skipped entirely when autoCoach=false.
//
// Idempotency rules:
// - If `mcpServers.trailhead` already exists, it's overwritten with our
//   current paths (so re-running after `git pull` updates them).
// - If a Stop hook entry containing "trailhead-hook.mjs" already exists, we
//   leave the Stop section alone (the user may have customized it).
// - If a CLAUDE.md already contains a `## Trailhead coaching` heading, we
//   leave it alone (the user may have customized the directive).
// - All other keys / file content preserved exactly.
//
// Logic is split out from cli.mjs so we can unit-test it on temp dirs.
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Always-on coaching directive — appended to CLAUDE.md so the host LLM
// runs the coach loop on every code task. The exact wording is locked
// here so re-running init produces byte-identical output (idempotency).
// Spec ref: docs/superpowers/specs/2026-04-25-demo-completion-design.md §4.2
//
// IMPORTANT: any change here must keep the heading exactly
// `## Trailhead coaching` because the idempotency check matches on it.
export const COACH_DIRECTIVE = `## Trailhead coaching — always on, never block

For every code-related request the user makes:

1. Call \`coach_score\` (from the trailhead MCP server) on the user's
   request first. The tool returns per-dimension scores 0-10 plus a
   \`next_question\` field.
2. If overall ≥ 7, proceed normally. Do not mention coaching.
3. If overall < 7:
   a. Ask ONE focused clarifying question targeting the lowest-scoring
      dimension. Use the \`next_question\` value verbatim, or rephrase
      it lightly to fit the conversation.
   b. Wait for the user's reply, then re-score the merged prompt
      (original + answer) via \`coach_score\` again.
   c. Repeat up to 3 rounds OR until score ≥ 7, whichever comes first.
4. STOP coaching immediately if the user says "skip", "as-is", "just do
   it", "no questions", or similar — proceed with the current prompt.
5. After coaching, prefix your answer with "(coached: X→Y)" where X is
   the original overall score and Y is the final score, then answer.

Never block: dismissed coaching = proceed with the original prompt.
`;

const COACH_DIRECTIVE_HEADING = '## Trailhead coaching';

// InitOptions = { serverEntry, hookEntry, apiUrl, teamToken, anthropicKey,
//                 home?, cwd?, preservePaths?,
//                 autoCoach?: boolean (default true),
//                 userScope?: boolean (default false) }
// InitResult  = { claudeJsonPath, settingsJsonPath,
//                 serverInstalled: 'created' | 'updated' | 'unchanged',
//                 hookInstalled:  'created' | 'unchanged',
//                 projectClaudeMdPath: string | null,
//                 userClaudeMdPath:    string | null,
//                 projectCoachInstalled: 'created' | 'appended' | 'unchanged' | 'skipped',
//                 userCoachInstalled:    'created' | 'appended' | 'unchanged' | 'skipped' }

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

// Append the coach directive to a CLAUDE.md file if not already present.
// Returns 'created' (new file), 'appended' (existing file, directive added),
// or 'unchanged' (heading already exists).
function applyCoachDirective(claudeMdPath) {
  const existed = existsSync(claudeMdPath);
  if (existed) {
    const current = readFileSync(claudeMdPath, 'utf8');
    if (current.includes(COACH_DIRECTIVE_HEADING)) return 'unchanged';
    // Append. Ensure exactly one blank line between existing content and
    // our directive — readers don't care, but it keeps diffs clean.
    const sep = current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
    appendFileSync(claudeMdPath, `${sep}${COACH_DIRECTIVE}`, 'utf8');
    return 'appended';
  }
  mkdirSync(dirname(claudeMdPath), { recursive: true });
  writeFileSync(claudeMdPath, COACH_DIRECTIVE, 'utf8');
  return 'created';
}

export async function runInit(opts) {
  const result = await applyInit(opts);
  // CLI reporting — kept here so tests can call applyInit silently.
  console.log(`✓ MCP server registered (${result.serverInstalled}): ${result.claudeJsonPath}`);
  console.log(`✓ Stop hook registered (${result.hookInstalled}):    ${result.settingsJsonPath}`);
  if (result.projectClaudeMdPath) {
    console.log(`✓ Coach directive (${result.projectCoachInstalled}): ${result.projectClaudeMdPath}`);
  } else if (result.projectCoachInstalled === 'skipped') {
    console.log('· Coach directive skipped (--no-auto-coach).');
  }
  if (result.userClaudeMdPath) {
    console.log(`✓ Coach directive (${result.userCoachInstalled}): ${result.userClaudeMdPath}`);
  }
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

  // 3) Coach directive — appends to project-scoped CLAUDE.md (default) and
  // optionally also to ~/.claude/CLAUDE.md (user-scope opt-in). Skipped
  // entirely when autoCoach=false (the --no-auto-coach flag).
  const autoCoach = opts.autoCoach !== false;          // default: true
  const userScope = opts.userScope === true;           // default: false
  const cwd = opts.cwd ?? process.cwd();

  let projectClaudeMdPath = null;
  let projectCoachInstalled = 'skipped';
  let userClaudeMdPath = null;
  let userCoachInstalled = 'skipped';

  if (autoCoach) {
    projectClaudeMdPath = join(cwd, 'CLAUDE.md');
    projectCoachInstalled = applyCoachDirective(projectClaudeMdPath);

    if (userScope) {
      userClaudeMdPath = join(home, '.claude', 'CLAUDE.md');
      userCoachInstalled = applyCoachDirective(userClaudeMdPath);
    }
  }

  return {
    claudeJsonPath,
    settingsJsonPath,
    serverInstalled,
    hookInstalled,
    projectClaudeMdPath,
    userClaudeMdPath,
    projectCoachInstalled,
    userCoachInstalled,
  };
}
