// `trailhead-mcp init` — idempotent installer for Claude Code AND Copilot.
//
// Writes per-repo MCP config so each repo can use its own team token —
// "auto-switch the wiki for the repo I'm in." Specifically:
//
//   - Claude Code:  ./.mcp.json (project-scoped) — always written.
//                   ~/.claude.json (user-scoped) only when it already
//                   contains a trailhead entry, or --user-scope is set.
//   - Copilot:      .vscode/mcp.json (workspace-scoped) — always written.
//                   .github/copilot-instructions.md (the inlined directive)
//
// The directive itself is canonical at apps/mcp-server/src/coaching-directive.md
// (also exposed as the MCP resource trailhead://coaching-directive). Init
// reads that file and writes it verbatim into the *.md files. Re-running
// init replaces the directive section in place.
//
// Token: callers pass it explicitly (CLI flag) or via auto-derivation
// (cli.mjs uses src/token.mjs::deriveRepoToken before calling init). init
// itself stays agnostic.
//
// Spec ref: docs/superpowers/specs/2026-04-25-mcp-plugin-ux-design.md §5
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Canonical directive — same file the MCP server exposes as a resource. Read
// once at module load. Tests can override by passing opts.directiveText.
const DEFAULT_DIRECTIVE_PATH = resolve(__dirname, '..', 'src', 'coaching-directive.md');
export const COACH_DIRECTIVE = existsSync(DEFAULT_DIRECTIVE_PATH)
  ? readFileSync(DEFAULT_DIRECTIVE_PATH, 'utf8')
  : '';

// The heading anchor used for idempotent section replacement. Any change to
// coaching-directive.md must keep `## Trailhead coaching` as its first
// non-empty line.
const COACH_DIRECTIVE_HEADING = '## Trailhead coaching';

// ---------- helpers ---------------------------------------------------------

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

// Idempotent section write/replace.
//
// - If the file doesn't exist: create it with just the directive.
// - If the file exists but doesn't contain the heading: append.
// - If the file exists and contains the heading: replace from the heading
//   to the next H2 (or end of file) with the new directive.
//
// Returns 'created' | 'appended' | 'replaced' | 'unchanged'.
function applyDirective(filePath, directiveText) {
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, directiveText, 'utf8');
    return 'created';
  }
  const current = readFileSync(filePath, 'utf8');
  const headingIdx = current.indexOf(COACH_DIRECTIVE_HEADING);
  if (headingIdx === -1) {
    const sep = current.endsWith('\n\n')
      ? ''
      : current.endsWith('\n')
        ? '\n'
        : '\n\n';
    writeFileSync(filePath, `${current}${sep}${directiveText}`, 'utf8');
    return 'appended';
  }
  const headingLineStart = current.lastIndexOf('\n', headingIdx) + 1;
  const searchFrom = headingLineStart + COACH_DIRECTIVE_HEADING.length;
  const nextH2Match = current.slice(searchFrom).match(/\n## /);
  const sectionEnd = nextH2Match
    ? searchFrom + nextH2Match.index + 1
    : current.length;

  const before = current.slice(0, headingLineStart);
  const after = current.slice(sectionEnd);
  const directive = directiveText.endsWith('\n') ? directiveText : `${directiveText}\n`;
  const updated = `${before}${directive}${after}`;
  if (updated === current) return 'unchanged';
  writeFileSync(filePath, updated, 'utf8');
  return 'replaced';
}

// Backwards-compat shim — older code paths expect 'unchanged' (not 'replaced')
// when the new content is byte-identical to the old.
function applyDirectiveCompat(filePath, directiveText) {
  const before = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
  const result = applyDirective(filePath, directiveText);
  if (result === 'replaced') {
    const after = readFileSync(filePath, 'utf8');
    if (before === after) return 'unchanged';
  }
  return result;
}

// MCP-server config entry shared between Claude Code (.mcp.json,
// ~/.claude.json) and the project-scoped form.
function buildClaudeServerEntry({ entryServer, apiUrl, teamToken }) {
  return {
    command: 'npx',
    args: ['--yes', 'tsx', entryServer],
    env: {
      TRAILHEAD_API_URL: apiUrl,
      TRAILHEAD_TEAM_TOKEN: teamToken,
    },
  };
}

// Idempotent upsert of the trailhead server entry into a Claude-Code-style
// JSON file ({ mcpServers: { trailhead: {...} } }). Returns 'created' |
// 'updated' | 'unchanged'.
function upsertClaudeMcpJson(jsonPath, entry) {
  const existing = readJsonOr(jsonPath, {});
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    throw new Error(`${jsonPath} is not a JSON object`);
  }
  const mcpServers =
    existing.mcpServers && typeof existing.mcpServers === 'object'
      ? existing.mcpServers
      : {};
  const before = mcpServers.trailhead;
  const status = !before
    ? 'created'
    : JSON.stringify(before) === JSON.stringify(entry)
      ? 'unchanged'
      : 'updated';
  if (status !== 'unchanged') {
    writeJson(jsonPath, {
      ...existing,
      mcpServers: { ...mcpServers, trailhead: entry },
    });
  }
  return status;
}

// ---------- detection -------------------------------------------------------

function detectClaudeCode(home, cwd) {
  // We always write project-scoped .mcp.json (in cwd), so Claude Code is
  // considered "wired" whenever we're going to run init at all. The function
  // is kept for symmetry with detectCopilot and for the explicit-disable
  // path in applyInit.
  void home;
  void cwd;
  return true;
}

function detectCopilot(cwd) {
  if (existsSync(join(cwd, '.vscode'))) return true;
  if (process.env.VSCODE_PID || process.env.TERM_PROGRAM === 'vscode') return true;
  const pathDirs = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
  for (const d of pathDirs) {
    if (!d) continue;
    if (process.platform === 'win32') {
      if (existsSync(join(d, 'code.exe')) || existsSync(join(d, 'code.cmd'))) return true;
    } else if (existsSync(join(d, 'code'))) {
      return true;
    }
  }
  return false;
}

function looksLikeProjectRoot(cwd) {
  return existsSync(join(cwd, 'package.json')) || existsSync(join(cwd, '.git'));
}

// True when ~/.claude.json already has a trailhead entry, indicating an
// existing legacy install we should keep in sync.
function hasExistingTrailheadUserScope(home) {
  const claudeJson = readJsonOr(join(home, '.claude.json'), null);
  return Boolean(
    claudeJson &&
      typeof claudeJson === 'object' &&
      !Array.isArray(claudeJson) &&
      claudeJson.mcpServers &&
      typeof claudeJson.mcpServers === 'object' &&
      claudeJson.mcpServers.trailhead,
  );
}

// ---------- Claude Code wiring ---------------------------------------------

function wireClaudeCode({
  home,
  apiUrl,
  teamToken,
  serverEntry,
  autoCoach,
  cwd,
  userScope,
  directiveText,
  preservePaths,
}) {
  const entryServer = preservePaths ? serverEntry : normalize(serverEntry);
  const entry = buildClaudeServerEntry({ entryServer, apiUrl, teamToken });

  // (1) Project-scoped .mcp.json — always.
  const projectMcpJsonPath = join(cwd, '.mcp.json');
  const projectMcpInstalled = upsertClaudeMcpJson(projectMcpJsonPath, entry);

  // (2) User-scoped ~/.claude.json — conditionally per Q2 (c).
  // Write only if the file already has a trailhead entry (legacy install we
  // need to keep in sync) OR userScope was explicitly requested.
  const claudeJsonPath = join(home, '.claude.json');
  let userServerInstalled = 'skipped';
  if (userScope || hasExistingTrailheadUserScope(home)) {
    userServerInstalled = upsertClaudeMcpJson(claudeJsonPath, entry);
  }

  // (3) Coach directive — project-scoped CLAUDE.md by default; optionally
  // also user-global ~/.claude/CLAUDE.md when userScope.
  let projectClaudeMdPath = null;
  let projectCoachInstalled = 'skipped';
  let userClaudeMdPath = null;
  let userCoachInstalled = 'skipped';

  if (autoCoach) {
    projectClaudeMdPath = join(cwd, 'CLAUDE.md');
    projectCoachInstalled = applyDirectiveCompat(projectClaudeMdPath, directiveText);
    if (userScope) {
      userClaudeMdPath = join(home, '.claude', 'CLAUDE.md');
      userCoachInstalled = applyDirectiveCompat(userClaudeMdPath, directiveText);
    }
  }

  return {
    projectMcpJsonPath,
    projectMcpInstalled,
    claudeJsonPath: userServerInstalled === 'skipped' ? null : claudeJsonPath,
    userServerInstalled,
    // Back-compat: older callers expect these names mirroring Claude Code's
    // user-scope state. With multi-tenant the project-scope path is the
    // primary, so serverInstalled now reflects the project write.
    serverInstalled: projectMcpInstalled,
    projectClaudeMdPath,
    projectCoachInstalled,
    userClaudeMdPath,
    userCoachInstalled,
  };
}

// ---------- Copilot wiring -------------------------------------------------

function wireCopilot({
  cwd,
  apiUrl,
  teamToken,
  serverEntry,
  autoCoach,
  directiveText,
  preservePaths,
}) {
  const entryServer = preservePaths ? serverEntry : normalize(serverEntry);
  const mcpJsonPath = join(cwd, '.vscode', 'mcp.json');

  // VS Code's MCP config shape uses `servers` with `type: 'stdio'`. Reference:
  // https://code.visualstudio.com/docs/copilot/copilot-mcp
  const existing = readJsonOr(mcpJsonPath, null);
  const existingServers =
    existing && typeof existing === 'object' && !Array.isArray(existing) && existing.servers && typeof existing.servers === 'object'
      ? existing.servers
      : {};

  const entry = {
    type: 'stdio',
    command: 'npx',
    args: ['--yes', 'tsx', entryServer],
    env: {
      TRAILHEAD_API_URL: apiUrl,
      TRAILHEAD_TEAM_TOKEN: teamToken,
    },
  };

  const before = existingServers.trailhead;
  const newMcpJson = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    servers: { ...existingServers, trailhead: entry },
  };
  const mcpJsonInstalled = !before
    ? 'created'
    : JSON.stringify(before) === JSON.stringify(entry)
      ? 'unchanged'
      : 'updated';
  if (mcpJsonInstalled !== 'unchanged') writeJson(mcpJsonPath, newMcpJson);

  let instructionsPath = null;
  let instructionsInstalled = 'skipped';
  if (autoCoach) {
    instructionsPath = join(cwd, '.github', 'copilot-instructions.md');
    instructionsInstalled = applyDirectiveCompat(instructionsPath, directiveText);
  }

  return {
    mcpJsonPath,
    mcpJsonInstalled,
    instructionsPath,
    instructionsInstalled,
  };
}

// ---------- public surface --------------------------------------------------

// InitOptions:
//   serverEntry       absolute path to apps/mcp-server/src/index.ts
//   apiUrl            TRAILHEAD_API_URL value
//   teamToken         TRAILHEAD_TEAM_TOKEN value
//   home?             override homedir() (test hook)
//   cwd?              override process.cwd() (test hook)
//   autoCoach?        default true
//   userScope?        default false — when true, also write ~/.claude.json +
//                     ~/.claude/CLAUDE.md
//   wireClaudeCode?   default true — set false to skip Claude Code wiring entirely
//   wireCopilot?      default true — set false to skip Copilot wiring entirely
//   directiveText?    default: contents of src/coaching-directive.md
//   preservePaths?    test hook — keep serverEntry verbatim
//
// Result:
//   { claudeCode: { wired: bool, ... }, copilot: { wired: bool, ... },
//     plus a flat backwards-compat slice for older tests }
export async function applyInit(opts) {
  const home = opts.home ?? homedir();
  const cwd = opts.cwd ?? process.cwd();
  const autoCoach = opts.autoCoach !== false;
  const userScope = opts.userScope === true;
  const wantClaudeCode = opts.wireClaudeCode !== false;
  const wantCopilot = opts.wireCopilot !== false;
  const directiveText = opts.directiveText ?? COACH_DIRECTIVE;

  if (!directiveText && autoCoach) {
    throw new Error(
      'coaching-directive.md is missing or empty. Run from the repo or pass opts.directiveText.',
    );
  }

  const claudeWired = wantClaudeCode && detectClaudeCode(home, cwd);
  const copilotWired = wantCopilot && detectCopilot(cwd);

  let claudeCode = null;
  if (claudeWired) {
    claudeCode = wireClaudeCode({
      home,
      apiUrl: opts.apiUrl,
      teamToken: opts.teamToken,
      serverEntry: opts.serverEntry,
      autoCoach,
      cwd,
      userScope,
      directiveText,
      preservePaths: opts.preservePaths,
    });
  }

  let copilot = null;
  if (copilotWired) {
    copilot = wireCopilot({
      cwd,
      apiUrl: opts.apiUrl,
      teamToken: opts.teamToken,
      serverEntry: opts.serverEntry,
      autoCoach,
      directiveText,
      preservePaths: opts.preservePaths,
    });
  }

  return {
    claudeCode: claudeCode ? { wired: true, ...claudeCode } : { wired: false },
    copilot: copilot ? { wired: true, ...copilot } : { wired: false },
    // Backwards-compat: older tests/log code reach for these top-level keys.
    // They reflect Claude Code's user-scope state.
    claudeJsonPath: claudeCode?.claudeJsonPath ?? null,
    serverInstalled: claudeCode?.serverInstalled ?? 'skipped',
    projectClaudeMdPath: claudeCode?.projectClaudeMdPath ?? null,
    projectCoachInstalled: claudeCode?.projectCoachInstalled ?? 'skipped',
    userClaudeMdPath: claudeCode?.userClaudeMdPath ?? null,
    userCoachInstalled: claudeCode?.userCoachInstalled ?? 'skipped',
  };
}

export async function runInit(opts) {
  const cwd = opts.cwd ?? process.cwd();

  if (!looksLikeProjectRoot(cwd)) {
    console.warn(
      `! cwd "${cwd}" doesn't look like a project root (no package.json or .git/).\n` +
        `  trailhead writes per-repo MCP config (.mcp.json / .vscode/mcp.json).\n` +
        `  Running init from the wrong directory will silently misconfigure the\n` +
        `  wrong project. Continuing anyway.\n`,
    );
  }

  const result = await applyInit(opts);

  if (result.claudeCode.wired) {
    console.log(
      `✓ Claude Code: project MCP config (${result.claudeCode.projectMcpInstalled}): ${result.claudeCode.projectMcpJsonPath}`,
    );
    if (result.claudeCode.userServerInstalled !== 'skipped') {
      console.log(
        `  ↳ User-scope (${result.claudeCode.userServerInstalled}): ${result.claudeCode.claudeJsonPath}`,
      );
    }
    if (result.claudeCode.projectClaudeMdPath) {
      console.log(
        `  ↳ Coach directive (${result.claudeCode.projectCoachInstalled}): ${result.claudeCode.projectClaudeMdPath}`,
      );
    } else if (result.claudeCode.projectCoachInstalled === 'skipped') {
      console.log('  ↳ Coach directive skipped (--no-auto-coach).');
    }
    if (result.claudeCode.userClaudeMdPath) {
      console.log(
        `  ↳ User-scope directive (${result.claudeCode.userCoachInstalled}): ${result.claudeCode.userClaudeMdPath}`,
      );
    }
  } else if (opts.wireClaudeCode === false) {
    console.log('· Claude Code skipped (--no-claude-code).');
  } else {
    console.log('· Claude Code not detected.');
  }

  if (result.copilot.wired) {
    console.log(
      `✓ Copilot: MCP server registered (${result.copilot.mcpJsonInstalled}): ${result.copilot.mcpJsonPath}`,
    );
    if (result.copilot.instructionsPath) {
      console.log(
        `  ↳ Coach directive (${result.copilot.instructionsInstalled}): ${result.copilot.instructionsPath}`,
      );
    } else if (result.copilot.instructionsInstalled === 'skipped') {
      console.log('  ↳ Coach directive skipped (--no-auto-coach).');
    }
  } else if (opts.wireCopilot === false) {
    console.log('· Copilot skipped (--no-copilot).');
  } else {
    console.log('· Copilot not detected.');
  }

  if (!result.claudeCode.wired && !result.copilot.wired) {
    console.log('');
    console.log(
      'Neither Claude Code nor Copilot detected. To wire manually, see\n' +
        'apps/mcp-server/README.md.',
    );
  } else {
    console.log('');
    console.log(`Token: ${opts.teamToken}`);
    console.log(
      'Coaching directive resource: trailhead://coaching-directive (auto-loaded by clients that support it).',
    );
    console.log('Restart Claude Code / VS Code to pick up the changes.');
  }

  return result;
}
