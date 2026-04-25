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
