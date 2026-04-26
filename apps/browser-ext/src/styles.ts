// Single injected stylesheet. Every selector is id-namespaced under
// `#trailhead-score-card` or class-namespaced under `.trailhead-*` so the
// extension cannot bleed onto Claude.ai's own UI (spec §6.4).
//
// Color buckets: low (<4) red, med (4–6) yellow, high (≥7) green-no-highlight.
// "no-highlight" at high means the card itself loses its border so the
// power-user path is visually quiet (spec §6).
export const TRAILHEAD_STYLESHEET_ID = 'trailhead-injected-styles';

export const TRAILHEAD_CSS = `
/* ============================================================
 * Design tokens — id-scoped so they don't leak into the host page.
 * Re-declared on every Trailhead surface that needs them.
 * ============================================================ */
#trailhead-score-card,
#trailhead-context-pill,
#trailhead-toast-stack {
  --th-accent: #6c8cff;
  --th-accent-strong: #4a6bff;
  --th-accent-bg: rgba(108,140,255,0.14);
  --th-accent-border: rgba(108,140,255,0.42);
  --th-good: #74d18c;
  --th-good-bg: rgba(116,209,140,0.16);
  --th-warn: #ffce6e;
  --th-warn-bg: rgba(255,206,110,0.14);
  --th-bad: #ff8773;
  --th-bad-bg: rgba(255,135,115,0.14);
  --th-surface-1: rgba(255,255,255,0.04);
  --th-surface-2: rgba(255,255,255,0.07);
  --th-surface-hover: rgba(255,255,255,0.10);
  --th-border: rgba(255,255,255,0.10);
  --th-border-strong: rgba(255,255,255,0.16);
  --th-text-faint: rgba(255,255,255,0.45);
  --th-text-muted: rgba(255,255,255,0.65);
  --th-radius-lg: 12px;
  --th-radius: 10px;
  --th-radius-sm: 6px;
  --th-radius-pill: 999px;
  --th-shadow-md: 0 6px 22px rgba(0,0,0,0.32);
  --th-ease: cubic-bezier(0.4, 0.0, 0.2, 1);
}

/* ============================================================
 * #trailhead-score-card — main inline panel below the composer.
 * ============================================================ */
#trailhead-score-card {
  margin: 10px auto 0;
  padding: 16px 18px;
  border-radius: var(--th-radius-lg);
  background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.025));
  border: 1px solid var(--th-border);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  color: var(--text-primary, #e5e7ee);
  max-width: 760px;
  box-sizing: border-box;
  box-shadow: var(--th-shadow-md);
  transition: border-color 200ms var(--th-ease), box-shadow 200ms var(--th-ease), transform 200ms var(--th-ease);
  animation: trailhead-card-in 220ms var(--th-ease);
}
#trailhead-score-card[data-bucket="low"]  {
  border-color: rgba(208,74,58,0.55);
  box-shadow: var(--th-shadow-md), inset 3px 0 0 0 #d04a3a;
}
#trailhead-score-card[data-bucket="med"]  {
  border-color: rgba(214,168,60,0.55);
  box-shadow: var(--th-shadow-md), inset 3px 0 0 0 #d6a83c;
}
#trailhead-score-card[data-bucket="high"] {
  border-color: rgba(255,255,255,0.06);
  box-shadow: 0 2px 10px rgba(0,0,0,0.18);
}
#trailhead-score-card[hidden] { display: none; }
/* Force hidden descendants to truly hide. Without this, author display
 * rules below (e.g. .trailhead-improve-thread sets display: flex) override
 * the UA hidden rule because they share specificity, and different
 * improve-chat stages would bleed into each other. */
#trailhead-score-card [hidden] { display: none !important; }
@keyframes trailhead-card-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Loading state */
.trailhead-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  opacity: 0.85;
  padding: 4px 0;
}
.trailhead-loading::after {
  content: '';
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.18);
  border-top-color: var(--th-accent);
  border-radius: 50%;
  animation: trailhead-spin 700ms linear infinite;
}
@keyframes trailhead-spin {
  to { transform: rotate(360deg); }
}

/* Overall score header — "Score 7/10" */
.trailhead-sc-overall {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 10px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px 8px;
  border-radius: var(--th-radius-pill);
  background: var(--th-surface-1);
  border: 1px solid var(--th-border);
  letter-spacing: 0.01em;
}
.trailhead-sc-overall::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--th-text-faint);
  flex: 0 0 auto;
}
.trailhead-sc-overall.is-low  { color: #ff8773; border-color: rgba(208,74,58,0.40); background: var(--th-bad-bg); }
.trailhead-sc-overall.is-low::before  { background: #ff8773; box-shadow: 0 0 0 3px var(--th-bad-bg); }
.trailhead-sc-overall.is-med  { color: #ffce6e; border-color: rgba(214,168,60,0.40); background: var(--th-warn-bg); }
.trailhead-sc-overall.is-med::before  { background: #ffce6e; box-shadow: 0 0 0 3px var(--th-warn-bg); }
.trailhead-sc-overall.is-high { color: #74d18c; border-color: rgba(116,209,140,0.40); background: var(--th-good-bg); }
.trailhead-sc-overall.is-high::before { background: #74d18c; box-shadow: 0 0 0 3px var(--th-good-bg); }

/* Dimension rows */
.trailhead-sc-rows {
  display: grid;
  gap: 6px;
  margin-bottom: 4px;
}

.trailhead-sc-row {
  display: grid;
  grid-template-columns: 22px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  border-radius: var(--th-radius-sm);
  background: var(--th-surface-1);
  border: 1px solid transparent;
  transition: background 120ms var(--th-ease), border-color 120ms var(--th-ease);
}
.trailhead-sc-row:hover { background: var(--th-surface-2); }
.trailhead-sc-row.is-low  { border-color: rgba(208,74,58,0.22); }
.trailhead-sc-row.is-med  { border-color: rgba(214,168,60,0.18); }

.trailhead-sc-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-weight: 700;
  font-size: 12px;
  line-height: 1;
}
.trailhead-sc-icon.is-ok  {
  color: #74d18c;
  background: var(--th-good-bg);
}
.trailhead-sc-icon.is-bad {
  color: #ff8773;
  background: var(--th-bad-bg);
}

.trailhead-sc-name {
  opacity: 0.94;
  text-transform: capitalize;
  font-weight: 500;
}

.trailhead-sc-score {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 22px;
  padding: 0 10px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 12.5px;
  line-height: 1;
  border-radius: var(--th-radius-pill);
  background: var(--th-surface-2);
  color: var(--th-text-muted);
  box-sizing: border-box;
}
.trailhead-sc-row.is-low  .trailhead-sc-score { color: #ff8773; background: var(--th-bad-bg); }
.trailhead-sc-row.is-med  .trailhead-sc-score { color: #ffce6e; background: var(--th-warn-bg); }
.trailhead-sc-row.is-high .trailhead-sc-score { color: #74d18c; background: var(--th-good-bg); }

.trailhead-sc-hint {
  grid-column: 1 / -1;
  font-size: 11.5px;
  opacity: 0.80;
  margin: 4px 0 8px 34px;
  padding-left: 10px;
  border-left: 2px solid var(--th-border-strong);
  line-height: 1.45;
}

/* Action buttons — Improve / Keep as-is / Edit */
.trailhead-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--th-border);
}
.trailhead-actions button {
  cursor: pointer;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  padding: 7px 14px;
  border-radius: var(--th-radius-sm);
  border: 1px solid var(--th-border-strong);
  background: var(--th-surface-1);
  color: inherit;
  transition: background 150ms var(--th-ease), border-color 150ms var(--th-ease), transform 80ms var(--th-ease);
}
.trailhead-actions button:hover {
  background: var(--th-surface-hover);
  border-color: rgba(255,255,255,0.22);
}
.trailhead-actions button:active { transform: translateY(1px); }
.trailhead-actions button:focus-visible {
  outline: none;
  border-color: var(--th-accent);
  box-shadow: 0 0 0 3px var(--th-accent-bg);
}
.trailhead-actions button.is-primary {
  background: linear-gradient(135deg, #6c8cff, #4a6bff);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 2px 8px rgba(74,107,255,0.30);
}
.trailhead-actions button.is-primary:hover {
  background: linear-gradient(135deg, #7c98ff, #5b78ff);
  box-shadow: 0 3px 12px rgba(74,107,255,0.40);
}

/* ============================================================
 * Widget A — score badge on user bubbles.
 * ============================================================ */
.trailhead-badge {
  display: inline-block;
  margin: 4px 6px 0 0;
  padding: 2px 9px;
  border-radius: var(--th-radius-pill);
  font-size: 11px;
  font-weight: 600;
  border: 1px solid rgba(255,255,255,0.16);
  background: rgba(0,0,0,0.25);
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
  transition: transform 120ms cubic-bezier(0.4,0,0.2,1), box-shadow 120ms cubic-bezier(0.4,0,0.2,1);
}
.trailhead-badge:hover { transform: translateY(-1px); }
.trailhead-badge.is-low  { color: #ff8773; border-color: rgba(208,74,58,0.45); background: rgba(208,74,58,0.10); box-shadow: 0 1px 6px rgba(208,74,58,0.20); }
.trailhead-badge.is-med  { color: #ffce6e; border-color: rgba(214,168,60,0.45); background: rgba(214,168,60,0.10); box-shadow: 0 1px 6px rgba(214,168,60,0.20); }
.trailhead-badge.is-high { color: #74d18c; border-color: rgba(116,209,140,0.45); background: rgba(116,209,140,0.10); box-shadow: 0 1px 6px rgba(116,209,140,0.20); }
.trailhead-badge-tooltip {
  margin-top: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(0,0,0,0.45);
  border: 1px solid rgba(255,255,255,0.12);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  font-size: 12px;
  line-height: 1.45;
}

/* ============================================================
 * Widget B — outcome rating chips.
 * ============================================================ */
.trailhead-outcome {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
}
.trailhead-outcome-chip {
  cursor: pointer;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.05);
  user-select: none;
  font-weight: 500;
  transition: background 120ms ease, border-color 120ms ease, transform 80ms ease;
}
.trailhead-outcome-chip:hover {
  background: rgba(255,255,255,0.12);
  border-color: rgba(255,255,255,0.28);
}
.trailhead-outcome-chip:active { transform: translateY(1px); }
.trailhead-outcome-recorded {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(116,209,140,0.18);
  border: 1px solid rgba(116,209,140,0.40);
  color: #d8f1de;
  font-size: 12px;
  font-weight: 500;
}
.trailhead-outcome-recorded::before {
  content: '✓';
  font-weight: 700;
  color: #74d18c;
}

/* ============================================================
 * Widget C — prompt-diff link & inline panel.
 * ============================================================ */
.trailhead-diff-link {
  cursor: pointer;
  font-size: 11px;
  margin-left: 6px;
  opacity: 0.7;
  text-decoration: underline;
  text-underline-offset: 2px;
  user-select: none;
  display: inline-block;
  transition: opacity 120ms ease, color 120ms ease;
}
.trailhead-diff-link:hover { opacity: 1; color: #6c8cff; }
.trailhead-diff-panel {
  margin-top: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.12);
  background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
  font-size: 12px;
  animation: trailhead-card-in 200ms cubic-bezier(0.4,0,0.2,1);
}
.trailhead-diff-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 8px;
}
.trailhead-diff-col h4 {
  margin: 0 0 6px 0;
  font-size: 10.5px;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}
.trailhead-diff-prompt {
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(0,0,0,0.25);
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.06);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.5;
}
.trailhead-diff-narrative { margin-top: 10px; opacity: 0.85; line-height: 1.45; }
.trailhead-diff-error {
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.7;
}

/* ============================================================
 * Widget D — wiki toasts (fixed-position stack on document.body).
 * Mounted in a fixed-position container (Option β, spec §9.3) so
 * Claude.ai's React reconciliation cannot tear them down.
 * ============================================================ */
#trailhead-toast-stack {
  position: fixed;
  /* Sits below the context pill (top: 16px). On narrow Claude layouts the
   * pill drifts close to the viewport right edge; 64px keeps the toast
   * stack clear of it. On wide layouts the pill is centered with the chat
   * column, far from the right edge — the 48px extra inset is harmless. */
  top: 64px;
  right: 16px;
  z-index: 2147483646;        /* below browser chrome, above everything else */
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;       /* clicks fall through gaps; toasts re-enable */
  max-width: 380px;
  width: max-content;
}
.trailhead-toast {
  pointer-events: auto;
  padding: 12px 14px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(28,32,46,0.95), rgba(20,22,32,0.95));
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(108,140,255,0.42);
  box-shadow: 0 8px 24px rgba(0,0,0,0.42);
  font-size: 12.5px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.45;
  color: #cfd8ff;
  cursor: pointer;
  user-select: none;
  animation: trailhead-toast-in 240ms cubic-bezier(0.4,0,0.2,1);
  transition: transform 120ms cubic-bezier(0.4,0,0.2,1), box-shadow 120ms cubic-bezier(0.4,0,0.2,1);
}
.trailhead-toast:hover {
  transform: translateX(-2px);
  box-shadow: 0 10px 28px rgba(0,0,0,0.50);
}
.trailhead-toast.is-promoted {
  border-color: rgba(116,209,140,0.55);
  color: #d8f1de;
  background: linear-gradient(180deg, rgba(28,46,34,0.95), rgba(20,32,24,0.95));
}
.trailhead-toast.is-leaving {
  animation: trailhead-toast-out 200ms ease-in forwards;
}
@keyframes trailhead-toast-in {
  from { opacity: 0; transform: translateX(12px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes trailhead-toast-out {
  from { opacity: 1; transform: translateX(0); }
  to   { opacity: 0; transform: translateX(12px); }
}

/* ============================================================
 * Improve-chat widget — replaces the score-card body when the
 * user clicks Improve. Spec: 2026-04-26-improve-widget-design.md
 * ============================================================ */
#trailhead-score-card[data-mode="improve"] {
  border-color: rgba(108,140,255,0.45);
  box-shadow: var(--th-shadow-md), inset 3px 0 0 0 var(--th-accent);
}
.trailhead-improve-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--th-border);
}
.trailhead-improve-header::before {
  content: '';
  display: inline-flex;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: linear-gradient(135deg, #6c8cff, #4a6bff);
  flex: 0 0 auto;
  box-shadow: 0 2px 8px rgba(74,107,255,0.30), inset 0 1px 0 rgba(255,255,255,0.18);
}
.trailhead-improve-header-title {
  flex: 1;
  font-weight: 600;
  font-size: 13.5px;
  color: rgba(255,255,255,0.92);
  letter-spacing: 0.01em;
}
.trailhead-improve-close {
  background: var(--th-surface-2);
  border: 1px solid var(--th-border);
  color: rgba(255,255,255,0.85);
  font: inherit;
  width: 26px;
  height: 26px;
  line-height: 1;
  font-size: 18px;
  border-radius: var(--th-radius-sm);
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms var(--th-ease), color 120ms var(--th-ease);
}
.trailhead-improve-close:hover {
  background: rgba(255,135,115,0.18);
  color: #ff8773;
  border-color: rgba(255,135,115,0.40);
}

.trailhead-improve-thread {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 320px;
  overflow-y: auto;
  padding: 14px;
  background: rgba(0,0,0,0.22);
  border: 1px solid var(--th-border);
  border-radius: var(--th-radius);
  margin-bottom: 12px;
}
.trailhead-improve-thread::-webkit-scrollbar { width: 6px; }
.trailhead-improve-thread::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.12);
  border-radius: 3px;
}
.trailhead-improve-thread::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.20); }

.trailhead-bubble {
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  max-width: 86%;
  word-wrap: break-word;
  animation: trailhead-bubble-in 180ms var(--th-ease);
}
@keyframes trailhead-bubble-in {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}
.trailhead-bubble--assistant {
  background: rgba(108,140,255,0.12);
  border: 1px solid rgba(108,140,255,0.22);
  align-self: flex-start;
  border-top-left-radius: 4px;
}
.trailhead-bubble--user {
  background: linear-gradient(135deg, rgba(108,140,255,0.30), rgba(74,107,255,0.22));
  border: 1px solid rgba(108,140,255,0.30);
  align-self: flex-end;
  border-top-right-radius: 4px;
}
.trailhead-bubble--pending {
  opacity: 0.65;
  font-style: italic;
}

.trailhead-improve-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: stretch;
  margin-bottom: 4px;
}
.trailhead-improve-input {
  resize: vertical;
  min-height: 40px;
  background: rgba(0,0,0,0.28);
  border: 1px solid var(--th-border);
  border-radius: var(--th-radius-sm);
  color: inherit;
  font: inherit;
  padding: 8px 10px;
  box-sizing: border-box;
  transition: border-color 150ms var(--th-ease), background 150ms var(--th-ease);
}
.trailhead-improve-input:focus {
  outline: none;
  border-color: var(--th-accent);
  background: rgba(0,0,0,0.32);
  box-shadow: 0 0 0 3px var(--th-accent-bg);
}
.trailhead-improve-input:disabled { opacity: 0.5; }

.trailhead-improve-input-row button,
.trailhead-improve-preview-actions button,
.trailhead-improve-error-actions button {
  background: var(--th-surface-2);
  border: 1px solid var(--th-border-strong);
  border-radius: var(--th-radius-sm);
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  padding: 8px 16px;
  min-height: 34px;
  cursor: pointer;
  transition: background 150ms var(--th-ease), border-color 150ms var(--th-ease), transform 80ms var(--th-ease);
}
.trailhead-improve-input-row button:hover:not(:disabled),
.trailhead-improve-preview-actions button:hover:not(:disabled),
.trailhead-improve-error-actions button:hover:not(:disabled) {
  background: var(--th-surface-hover);
  border-color: rgba(255,255,255,0.22);
}
.trailhead-improve-input-row button:active:not(:disabled),
.trailhead-improve-preview-actions button:active:not(:disabled),
.trailhead-improve-error-actions button:active:not(:disabled) {
  transform: translateY(1px);
}
.trailhead-improve-input-row button.is-primary,
.trailhead-improve-preview-actions button.is-primary,
.trailhead-improve-error-actions button.is-primary {
  background: linear-gradient(135deg, #6c8cff, #4a6bff);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 2px 8px rgba(74,107,255,0.28);
}
.trailhead-improve-input-row button.is-primary:hover:not(:disabled),
.trailhead-improve-preview-actions button.is-primary:hover:not(:disabled),
.trailhead-improve-error-actions button.is-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #7c98ff, #5b78ff);
  box-shadow: 0 3px 12px rgba(74,107,255,0.40);
}
.trailhead-improve-input-row button:disabled,
.trailhead-improve-preview-actions button:disabled,
.trailhead-improve-error-actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}

.trailhead-improve-preview,
.trailhead-improve-error {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* "What changed" lesson recap shown above the polished prompt in preview. */
.trailhead-improve-preview-rationale {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
  margin-bottom: 8px;
  background: linear-gradient(135deg, rgba(108,140,255,0.10), rgba(108,140,255,0.04));
  border: 1px solid rgba(108,140,255,0.32);
  border-radius: var(--th-radius);
  border-left: 3px solid var(--th-accent);
}
.trailhead-improve-preview-rationale-label {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--th-accent);
}
.trailhead-improve-preview-rationale-label::before {
  content: '💡 ';
  margin-right: 2px;
}
.trailhead-improve-preview-rationale-text {
  font-size: 12.5px;
  line-height: 1.5;
  color: rgba(255,255,255,0.88);
}

.trailhead-improve-preview-body {
  background: rgba(0,0,0,0.28);
  padding: 14px 16px;
  border-radius: var(--th-radius);
  border: 1px solid var(--th-border);
  white-space: pre-wrap;
  word-break: break-word;
  font: 12.5px/1.55 ui-monospace, "SF Mono", Menlo, monospace;
  max-height: 280px;
  overflow-y: auto;
  margin: 0 0 10px 0;
  color: rgba(255,255,255,0.92);
}
.trailhead-improve-preview-body::-webkit-scrollbar { width: 6px; }
.trailhead-improve-preview-body::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.12);
  border-radius: 3px;
}
/* Wrapper for the two preview action rows. Right-aligns the buttons so
 * a single visible row (asking stage: just disabled "Use AI prompt") sits
 * to the right, and two visible rows (preview stage: "I'm done" + enabled
 * "Use AI prompt") sit on the same horizontal line. */
.trailhead-improve-actions-wrap {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.trailhead-improve-preview-actions {
  display: flex;
  gap: 8px;
}
.trailhead-improve-error-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.trailhead-improve-error-msg {
  color: #ff8c8c;
  font-size: 12.5px;
  padding: 10px 12px;
  background: var(--th-bad-bg);
  border: 1px solid rgba(208,74,58,0.40);
  border-radius: var(--th-radius-sm);
}

/* Improve-chat choice screen (initial state) */
.trailhead-improve-choice {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 4px 4px;
  text-align: center;
}
.trailhead-improve-choice-intro {
  font-size: 13.5px;
  opacity: 0.92;
  line-height: 1.55;
  max-width: 480px;
  margin: 0 auto;
}
.trailhead-improve-choice-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 4px;
}
.trailhead-improve-choice-actions button.is-primary {
  padding: 10px 24px;
  font-size: 13px;
  letter-spacing: 0.01em;
}
.trailhead-improve-choice-actions button {
  background: var(--th-surface-2);
  border: 1px solid var(--th-border-strong);
  border-radius: var(--th-radius-sm);
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  padding: 8px 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background 150ms var(--th-ease), border-color 150ms var(--th-ease), transform 80ms var(--th-ease);
}
.trailhead-improve-choice-actions button:hover {
  background: var(--th-surface-hover);
  border-color: rgba(255,255,255,0.22);
}
.trailhead-improve-choice-actions button:active { transform: translateY(1px); }
.trailhead-improve-choice-actions button.is-primary {
  background: linear-gradient(135deg, #6c8cff, #4a6bff);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 2px 8px rgba(74,107,255,0.28);
}
.trailhead-improve-choice-actions button.is-primary:hover {
  background: linear-gradient(135deg, #7c98ff, #5b78ff);
  box-shadow: 0 3px 12px rgba(74,107,255,0.40);
}
.trailhead-improve-soon {
  font-size: 9.5px;
  opacity: 0.85;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255,255,255,0.12);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}
.trailhead-improve-choice-note {
  font-size: 11.5px;
  opacity: 0.78;
  padding: 8px 10px;
  background: rgba(0,0,0,0.20);
  border: 1px solid var(--th-border);
  border-radius: var(--th-radius-sm);
  line-height: 1.45;
}

/* ============================================================
 * #trailhead-context-pill — sticky reminder of the active wiki
 * context. Mounted on document.body with position: fixed; top: 16px.
 * The right value is set INLINE by context-pill.ts on mount and via
 * a ResizeObserver, computed from the composer's bounding rect so
 * the pill always lines up with the right edge of the visible chat
 * column (independent of sidebar state, window width, or Claude.ai
 * layout variant).
 * ============================================================ */
#trailhead-context-pill {
  position: fixed;
  /* Anchored to the right edge of the viewport, 10% inset (so the pill
   * floats over the right side of the chat without hugging the corner). */
  right: 4%;
  top: 15px;
  z-index: 2147483645;        /* one below the toast stack */
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 360px;
  padding: 6px 8px 6px 12px;
  border-radius: var(--th-radius-pill);
  background: var(--th-accent-bg);
  border: 1px solid var(--th-accent-border);
  color: var(--text-primary, #e5e7ee);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 12px;
  box-shadow: 0 4px 14px rgba(74,107,255,0.22), 0 1px 3px rgba(0,0,0,0.20);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background 150ms var(--th-ease), border-color 150ms var(--th-ease);
}
#trailhead-context-pill:hover {
  background: rgba(108,140,255,0.20);
  border-color: rgba(108,140,255,0.55);
}
#trailhead-context-pill[hidden] { display: none; }
/* Bump the right inset on narrower viewports — at 4% the pill starts to
 * crowd the chat column when the window shrinks (or the sidebar opens). */
@media (max-width: 1280px) {
  #trailhead-context-pill { right: 6%; }
}
.trailhead-context-pill-icon { font-size: 12px; opacity: 0.85; }
.trailhead-context-pill-prefix {
  opacity: 0.72;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}
.trailhead-context-pill-label {
  font-weight: 600;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}
.trailhead-context-pill-clear {
  margin-left: 2px;
  background: rgba(0,0,0,0.20);
  border: 1px solid transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  width: 20px;
  height: 20px;
  line-height: 1;
  border-radius: 50%;
  opacity: 0.75;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms var(--th-ease), opacity 120ms var(--th-ease);
}
.trailhead-context-pill-clear:hover {
  background: rgba(255,135,115,0.22);
  border-color: rgba(255,135,115,0.40);
  opacity: 1;
  color: #ff8773;
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  #trailhead-score-card,
  #trailhead-context-pill,
  #trailhead-toast-stack *,
  .trailhead-bubble,
  .trailhead-diff-panel {
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
  }
}
`;

export function injectStyles(): void {
  if (document.getElementById(TRAILHEAD_STYLESHEET_ID)) return;
  const el = document.createElement('style');
  el.id = TRAILHEAD_STYLESHEET_ID;
  el.textContent = TRAILHEAD_CSS;
  document.head.appendChild(el);
}
