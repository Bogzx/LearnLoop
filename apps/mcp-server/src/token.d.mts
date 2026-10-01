export const SENTINEL_FILENAME: string;

export function gitRemoteUrl(cwd: string): string | null;
export function tokenFromRemote(remoteUrl: string): string;
export function readSentinel(cwd: string): string | null;
export function writeSentinel(cwd: string, token: string): void;
export function ensureGitignore(cwd: string, line: string): boolean;
export function generateRandomToken(): string;

export type TokenSource = 'env' | 'sentinel' | 'remote' | 'sentinel-new';

export interface DerivedToken {
  token: string;
  source: TokenSource;
  remoteUrl?: string;
}

export function deriveRepoToken(cwd: string): DerivedToken;
export function deriveRepoName(cwd: string, remoteUrl?: string | null): string;

export function normalizeRemoteUrl(remoteUrl: string): string;
export function teamIdFromRemote(remoteUrl: string): string;
export function generateRandomTeamId(): string;
export function maskSecret(secret: string): string;

export interface Credential {
  token: string;
  source: 'env' | 'team-file' | 'sentinel' | 'legacy-remote';
  path?: string;
  remoteUrl?: string;
}
export function readCredential(opts?: { env?: Record<string, string | undefined>; cwd?: string }): Credential | null;
export function resolveCliCredential(cwd: string, env?: Record<string, string | undefined>): Credential | null;
export declare function findTeamFile(cwd: string, file: string): string | null;
