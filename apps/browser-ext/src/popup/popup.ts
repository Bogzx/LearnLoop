// Popup script. Shows a coaching on/off switch, an "Add wiki context"
// placeholder, and a Select-team dropdown that fetches GET /teams and
// persists the selection to chrome.storage.local. The content script
// subscribes to that storage key and uses the selected team's token
// for every subsequent X-Team-Token header.

import { API_URL } from '../config.ts';
import { TEAM_TOKEN_KEY } from '../team-state.ts';
import { TEAM_TOKEN as DEFAULT_TEAM_TOKEN } from '../config.ts';
import type { TeamSummary, TeamsListResponse } from '@trailhead/shared';

const COACHING_KEY = 'trailhead.coachingEnabled';

const switchEl = document.getElementById('coaching-switch') as HTMLDivElement;
const addCtxBtn = document.getElementById('add-context-btn') as HTMLButtonElement;
const selectTeamBtn = document.getElementById('select-team-btn') as HTMLButtonElement;
const currentTeamNameEl = document.getElementById('current-team-name') as HTMLSpanElement;
const teamDropdownEl = document.getElementById('team-dropdown') as HTMLDivElement;
const teamStatusEl = document.getElementById('team-status') as HTMLDivElement;
const teamListEl = document.getElementById('team-list') as HTMLUListElement;
const hintEl = document.getElementById('coaching-hint') as HTMLDivElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;

let cachedTeams: TeamSummary[] | null = null;

function render(enabled: boolean): void {
  switchEl.classList.toggle('is-on', enabled);
  switchEl.setAttribute('aria-checked', String(enabled));
  hintEl.textContent = enabled
    ? 'When off, the extension stops intercepting sends.'
    : 'Coaching is off — Claude.ai sends behave as if the extension weren’t installed.';
}

async function getStoredToken(): Promise<string> {
  return new Promise((resolve) => {
    (chrome as any).storage.local.get(TEAM_TOKEN_KEY, (v: Record<string, unknown>) => {
      const stored = v[TEAM_TOKEN_KEY];
      resolve(typeof stored === 'string' && stored ? stored : DEFAULT_TEAM_TOKEN);
    });
  });
}

async function setStoredToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    (chrome as any).storage.local.set({ [TEAM_TOKEN_KEY]: token }, () => resolve());
  });
}

async function refreshCurrentTeamName(): Promise<void> {
  const token = await getStoredToken();
  // If we don't have a teams list yet, just show a truncated token.
  const team = cachedTeams?.find((t) => t.token === token);
  currentTeamNameEl.textContent = team
    ? team.name
    : token === DEFAULT_TEAM_TOKEN ? 'Acme (default)' : token.slice(0, 16) + '…';
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
      cachedTeams && renderTeamList(cachedTeams, team.token);
      await refreshCurrentTeamName();
      closeDropdown();
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

function closeDropdown(): void {
  teamDropdownEl.hidden = true;
  selectTeamBtn.setAttribute('aria-expanded', 'false');
}

async function openDropdown(): Promise<void> {
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
  // Show the current team name in the button row even before the user
  // opens the dropdown.
  await refreshCurrentTeamName();
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

addCtxBtn.addEventListener('click', () => {
  // Placeholder for the wiki-context flow. Wired so the UX is complete;
  // the actual context selection is the next iteration.
  showToast('Wiki context — coming soon.');
});

selectTeamBtn.addEventListener('click', () => {
  if (teamDropdownEl.hidden) {
    void openDropdown();
  } else {
    closeDropdown();
  }
});

// Click outside the dropdown closes it.
document.addEventListener('click', (e) => {
  if (teamDropdownEl.hidden) return;
  const target = e.target as Node | null;
  if (!target) return;
  if (teamDropdownEl.contains(target) || selectTeamBtn.contains(target)) return;
  closeDropdown();
});
