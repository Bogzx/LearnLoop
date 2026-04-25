// Popup script. Shows a coaching on/off switch and a (currently-placeholder)
// "Add wiki context" button. State lives in chrome.storage.local under
// 'trailhead.coachingEnabled'; the content script subscribes to changes
// and stops intercepting sends when this flips false.

const KEY = 'trailhead.coachingEnabled';

const switchEl = document.getElementById('coaching-switch') as HTMLDivElement;
const addCtxBtn = document.getElementById('add-context-btn') as HTMLButtonElement;
const hintEl = document.getElementById('coaching-hint') as HTMLDivElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;

function render(enabled: boolean): void {
  switchEl.classList.toggle('is-on', enabled);
  switchEl.setAttribute('aria-checked', String(enabled));
  hintEl.textContent = enabled
    ? 'When off, the extension stops intercepting sends.'
    : 'Coaching is off — Claude.ai sends behave as if the extension weren’t installed.';
}

function showToast(text: string, ms = 1600): void {
  toastEl.textContent = text;
  toastEl.classList.add('is-shown');
  window.setTimeout(() => toastEl.classList.remove('is-shown'), ms);
}

(async () => {
  try {
    const out = await new Promise<Record<string, unknown>>((resolve) => {
      (chrome as any).storage.local.get(KEY, (v: Record<string, unknown>) => resolve(v));
    });
    render(out[KEY] !== false);
  } catch {
    render(true);
  }
})();

switchEl.addEventListener('click', async () => {
  try {
    const out = await new Promise<Record<string, unknown>>((resolve) => {
      (chrome as any).storage.local.get(KEY, (v: Record<string, unknown>) => resolve(v));
    });
    const current = out[KEY] !== false;
    const next = !current;
    await new Promise<void>((resolve) => {
      (chrome as any).storage.local.set({ [KEY]: next }, () => resolve());
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
