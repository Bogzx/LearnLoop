// Team credentials — pure helpers (no DB, no env), so they can be unit-tested.
//
// Model (since 2026-09-30):
//
//   - teams.token is the team's *id*. It is not a secret: for repos it is
//     `team_` + a hash of the normalised git remote URL, so teammates can find
//     "their" team, and it is safe to print, log and put in URLs.
//   - The credential is a random secret minted by the server
//     (`trailhead_sk_…`, 192 bits). Only its SHA-256 is stored, in
//     teams.secret_hash. Clients send the secret as X-Team-Token.
//   - Legacy teams (created before this model) have secret_hash NULL and are
//     authenticated by their id, which used to double as the credential. That
//     path is behind TRAILHEAD_ACCEPT_LEGACY_TOKENS and closes for a team the
//     moment it gets a secret (POST /teams/rotate-secret).
//
// Plain SHA-256 (no salt, no KDF) is deliberate: the secrets are 192 random
// bits, so there is nothing to brute-force, and an unsalted digest is what
// lets auth be a single indexed lookup.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SECRET_PREFIX = 'trailhead_sk_';

export function mintSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(24).toString('base64url')}`;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

// Team ids are printed, logged and used as a DB key, so keep them boring:
// 3-100 chars of [A-Za-z0-9_.-], starting with an alphanumeric.
const TEAM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,99}$/;

export function isValidTeamId(id: unknown): id is string {
  return typeof id === 'string' && TEAM_ID_RE.test(id);
}

export function randomTeamId(): string {
  return `team_local_${randomBytes(8).toString('hex')}`;
}

// Constant-time string comparison for the optional operator admin token.
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
