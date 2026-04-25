// Single injected stylesheet. Every selector is id-namespaced under
// `#trailhead-score-card` or class-namespaced under `.trailhead-*` so the
// extension cannot bleed onto Claude.ai's own UI (spec §6.4).
//
// Color buckets: low (<4) red, med (4–6) yellow, high (≥7) green-no-highlight.
// "no-highlight" at high means the card itself loses its border so the
// power-user path is visually quiet (spec §6).
export const TRAILHEAD_STYLESHEET_ID = 'trailhead-injected-styles';

export const TRAILHEAD_CSS = `
#trailhead-score-card {
  margin: 8px auto 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.10);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  color: var(--text-primary, #ddd);
  max-width: 760px;
  box-sizing: border-box;
  transition: border-color 200ms ease-out, box-shadow 200ms ease-out;
}
#trailhead-score-card[data-bucket="low"]  { border-color: #d04a3a; }
#trailhead-score-card[data-bucket="med"]  { border-color: #d6a83c; }
#trailhead-score-card[data-bucket="high"] { border-color: rgba(255,255,255,0.06); }
#trailhead-score-card[hidden] { display: none; }

.trailhead-loading {
  font-size: 13px;
  opacity: 0.7;
  padding: 6px 0;
}
.trailhead-loading::after {
  content: '';
  display: inline-block;
  margin-left: 6px;
  width: 8px; height: 8px;
  border: 1.5px solid rgba(255,255,255,0.4);
  border-top-color: #4a6bff;
  border-radius: 50%;
  animation: trailhead-spin 700ms linear infinite;
  vertical-align: -1px;
}
@keyframes trailhead-spin {
  to { transform: rotate(360deg); }
}

.trailhead-sc-overall {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 6px;
}
.trailhead-sc-overall.is-low  { color: #ff8773; }
.trailhead-sc-overall.is-med  { color: #ffce6e; }
.trailhead-sc-overall.is-high { color: #74d18c; }

.trailhead-sc-rows { display: grid; gap: 2px; }

.trailhead-sc-row {
  display: grid;
  grid-template-columns: 16px 1fr 32px;
  gap: 8px;
  align-items: center;
  padding: 2px 0;
}
.trailhead-sc-icon { font-weight: 700; text-align: center; }
.trailhead-sc-icon.is-ok  { color: #74d18c; }
.trailhead-sc-icon.is-bad { color: #ff8773; }
.trailhead-sc-name  { opacity: 0.92; }
.trailhead-sc-score { text-align: right; opacity: 0.85; font-variant-numeric: tabular-nums; }
.trailhead-sc-hint  {
  grid-column: 2 / span 2;
  font-size: 11.5px;
  opacity: 0.75;
  margin: -2px 0 4px 0;
}

.trailhead-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.trailhead-actions button {
  cursor: pointer;
  font: inherit;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.04);
  color: inherit;
}
.trailhead-actions button:hover { background: rgba(255,255,255,0.10); }
.trailhead-actions button.is-primary {
  background: #4a6bff;
  border-color: #4a6bff;
  color: #fff;
}
.trailhead-actions button.is-primary:hover { background: #3a5be0; }

/* Widget A — score badge on user bubbles */
.trailhead-badge {
  display: inline-block;
  margin: 4px 6px 0 0;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid rgba(255,255,255,0.16);
  background: rgba(0,0,0,0.20);
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
}
.trailhead-badge.is-low  { color: #ff8773; border-color: #6e2a23; }
.trailhead-badge.is-med  { color: #ffce6e; border-color: #6a541d; }
.trailhead-badge.is-high { color: #74d18c; border-color: #2c5839; }
.trailhead-badge-tooltip {
  margin-top: 4px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(255,255,255,0.10);
}

/* Widget B — outcome rating chips */
.trailhead-outcome {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  font-size: 12px;
}
.trailhead-outcome-chip {
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.16);
  background: rgba(255,255,255,0.04);
  user-select: none;
}
.trailhead-outcome-chip:hover { background: rgba(255,255,255,0.10); }
.trailhead-outcome-recorded {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #2c5839;
  color: #d8f1de;
  font-size: 12px;
}

/* Widget C — prompt-diff link & inline panel */
.trailhead-diff-link {
  cursor: pointer;
  font-size: 11px;
  margin-left: 6px;
  opacity: 0.7;
  text-decoration: underline;
  user-select: none;
  display: inline-block;
}
.trailhead-diff-link:hover { opacity: 1; }
.trailhead-diff-panel {
  margin-top: 8px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.04);
  font-size: 12px;
}
.trailhead-diff-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 6px;
}
.trailhead-diff-col h4 {
  margin: 0 0 4px 0;
  font-size: 11px;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.trailhead-diff-prompt {
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(0,0,0,0.18);
  padding: 6px;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  font-size: 11.5px;
}
.trailhead-diff-narrative { margin-top: 8px; opacity: 0.85; }
.trailhead-diff-error {
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.7;
}

/* Widget D — wiki toasts. Mounted in a fixed-position container on
 * document.body (Option β, spec §9.3) so Claude.ai's React reconciliation
 * inside the conversation tree cannot tear them down. */
#trailhead-toast-stack {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483646;        /* below browser chrome, above everything else */
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;       /* clicks fall through gaps; toasts re-enable */
  max-width: 360px;
  width: max-content;
}
.trailhead-toast {
  pointer-events: auto;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(20, 22, 32, 0.92);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(74,107,255,0.45);
  box-shadow: 0 6px 20px rgba(0,0,0,0.35);
  font-size: 12.5px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #cfd8ff;
  cursor: pointer;
  user-select: none;
  animation: trailhead-toast-in 240ms ease-out;
}
.trailhead-toast.is-promoted {
  border-color: rgba(74,209,140,0.55);
  color: #d8f1de;
}
.trailhead-toast.is-leaving {
  animation: trailhead-toast-out 200ms ease-in forwards;
}
@keyframes trailhead-toast-in {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes trailhead-toast-out {
  from { opacity: 1; transform: translateX(0); }
  to   { opacity: 0; transform: translateX(8px); }
}

/* Improve chat widget — replaces the score-card body when the user
 * clicks Improve. Spec: 2026-04-26-improve-widget-design.md */
#trailhead-score-card[data-mode="improve"] {
  border-color: rgba(177, 185, 249, 0.4);
}
.trailhead-improve-header {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 8px;
  color: rgba(255,255,255,0.85);
}
.trailhead-improve-thread {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
  padding: 8px;
  background: rgba(0,0,0,0.18);
  border-radius: 6px;
  margin-bottom: 8px;
}
.trailhead-bubble {
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.4;
  white-space: pre-wrap;
  max-width: 86%;
}
.trailhead-bubble--assistant {
  background: rgba(177,185,249,0.10);
  align-self: flex-start;
}
.trailhead-bubble--user {
  background: rgba(74,107,255,0.18);
  align-self: flex-end;
}
.trailhead-bubble--pending { opacity: 0.55; font-style: italic; }
.trailhead-improve-input-row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 6px;
  align-items: stretch;
}
.trailhead-improve-input {
  resize: vertical;
  min-height: 36px;
  background: rgba(0,0,0,0.25);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 6px;
  color: inherit;
  font: inherit;
  padding: 6px 8px;
  box-sizing: border-box;
}
.trailhead-improve-input:disabled { opacity: 0.5; }
.trailhead-improve-input-row button,
.trailhead-improve-preview-actions button,
.trailhead-improve-error-actions button {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 6px;
  color: inherit;
  font: inherit;
  padding: 6px 12px;
  cursor: pointer;
}
.trailhead-improve-input-row button:hover:not(:disabled),
.trailhead-improve-preview-actions button:hover:not(:disabled),
.trailhead-improve-error-actions button:hover:not(:disabled) {
  background: rgba(255,255,255,0.10);
}
.trailhead-improve-input-row button.is-primary,
.trailhead-improve-preview-actions button.is-primary,
.trailhead-improve-error-actions button.is-primary {
  background: #4a6bff;
  border-color: #4a6bff;
  color: #fff;
}
.trailhead-improve-input-row button.is-primary:hover:not(:disabled),
.trailhead-improve-preview-actions button.is-primary:hover:not(:disabled),
.trailhead-improve-error-actions button.is-primary:hover:not(:disabled) {
  background: #3a5be0;
}
.trailhead-improve-input-row button:disabled,
.trailhead-improve-preview-actions button:disabled,
.trailhead-improve-error-actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.trailhead-improve-preview,
.trailhead-improve-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.trailhead-improve-preview-body {
  background: rgba(0,0,0,0.25);
  padding: 10px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  font: 12.5px/1.45 ui-monospace, "SF Mono", Menlo, monospace;
  max-height: 260px;
  overflow-y: auto;
  margin: 0;
}
.trailhead-improve-preview-actions,
.trailhead-improve-error-actions {
  display: flex;
  gap: 6px;
}
.trailhead-improve-error-msg {
  color: rgba(255,140,140,0.92);
  font-size: 12.5px;
}
`;

export function injectStyles(): void {
  if (document.getElementById(TRAILHEAD_STYLESHEET_ID)) return;
  const el = document.createElement('style');
  el.id = TRAILHEAD_STYLESHEET_ID;
  el.textContent = TRAILHEAD_CSS;
  document.head.appendChild(el);
}
