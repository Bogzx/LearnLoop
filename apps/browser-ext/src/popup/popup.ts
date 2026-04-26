// Popup script. Surfaces three controls:
//   - Coaching on/off switch
//   - Select context — fetches GET /wiki/tree and lets the user pick a
//     subtree root; persisted to chrome.storage.local.<CONTEXT_PATH_KEY>
//     so the content script prepends the rendered subtree to every send.
//   - Select team — fetches GET /teams and persists the chosen team's
//     X-Team-Token to chrome.storage.local.<TEAM_TOKEN_KEY>.
//
// Both pickers cache their first fetch in popup memory so re-opening the
// dropdown is instant. A team change implicitly invalidates the wiki tree
// (different team → different nodes), so cachedTree is dropped on token
// change.

import { API_URL } from '../config.ts';
import { TEAM_TOKEN_KEY, TEAM_NAME_KEY } from '../team-state.ts';
import { CONTEXT_PATH_KEY } from '../context-state.ts';
import { TEAM_TOKEN as DEFAULT_TEAM_TOKEN } from '../config.ts';
import type {
  TeamSummary,
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

let cachedTeams: TeamSummary[] | null = null;
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

async function refreshCurrentTeamName(): Promise<void> {
  const token = await getStoredToken();
  const team = cachedTeams?.find((t) => t.token === token);
  // Backfill the cached display name whenever the popup discovers it via
  // /teams — handles users who picked a team before this feature existed.
  if (team) await setStoredTeamName(team.name);
  currentTeamNameEl.textContent = team
    ? team.name
    : token === DEFAULT_TEAM_TOKEN ? 'Acme (default)' : token.slice(0, 16) + '…';
}

async function refreshCurrentContextName(): Promise<void> {
  const path = await getStoredContextPath();
  currentContextNameEl.textContent = displayPath(path);
}

function renderTeamList(teams: TeamSummary[], currentToken: string): void {
  teamListEl.replaceChildren();
  for (const team of teams) {
    const li = document.createElement('li');
    if (team.token === currentToken) {
      li.classList.add('is-current');
      const check = document.createElement('span');
      check.className = 'check';
      check.textContent = '✓';
      li.appendChild(check);
    }
    const name = document.createElement('span');
    name.textContent = team.name;
    li.appendChild(name);
    li.addEventListener('click', async () => {
      await setStoredToken(team.token);
      // Persist the team's display name alongside the token so the
      // in-page pill can show "Acme Fintech · Root" instead of just "Root".
      await setStoredTeamName(team.name);
      // Picking a different team invalidates the wiki tree cache and
      // any active context (the path may not exist for the new team).
      if (cachedTreeForToken !== team.token) {
        cachedTree = null;
        cachedTreeForToken = null;
      }
      const oldPath = await getStoredContextPath();
      if (oldPath) {
        await clearStoredContextPath();
        await refreshCurrentContextName();
      }
      cachedTeams && renderTeamList(cachedTeams, team.token);
      await refreshCurrentTeamName();
      closeTeamDropdown();
      showToast(`Switched to ${team.name}`);
    });
    teamListEl.appendChild(li);
  }
  teamListEl.hidden = false;
  teamStatusEl.hidden = true;
}

function showTeamLoading(): void {
  teamStatusEl.textContent = 'Loading teams…';
  teamStatusEl.classList.remove('is-error');
  teamStatusEl.hidden = false;
  teamListEl.hidden = true;
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
  if (cachedTeams) {
    renderTeamList(cachedTeams, await getStoredToken());
    return;
  }
  showTeamLoading();
  try {
    const res = await fetch(`${API_URL}/teams`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as TeamsListResponse;
    if (!Array.isArray(data.teams) || data.teams.length === 0) {
      showTeamError('No teams returned by the API.');
      return;
    }
    cachedTeams = data.teams;
    renderTeamList(cachedTeams, await getStoredToken());
  } catch (err) {
    console.warn('[trailhead-popup] /teams fetch failed', err);
    showTeamError('Couldn’t load teams. Check the API.');
  }
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
    const res = await fetch(`${API_URL}/wiki/tree`, {
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
    showContextError('Couldn’t load wiki. Check the API.');
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
  // Show the current team + context in the button rows even before the
  // user opens either dropdown.
  await refreshCurrentTeamName();
  await refreshCurrentContextName();
})();

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
