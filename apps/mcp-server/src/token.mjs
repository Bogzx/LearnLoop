// Token derivation for the multi-tenant API. Keeps each repo's data isolated
// without forcing the user to manage tokens manually.
//
// Resolution order (deriveRepoToken):
//   1. TRAILHEAD_TEAM_TOKEN env var       (caller already chose a token)
//   2. .trailhead-team sentinel in cwd    (sticky, machine-local)
//   3. `git remote get-url origin`        (deterministic per shared repo)
//   4. random token + write sentinel      (machine-local, persisted, gitignored)
//
// Derivation from the git remote URL means everyone on the same repo gets
// the same team token without coordination. The sentinel fallback keeps
// repos-without-remotes (scratch projects, pre-publication work) working
// without polluting another team's data — at the cost that team members
// can't share unless they share the token explicitly.

import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

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

// Stable token from a remote URL. SHA-256 → first 16 hex chars is enough to
// avoid collisions at any sane team scale; `repo_` prefix keeps the value
// recognizable in DB rows.
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
