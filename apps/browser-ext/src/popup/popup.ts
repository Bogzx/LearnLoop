// Popup script. Surfaces four controls:
//   - Coaching on/off switch
//   - API server — the base URL of the self-hosted Trailhead API. Trailhead
//     ships no hosted backend, so this is required config; it defaults to
//     http://localhost:3000 (what `docker compose up` publishes) and is
//     persisted to chrome.storage.local.<API_URL_KEY>. The content script
//     watches that key, so a change lands on open tabs without a reload.
//   - Select context — fetches GET /wiki/tree and lets the user pick a
//     subtree root; persisted to chrome.storage.local.<CONTEXT_PATH_KEY>
//     so the content script prepends the rendered subtree to every send.
//   - Select team — takes the team token and persists it to
//     chrome.storage.local.<TEAM_TOKEN_KEY>, then resolves the team's display
//     name via the authenticated GET /teams.
//
// That last control used to be a dropdown listing every team on the server,
// built from an unauthenticated GET /teams that returned each team's token.
// Clicking a row adopted another tenant's credential, and merely opening the
// popup fetched all of them. The endpoint now authenticates and returns only
// the caller's own team, without a token, so switching teams means supplying
// the token for a team you are actually entitled to.
//
// The context picker caches its first fetch in popup memory so re-opening the
// dropdown is instant. A team change implicitly invalidates the wiki tree
// (different team → different nodes), so cachedTree is dropped on token
// change.

import { API_URL_KEY, DEFAULT_API_URL } from '../config.ts';
import { normalizeApiUrl } from '../api-url-state.ts';
import { TEAM_TOKEN_KEY, TEAM_NAME_KEY } from '../team-state.ts';
import { CONTEXT_PATH_KEY } from '../context-state.ts';
import { TEAM_TOKEN as DEFAULT_TEAM_TOKEN } from '../config.ts';
import type {
  TeamsListResponse,
  WikiTreeNode,
  WikiTreeResponse,
} from '@trailhead/shared';

const COACHING_KEY = 'trailhead.coachingEnabled';

const switchEl = document.getElementById('coaching-switch') as HTMLDivElement;
const addCtxBtn = document.getElementById('add-context-btn') as HTMLButtonElement;
const selectTeamBtn = document.getElementById('select-team-btn') as HTMLButtonElement;
const currentTeamNameEl = document.getElementById('current-team-name') as HTMLSpanElement;
const teamDropdownEl = document.getElementById('team-dropdown') as HTMLDivElement;
const teamStatusEl = document.getElementById('team-status') as HTMLDivElement;
const teamListEl = document.getElementById('team-list') as HTMLUListElement;
const currentContextNameEl = document.getElementById('current-context-name') as HTMLSpanElement;
const contextDropdownEl = document.getElementById('context-dropdown') as HTMLDivElement;
const contextStatusEl = document.getElementById('context-status') as HTMLDivElement;
const contextTreeEl = document.getElementById('context-tree') as HTMLUListElement;
const hintEl = document.getElementById('coaching-hint') as HTMLDivElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;
const apiUrlInputEl = document.getElementById('api-url-input') as HTMLInputElement;
const apiUrlSaveEl = document.getElementById('api-url-save') as HTMLButtonElement;
const apiUrlStatusEl = document.getElementById('api-url-status') as HTMLDivElement;

// Resolved API base URL for this popup session (no trailing slash). Seeded
// from storage when the popup opens; the Save button rewrites both this and
// storage. Every fetch below reads it rather than a build-time constant.
let apiUrl = DEFAULT_API_URL;

let cachedTree: WikiTreeNode[] | null = null;
// Tree cache is keyed by the team token under which it was fetched. A team
// switch must drop the tree (different wiki) — we compare against this on
// every openContextDropdown to know whether to refetch.
let cachedTreeForToken: string | null = null;

function render(enabled: boolean): void {
  switchEl.classList.toggle('is-on', enabled);
  switchEl.setAttribute('aria-checked', String(enabled));
  hintEl.textContent = enabled
    ? 'Weak prompts open a quick coaching panel before they send.'
    : 'Prompts send straight to Claude with no coaching.';
}

async function getStoredToken(): Promise<string> {
  return new Promise((resolve) => {
    (chrome as any).storage.local.get(TEAM_TOKEN_KEY, (v: Record<string, unknown>) => {
      const stored = v[TEAM_TOKEN_KEY];
      resolve(typeof stored === 'string' && stored ? stored : DEFAULT_TEAM_TOKEN);
    });
  });
}

// True only if the user has explicitly picked a team in the popup. The
// fallback (DEFAULT_TEAM_TOKEN from config.ts) doesn't count — a team
// must have been actively selected.
async function hasSelectedTeam(): Promise<boolean> {
  return new Promise((resolve) => {
    (chrome as any).storage.local.get(TEAM_TOKEN_KEY, (v: Record<string, unknown>) => {
      const stored = v[TEAM_TOKEN_KEY];
      resolve(typeof stored === 'string' && stored.length > 0);
    });
  });
}

async function setStoredToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    (chrome as any).storage.local.set({ [TEAM_TOKEN_KEY]: token }, () => resolve());
  });
}

async function setStoredTeamName(name: string): Promise<void> {
  return new Promise((resolve) => {
    (chrome as any).storage.local.set({ [TEAM_NAME_KEY]: name }, () => resolve());
  });
}

async function getStoredTeamName(): Promise<string | null> {
  return new Promise((resolve) => {
    (chrome as any).storage.local.get(TEAM_NAME_KEY, (v: Record<string, unknown>) => {
      const stored = v[TEAM_NAME_KEY];
      resolve(typeof stored === 'string' && stored ? stored : null);
    });
  });
}

// ----- API server ------------------------------------------------------------

async function getStoredApiUrl(): Promise<string> {
  return new Promise((resolve) => {
    (chrome as any).storage.local.get(API_URL_KEY, (v: Record<string, unknown>) => {
      resolve(normalizeApiUrl(v?.[API_URL_KEY]));
    });
  });
}

async function setStoredApiUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    (chrome as any).storage.local.set({ [API_URL_KEY]: url }, () => resolve());
  });
}

function setApiStatus(text: string, kind: 'neutral' | 'ok' | 'error' = 'neutral'): void {
  apiUrlStatusEl.textContent = text;
  apiUrlStatusEl.classList.toggle('is-error', kind === 'error');
  apiUrlStatusEl.classList.toggle('is-ok', kind === 'ok');
}

// The manifest ships host_permissions for localhost / 127.0.0.1 only. Pointing
// the extension at a remote self-hosted API needs that origin granted, which
// MV3 exposes through optional_host_permissions. Requested from the Save click
// because chrome.permissions.request requires a user gesture. Returns true when
// we either hold the permission or can't tell — we let the fetch be the judge
// rather than blocking the user on a guess.
async function ensureHostPermission(url: string): Promise<boolean> {
  try {
    const perms = (chrome as any)?.permissions;
    if (!perms?.request || !perms?.contains) return true;
    const origin = `${new URL(url).origin}/*`;
    const has = await new Promise<boolean>((resolve) => {
      perms.contains({ origins: [origin] }, (r: boolean) => resolve(Boolean(r)));
    });
    if (has) return true;
    return await new Promise<boolean>((resolve) => {
      perms.request({ origins: [origin] }, (granted: boolean) => resolve(Boolean(granted)));
    });
  } catch {
    return true;
  }
}

// Cheap reachability probe against a no-auth endpoint. Turns "nothing works and
// I don't know why" into a one-line diagnosis naming the fix.
async function probeApi(): Promise<void> {
  setApiStatus(`Checking ${apiUrl}…`);
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), 4000);
  try {
    // GET / is the API's unauthenticated status endpoint. (This used to probe
    // /teams, which only worked because /teams required no auth — the very
    // thing that leaked every tenant's token.)
    const res = await fetch(`${apiUrl}/`, { signal: ac.signal });
    if (!res.ok) {
      setApiStatus(`${apiUrl} responded HTTP ${res.status}.`, 'error');
      return;
    }
    setApiStatus(`Connected to ${apiUrl}`, 'ok');
  } catch {
    setApiStatus(
      apiUrl === DEFAULT_API_URL
        ? `No API at ${apiUrl}. Trailhead is self-hosted — run \`docker compose up\` (see SELFHOSTING.md), or enter your server's URL above.`
        : `Can't reach ${apiUrl}. Check the server is running, or correct the URL above.`,
      'error',
    );
  } finally {
    window.clearTimeout(timer);
  }
}

async function saveApiUrl(): Promise<void> {
  const next = normalizeApiUrl(apiUrlInputEl.value);
  if (!next) {
    setApiStatus('Enter a full base URL, e.g. http://localhost:3000', 'error');
    return;
  }
  apiUrlSaveEl.disabled = true;
  try {
    const granted = await ensureHostPermission(next);
    if (!granted) {
      setApiStatus(`Permission for ${next} denied — the extension can't call it.`, 'error');
      return;
    }
    await setStoredApiUrl(next);
    apiUrl = next;
    apiUrlInputEl.value = next;
    // A different server means a different team and a different wiki.
    cachedTree = null;
    cachedTreeForToken = null;
    showToast('API server saved');
    await probeApi();
  } finally {
    apiUrlSaveEl.disabled = false;
  }
}

async function getStoredContextPath(): Promise<string | null> {
  return new Promise((resolve) => {
    (chrome as any).storage.local.get(CONTEXT_PATH_KEY, (v: Record<string, unknown>) => {
      const stored = v[CONTEXT_PATH_KEY];
      resolve(typeof stored === 'string' && stored ? stored : null);
    });
  });
}

async function setStoredContextPath(path: string): Promise<void> {
  return new Promise((resolve) => {
    (chrome as any).storage.local.set({ [CONTEXT_PATH_KEY]: path }, () => resolve());
  });
}

async function clearStoredContextPath(): Promise<void> {
  return new Promise((resolve) => {
    (chrome as any).storage.local.remove(CONTEXT_PATH_KEY, () => resolve());
  });
}

/**
 * Ask the API which team the stored token belongs to.
 *
 * GET /teams is authenticated and returns only the caller's own team. It used
 * to be unauthenticated and return every team on the server *with its token*,
 * which is what let this popup show a pick-a-team list — and also handed every
 * tenant's credential to anyone who asked. Resolving your own team from the
 * token you already hold is the same convenience without the giveaway.
 */
async function resolveTeamName(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiUrl}/teams`, { headers: { 'X-Team-Token': token } });
    if (!res.ok) return null;
    const data = (await res.json()) as TeamsListResponse;
    return data.teams?.[0]?.name ?? null;
  } catch {
    return null;
  }
}

async function refreshCurrentTeamName(): Promise<void> {
  const token = await getStoredToken();
  const cached = await getStoredTeamName();
  currentTeamNameEl.textContent =
    cached ?? (token === DEFAULT_TEAM_TOKEN ? 'Acme (default)' : token.slice(0, 16) + '…');

  const name = await resolveTeamName(token);
  if (name) {
    await setStoredTeamName(name);
    currentTeamNameEl.textContent = name;
  }
}

async function refreshCurrentContextName(): Promise<void> {
  const path = await getStoredContextPath();
  currentContextNameEl.textContent = displayPath(path);
}

/**
 * Team switcher.
 *
 * This was a list of every team on the server, each row carrying that team's
 * token, populated from an unauthenticated GET /teams. Clicking a row adopted
 * someone else's credential. The endpoint no longer discloses tokens, so
 * switching teams means entering the token for the team you are entitled to —
 * which is what "switching teams" should always have meant.
 */
async function applyTeamToken(next: string): Promise<void> {
  const token = next.trim();
  if (!token) {
    showTeamError('Enter a team token.');
    return;
  }
  const current = await getStoredToken();
  teamStatusEl.hidden = false;
  teamStatusEl.classList.remove('is-error');
  teamStatusEl.textContent = 'Checking token…';

  const name = await resolveTeamName(token);
  if (!name) {
    showTeamError(`${apiUrl} rejected that token, or is unreachable.`);
    return;
  }

  await setStoredToken(token);
  // Persist the display name alongside the token so the in-page pill can show
  // "Acme Fintech · Root" instead of just "Root".
  await setStoredTeamName(name);
  // A different team invalidates the wiki tree cache and any active context
  // (the path may not exist for the new team).
  if (token !== current) {
    cachedTree = null;
    cachedTreeForToken = null;
    const oldPath = await getStoredContextPath();
    if (oldPath) {
      await clearStoredContextPath();
      await refreshCurrentContextName();
    }
  }
  await refreshCurrentTeamName();
  closeTeamDropdown();
  showToast(`Switched to ${name}`);
}

async function renderTeamEditor(): Promise<void> {
  teamListEl.replaceChildren();

  const li = document.createElement('li');
  li.className = 'team-editor';

  const label = document.createElement('label');
  label.textContent = 'Team token';
  label.htmlFor = 'team-token-input';
  li.appendChild(label);

  const input = document.createElement('input');
  input.id = 'team-token-input';
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = 'e.g. repo_9d01… or trailhead_demo_acme_2026';
  input.value = await getStoredToken();
  li.appendChild(input);

  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Use this team';
  save.addEventListener('click', () => void applyTeamToken(input.value));
  li.appendChild(save);

  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      void applyTeamToken(input.value);
    }
  });

  const hint = document.createElement('p');
  hint.className = 'team-hint';
  hint.textContent =
    'Your token is your team’s credential. `trailhead-mcp init` derives one per repo and writes it into your MCP config.';
  li.appendChild(hint);

  teamListEl.appendChild(li);
  teamListEl.hidden = false;
  teamStatusEl.hidden = true;
}

function showTeamError(msg: string): void {
  teamStatusEl.textContent = msg;
  teamStatusEl.classList.add('is-error');
  teamStatusEl.hidden = false;
  teamListEl.hidden = true;
}

function closeTeamDropdown(): void {
  teamDropdownEl.hidden = true;
  selectTeamBtn.setAttribute('aria-expanded', 'false');
}

async function openTeamDropdown(): Promise<void> {
  teamDropdownEl.hidden = false;
  selectTeamBtn.setAttribute('aria-expanded', 'true');
  await renderTeamEditor();
}

// ----- Wiki context picker ---------------------------------------------------

function pathDepth(path: string): number {
  // Folder paths end in '/', file paths don't. We count the segments and
  // subtract 1 so a top-level node ('src/' or 'README.md') sits at depth 0.
  const segments = path.split('/').filter((s) => s.length > 0);
  return Math.max(0, segments.length - 1);
}

function lastSegment(path: string): string {
  const stripped = path.endsWith('/') ? path.slice(0, -1) : path;
  const i = stripped.lastIndexOf('/');
  return i === -1 ? stripped : stripped.slice(i + 1);
}

// Display name for a tree node. Root nodes (path '/' or '' or anything that
// reduces to an empty last segment) render as "Root" instead of a blank
// label — the previous behaviour left the row visually empty next to the
// folder icon.
function displayName(path: string): string {
  const seg = lastSegment(path);
  if (seg) return seg;
  return 'Root';
}

// Translate a wiki-tree node path into the value we persist to chrome.storage.
// The root node has path = '' which clashes with the truthy-check used by
// getStoredContextPath / context-state.ts to mean "no context selected".
// We persist root as '/' so those callers see a non-empty string and treat
// it as an active context. context-bundle.ts and team-context.ts translate
// '/' back to '' when filtering the subtree, so the filter still matches
// every node under root.
const ROOT_SENTINEL = '/';
function pathForStorage(path: string): string {
  return path === '' ? ROOT_SENTINEL : path;
}
// Render either the bare path or the friendly "Root" label for the root
// sentinel — used in the popup's "Active: …" row, the toast, and the
// header label next to the Select-context button.
function displayPath(path: string | null): string {
  if (!path) return '';
  if (path === ROOT_SENTINEL) return 'Root';
  return path;
}

function renderContextTree(nodes: WikiTreeNode[], currentPath: string | null): void {
  contextTreeEl.replaceChildren();

  // A "Clear context" row at the top — only visible when something is
  // currently active. Lets the user reset without leaving the popup.
  if (currentPath) {
    const clearLi = document.createElement('li');
    clearLi.className = 'tree-li';
    clearLi.style.justifyContent = 'space-between';
    const lbl = document.createElement('span');
    lbl.style.opacity = '0.7';
    lbl.style.fontSize = '11px';
    lbl.textContent = `Active: ${displayPath(currentPath)}`;
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'clear-ctx-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await clearStoredContextPath();
      await refreshCurrentContextName();
      if (cachedTree) renderContextTree(cachedTree, null);
      showToast('Context cleared');
    });
    clearLi.appendChild(lbl);
    clearLi.appendChild(clearBtn);
    contextTreeEl.appendChild(clearLi);
  }

  // Sort by path so parents come before children — string-prefix order
  // lines up with the depth-indent visualization.
  const sorted = [...nodes].sort((a, b) => a.path.localeCompare(b.path));
  for (const node of sorted) {
    const li = document.createElement('li');
    li.classList.add('tree-li');
    const isFolder = node.path.endsWith('/');
    if (isFolder) li.classList.add('is-folder');
    const depth = pathDepth(node.path);
    li.style.paddingLeft = `${6 + depth * 12}px`;
    li.title = node.path;
    // Compare on the STORED form so the root node ('') matches the
    // sentinel value ('/') we persisted earlier.
    if (pathForStorage(node.path) === currentPath) {
      li.classList.add('is-current');
      const check = document.createElement('span');
      check.className = 'check';
      check.textContent = '✓';
      li.appendChild(check);
    }
    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = isFolder ? '📁' : '📄';
    li.appendChild(icon);
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = displayName(node.path);
    li.appendChild(label);
    li.addEventListener('click', async () => {
      const stored = pathForStorage(node.path);
      await setStoredContextPath(stored);
      cachedTree && renderContextTree(cachedTree, stored);
      await refreshCurrentContextName();
      closeContextDropdown();
      showToast(`Context set: ${displayName(node.path)}`);
    });
    contextTreeEl.appendChild(li);
  }
  contextTreeEl.hidden = false;
  contextStatusEl.hidden = true;
}

function showContextLoading(): void {
  contextStatusEl.textContent = 'Loading wiki…';
  contextStatusEl.classList.remove('is-error');
  contextStatusEl.hidden = false;
  contextTreeEl.hidden = true;
}

function showContextError(msg: string): void {
  contextStatusEl.textContent = msg;
  contextStatusEl.classList.add('is-error');
  contextStatusEl.hidden = false;
  contextTreeEl.hidden = true;
}

function closeContextDropdown(): void {
  contextDropdownEl.hidden = true;
  addCtxBtn.setAttribute('aria-expanded', 'false');
}

async function openContextDropdown(): Promise<void> {
  contextDropdownEl.hidden = false;
  addCtxBtn.setAttribute('aria-expanded', 'true');

  const token = await getStoredToken();
  // Drop the cache if we're now scoped to a different team.
  if (cachedTreeForToken && cachedTreeForToken !== token) {
    cachedTree = null;
    cachedTreeForToken = null;
  }
  if (cachedTree) {
    renderContextTree(cachedTree, await getStoredContextPath());
    return;
  }
  showContextLoading();
  try {
    const res = await fetch(`${apiUrl}/wiki/tree`, {
      headers: { 'X-Team-Token': token },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as WikiTreeResponse;
    if (!Array.isArray(data.nodes) || data.nodes.length === 0) {
      showContextError('No wiki nodes for this team yet.');
      return;
    }
    cachedTree = data.nodes;
    cachedTreeForToken = token;
    renderContextTree(cachedTree, await getStoredContextPath());
  } catch (err) {
    console.warn('[trailhead-popup] /wiki/tree fetch failed', err);
    showContextError(`Couldn’t reach ${apiUrl}. Check the API server below.`);
    void probeApi();
  }
}

function showToast(text: string, ms = 1600): void {
  toastEl.textContent = text;
  toastEl.classList.add('is-shown');
  window.setTimeout(() => toastEl.classList.remove('is-shown'), ms);
}

(async () => {
  try {
    const out = await new Promise<Record<string, unknown>>((resolve) => {
      (chrome as any).storage.local.get(COACHING_KEY, (v: Record<string, unknown>) => resolve(v));
    });
    render(out[COACHING_KEY] !== false);
  } catch {
    render(true);
  }
  // Resolve the API server first — the team/context fetches below depend on
  // it, and the user must be able to SEE which server they're pointed at.
  try {
    const stored = await getStoredApiUrl();
    apiUrl = stored || DEFAULT_API_URL;
    apiUrlInputEl.value = apiUrl;
    if (!stored) {
      setApiStatus(`Using the default ${DEFAULT_API_URL} — no server configured yet.`);
    }
  } catch {
    apiUrlInputEl.value = apiUrl;
  }
  void probeApi();
  // Show the current team + context in the button rows even before the
  // user opens either dropdown.
  await refreshCurrentTeamName();
  await refreshCurrentContextName();
})();

apiUrlSaveEl.addEventListener('click', () => {
  void saveApiUrl();
});

apiUrlInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void saveApiUrl();
  }
});

switchEl.addEventListener('click', async () => {
  try {
    const out = await new Promise<Record<string, unknown>>((resolve) => {
      (chrome as any).storage.local.get(COACHING_KEY, (v: Record<string, unknown>) => resolve(v));
    });
    const current = out[COACHING_KEY] !== false;
    const next = !current;
    await new Promise<void>((resolve) => {
      (chrome as any).storage.local.set({ [COACHING_KEY]: next }, () => resolve());
    });
    render(next);
  } catch (err) {
    console.warn('[trailhead-popup] toggle failed', err);
  }
});

switchEl.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    switchEl.click();
  }
});

addCtxBtn.addEventListener('click', async () => {
  // Wiki context is scoped to a team — require an explicit team
  // selection before letting the user proceed. If none is picked yet,
  // warn and pop the team dropdown so the next click can land.
  if (!(await hasSelectedTeam())) {
    showToast('Pick a team first — choose one below.', 2400);
    void openTeamDropdown();
    return;
  }
  if (contextDropdownEl.hidden) {
    void openContextDropdown();
  } else {
    closeContextDropdown();
  }
});

selectTeamBtn.addEventListener('click', () => {
  if (teamDropdownEl.hidden) {
    void openTeamDropdown();
  } else {
    closeTeamDropdown();
  }
});

// Click outside any dropdown closes it.
document.addEventListener('click', (e) => {
  const target = e.target as Node | null;
  if (!target) return;
  if (!teamDropdownEl.hidden) {
    if (!teamDropdownEl.contains(target) && !selectTeamBtn.contains(target)) {
      closeTeamDropdown();
    }
  }
  if (!contextDropdownEl.hidden) {
    if (!contextDropdownEl.contains(target) && !addCtxBtn.contains(target)) {
      closeContextDropdown();
    }
  }
});
