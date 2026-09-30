// CLI entry point for `trailhead-mcp reset`. Wipes ALL wiki data for the
// current team. Confirmation prompt unless --yes is passed.
//
// Credential resolution mirrors bootstrap-cli — the repo's ./.trailhead-team
// (written by `init`) so running `trailhead-mcp reset` from inside a repo
// nukes that repo's team, not the demo's. Pass --team-token <t> to override. Pass --api-url <url> to point
// at a non-default API (e.g., localhost during dev).
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ApiClient } from './api-client.ts';
import { maskSecret, resolveCliCredential } from './token.mjs';
import { resolveApiUrl } from './api-url.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const candidate of ['../../../.env', '../../.env', '.env']) {
  const p = resolve(__dirname, candidate);
  if (existsSync(p)) {
    try { process.loadEnvFile(p); } catch {}
    break;
  }
}

const args = process.argv.slice(2);
const flags = new Set<string>(args.filter((a) => a.startsWith('--') && !a.includes('=')));
const flagValues = new Map<string, string>();
for (const a of args) {
  if (a.startsWith('--') && a.includes('=')) {
    const [k, v] = a.split('=', 2);
    flagValues.set(k!, v ?? '');
  }
}
for (let i = 0; i < args.length - 1; i++) {
  const a = args[i]!;
  const next = args[i + 1]!;
  if (a.startsWith('--') && !a.includes('=') && !next.startsWith('--')) {
    flagValues.set(a, next);
  }
}

if (flags.has('--help') || flags.has('-h')) {
  console.log(`trailhead-mcp reset — wipe ALL wiki data for the current team

Usage:
  trailhead-mcp reset [--yes] [--team-token <t>] [--api-url <url>]

The team secret comes from TRAILHEAD_TEAM_TOKEN / TRAILHEAD_TEAM_FILE /
./.trailhead-team (written by \`init\`) unless
overridden. Without --yes, prompts before sending the request.

Wipes: nodes, learnings, prompts, captures, skill_observations.
Preserves: the teams row itself (so re-running the same token continues to
land in the same team).
`);
  process.exit(0);
}

const cwd = process.cwd();
const explicitToken = flagValues.get('--team-token');
const found = explicitToken
  ? { token: explicitToken, source: 'flag' as const, remoteUrl: undefined as string | undefined }
  : resolveCliCredential(cwd);
if (!found) {
  console.error(
    '✗ No team secret for this repo (checked --team-token, TRAILHEAD_TEAM_TOKEN, TRAILHEAD_TEAM_FILE, ./.trailhead-team).\n' +
      '  Run `init` here first (node <LearnLoop>/apps/mcp-server/bin/cli.mjs init) to register or join a team.',
  );
  process.exit(1);
}
const tokenInfo = found;
if (tokenInfo.source === 'legacy-remote') {
  console.warn(
    '! Using the LEGACY remote-derived token for this repo (deprecated: anyone who knows the git URL can compute it).\n' +
      '  Run `init --upgrade-legacy` to switch this team to a secret.',
  );
}
const apiUrl = resolveApiUrl(flagValues.get('--api-url'));

console.log(`API: ${apiUrl}`);
console.log(`Secret: ${maskSecret(tokenInfo.token)}`);
console.log(`Source: ${tokenInfo.source}`);
console.log('');
console.log(
  '⚠ This will DELETE every wiki node, learning, graduated prompt, capture,\n' +
    '  and skill observation for the team identified by the token above.\n' +
    '  The team row itself is preserved, so re-running with the same token\n' +
    '  lands in the same id.\n',
);

if (!flags.has('--yes')) {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question('Type "wipe" to confirm: ')).trim();
  rl.close();
  if (answer !== 'wipe') {
    console.log('Aborted.');
    process.exit(0);
  }
}

const client = new ApiClient({ apiUrl, teamToken: tokenInfo.token });
try {
  const res = await client.resetTeam();
  console.log('');
  console.log(`✓ Team ${res.team_token} wiped:`);
  console.log(`  nodes:        ${res.deleted.nodes}`);
  console.log(`  learnings:    ${res.deleted.learnings}`);
  console.log(`  prompts:      ${res.deleted.prompts}`);
  console.log(`  captures:     ${res.deleted.captures}`);
  console.log(`  observations: ${res.deleted.observations}`);
} catch (e) {
  console.error(`! Reset failed: ${(e as Error).message}`);
  process.exit(1);
}
