// Team credentials on the client side.
//
// Since 2026-09-30 a team has two things (see apps/api/src/team-auth.ts):
//
//   - a public TEAM ID. For a repo it is `team_` + sha256 of the NORMALISED
//     git remote URL, so every clone — https or ssh, with or without `.git` —
//     proposes the same id (teamIdFromRemote).
//   - a SECRET minted by the server when the team is registered
//     (POST /teams). It lives in the gitignored ./.trailhead-team sentinel and
//     is sent as X-Team-Token. It is never derived from anything.
//
// Legacy: before this, the credential WAS sha256(raw remote URL)
// (tokenFromRemote). The API still accepts such tokens for teams that have
// not been upgraded, behind TRAILHEAD_ACCEPT_LEGACY_TOKENS; `init` detects a
// legacy team and offers `--upgrade-legacy`.
//
// Runtime credential lookup (readCredential), used by the MCP server and the
// bootstrap/reset CLIs:
//   1. TRAILHEAD_TEAM_TOKEN env var        (explicit; also what pre-2026-09-30
//                                           generated MCP configs contain)
//   2. TRAILHEAD_TEAM_FILE env var          (path to a sentinel; what `init`
//                                           now writes into MCP configs, so the
//                                           secret stays out of .mcp.json). A
//                                           relative path (what `init` writes:
//                                           `.trailhead-team`) is looked for in
//                                           cwd, then in each parent up to the
//                                           git root, so the config is the same
//                                           on every machine
//   3. ./.trailhead-team in cwd

import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export const SENTINEL_FILENAME = '.trailhead-team';

// Safe wrapper around `git remote get-url origin`. Returns null on missing
// git, missing remote, or any non-zero exit. Two-second timeout so we never
// hang a parent CLI on a wedged git process.
export function gitRemoteUrl(cwd) {
  try {
    const out = execSync('git remote get-url origin', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
      encoding: 'utf8',
    });
    const url = String(out).trim();
    return url || null;
  } catch {
    return null;
  }
}

// LEGACY credential derivation — sha256 of the raw remote URL. Kept so `init`
// can find a pre-2026-09-30 team for this repo and offer to upgrade it; it is
// no longer used as a credential for new teams.
export function tokenFromRemote(remoteUrl) {
  const h = createHash('sha256').update(remoteUrl).digest('hex').slice(0, 16);
  return `repo_${h}`;
}

export function readSentinel(cwd) {
  const p = join(cwd, SENTINEL_FILENAME);
  if (!existsSync(p)) return null;
  const t = readFileSync(p, 'utf8').trim();
  return t || null;
}

export function writeSentinel(cwd, token) {
  const p = join(cwd, SENTINEL_FILENAME);
  writeFileSync(p, `${token}\n`, 'utf8');
  ensureGitignore(cwd, SENTINEL_FILENAME);
}

// Append a line to .gitignore unless already present. Idempotent. Used by
// writeSentinel so the random-token fallback never accidentally commits a
// machine-local secret.
export function ensureGitignore(cwd, line) {
  const giPath = join(cwd, '.gitignore');
  let current = '';
  if (existsSync(giPath)) {
    current = readFileSync(giPath, 'utf8');
    const lines = current.split(/\r?\n/);
    if (lines.includes(line) || lines.includes(`/${line}`)) return false;
  }
  const sep = current.length === 0 ? '' : current.endsWith('\n') ? '' : '\n';
  appendFileSync(giPath, `${sep}${line}\n`, 'utf8');
  return true;
}

// Collapse the ways one repo can be spelled into a single key:
//   https://github.com/Org/Repo.git, git@github.com:org/repo,
//   ssh://git@github.com:22/org/repo/, https://user:tok@GitHub.com/org/repo
//   → github.com/org/repo
// Scheme, userinfo, port, trailing slashes and `.git` are dropped and the
// result is lowercased (GitHub/GitLab/Bitbucket paths are case-insensitive;
// a host where they are not would merge repos differing only by case).
// Anything unrecognised (a local path, file://) is kept, lowercased, minus a
// trailing `.git` and slashes.
export function normalizeRemoteUrl(remoteUrl) {
  let s = String(remoteUrl).trim();
  let hostPath = null;
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
  if (scheme && scheme[1].toLowerCase() !== 'file') {
    let rest = scheme[2];
    const slash = rest.indexOf('/');
    let authority = slash === -1 ? rest : rest.slice(0, slash);
    const path = slash === -1 ? '' : rest.slice(slash);
    authority = authority.slice(authority.lastIndexOf('@') + 1); // userinfo
    authority = authority.replace(/:\d*$/, ''); // port
    // ssh://git@host:org/repo (scp path smuggled into a URL) — treat the
    // non-numeric "port" as the start of the path.
    const smuggled = authority.match(/^([^:]+):(.+)$/);
    hostPath = smuggled ? `${smuggled[1]}/${smuggled[2]}${path}` : `${authority}${path}`;
  } else if (!scheme) {
    // scp-like: [user@]host:path  (but not a Windows drive like C:\repo)
    const scp = s.match(/^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/);
    if (scp && scp[1].length > 1) hostPath = `${scp[1]}/${scp[2]}`;
  }
  let out = (hostPath ?? s.replace(/^file:\/\//i, '')).replace(/\\/g, '/');
  out = out.replace(/\/+/g, '/').replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return out.toLowerCase();
}

// Public team id for a repo. Not a secret — safe to print and share.
export function teamIdFromRemote(remoteUrl) {
  const h = createHash('sha256').update(normalizeRemoteUrl(remoteUrl)).digest('hex').slice(0, 16);
  return `team_${h}`;
}

export function generateRandomTeamId() {
  return `team_local_${randomBytes(8).toString('hex')}`;
}

// Show enough of a credential to tell two apart, never enough to use it.
export function maskSecret(secret) {
  const s = String(secret ?? '');
  if (s.length <= 12) return `${s.slice(0, 4)}…`;
  return `${s.slice(0, Math.min(16, s.length - 8))}…`;
}

// Runtime credential lookup — see the header comment for the order.
// Returns { token, source, path? } or null.
export function readCredential({ env = process.env, cwd = process.cwd() } = {}) {
  if (env.TRAILHEAD_TEAM_TOKEN) return { token: env.TRAILHEAD_TEAM_TOKEN, source: 'env' };
  if (env.TRAILHEAD_TEAM_FILE) {
    const p = findTeamFile(cwd, env.TRAILHEAD_TEAM_FILE);
    if (p) {
      const t = readFileSync(p, 'utf8').trim();
      if (t) return { token: t, source: 'team-file', path: p };
    }
  }
  const sentinel = readSentinel(cwd);
  if (sentinel) return { token: sentinel, source: 'sentinel', path: join(cwd, SENTINEL_FILENAME) };
  return null;
}

// An absolute TRAILHEAD_TEAM_FILE is used as is. A relative one is looked for
// in cwd, then in each parent directory, stopping at the first that holds
// .git (the repo root) — an MCP host may start the server in a subdirectory.
export function findTeamFile(cwd, file) {
  if (isAbsolute(file)) return existsSync(file) ? file : null;
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const p = join(dir, file);
    if (existsSync(p)) return p;
    if (existsSync(join(dir, '.git')) || dirname(dir) === dir) return null;
  }
}

// Credential for the bootstrap/reset CLIs: readCredential, then — for
// installs from before 2026-09-30 that never wrote a sentinel — the legacy
// remote-derived token, flagged so the caller can print a deprecation note.
export function resolveCliCredential(cwd, env = process.env) {
  const found = readCredential({ env, cwd });
  if (found) return found;
  const remote = gitRemoteUrl(cwd);
  if (remote) return { token: tokenFromRemote(remote), source: 'legacy-remote', remoteUrl: remote };
  return null;
}

export function generateRandomToken() {
  return `repo_local_${randomBytes(8).toString('hex')}`;
}

// Human-readable repo name for the team's display label. Pulled from the
// last path segment of the git remote URL (so `git@github.com:user/Polihack.git`
// becomes "Polihack"), falling back to the cwd's basename for repos with no
// remote. Used by bootstrap to set teams.name; the token stays a hash for
// uniqueness, but the displayed name reflects the repo.
export function deriveRepoName(cwd, remoteUrl) {
  if (remoteUrl) {
    let s = String(remoteUrl).trim().replace(/\/$/, '');
    if (s.endsWith('.git')) s = s.slice(0, -4);
    const lastSep = Math.max(s.lastIndexOf('/'), s.lastIndexOf(':'));
    if (lastSep >= 0 && lastSep < s.length - 1) {
      const tail = s.slice(lastSep + 1).trim();
      if (tail) return tail;
    }
  }
  return basename(resolve(cwd));
}

// DEPRECATED (pre-2026-09-30 behaviour, kept for external callers): derive a
// legacy credential. `init` now registers a team instead (bin/team-setup.mjs).
// Returns: { token, source, remoteUrl? }
//   source is 'env' | 'sentinel' | 'remote' | 'sentinel-new'
//   remoteUrl is set only when source === 'remote'
export function deriveRepoToken(cwd) {
  if (process.env.TRAILHEAD_TEAM_TOKEN) {
    return { token: process.env.TRAILHEAD_TEAM_TOKEN, source: 'env' };
  }
  const sentinel = readSentinel(cwd);
  if (sentinel) {
    return { token: sentinel, source: 'sentinel' };
  }
  const remote = gitRemoteUrl(cwd);
  if (remote) {
    return { token: tokenFromRemote(remote), source: 'remote', remoteUrl: remote };
  }
  const t = generateRandomToken();
  writeSentinel(cwd, t);
  return { token: t, source: 'sentinel-new' };
}
