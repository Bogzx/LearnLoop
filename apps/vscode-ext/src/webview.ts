// HTML / inline-script bundle for the sidebar. Exposed as a single function
// so we can swap themes / nonce / CSP in one place. The webview script
// communicates with the extension host via vscode.postMessage.
//
// The CSP is strict: only inline scripts with the matching nonce, and styles
// from the VS Code-injected stylesheet variables. No remote network calls
// from the webview itself — all HTTP happens in the extension host (which
// has no CSP) and is forwarded over the postMessage bridge.
import type { Dimension } from '@trailhead/shared';
import { DIMENSIONS } from '@trailhead/shared';

export function getWebviewHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    :root {
      --row-gap: 4px;
      --section-gap: 16px;
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 12px 12px 24px;
      margin: 0;
    }
    h2 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--vscode-descriptionForeground);
      margin: var(--section-gap) 0 8px;
      font-weight: 600;
    }
    h2:first-child { margin-top: 0; }
    .section { margin-bottom: var(--section-gap); }
    .file-path {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
      word-break: break-all;
    }
    textarea {
      width: 100%;
      min-height: 60px;
      box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 2px;
      padding: 6px 8px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      resize: vertical;
    }
    textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }
    .score-overall {
      font-size: 24px;
      font-weight: 600;
      margin: 8px 0 4px;
    }
    .score-overall.low    { color: var(--vscode-errorForeground); }
    .score-overall.med    { color: var(--vscode-editorWarning-foreground, #d18616); }
    .score-overall.high   { color: var(--vscode-testing-iconPassed, #4caf50); }
    .dim-row {
      display: grid;
      grid-template-columns: 14px 1fr 28px;
      gap: 8px;
      align-items: center;
      padding: var(--row-gap) 0;
      font-size: 12px;
    }
    .dim-icon { font-weight: bold; }
    .dim-icon.ok   { color: var(--vscode-testing-iconPassed, #4caf50); }
    .dim-icon.bad  { color: var(--vscode-errorForeground); }
    .dim-name { font-family: var(--vscode-editor-font-family); }
    .dim-score { text-align: right; opacity: 0.8; }
    .dim-hint {
      grid-column: 2 / span 2;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: -2px;
      padding-bottom: 4px;
    }
    .example {
      padding: 8px;
      background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
      border-radius: 2px;
      margin-bottom: 6px;
      font-size: 12px;
    }
    .example-meta {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
    }
    .example-template {
      font-family: var(--vscode-editor-font-family);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      font-style: italic;
    }
    .wiki-item {
      padding: 6px 8px;
      border-left: 2px solid var(--vscode-charts-blue, #007acc);
      margin-bottom: 4px;
      font-size: 12px;
    }
    .wiki-item.durable {
      border-left-color: var(--vscode-testing-iconPassed, #4caf50);
    }
    .wiki-meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 11px;
      border-radius: 2px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div class="section">
    <h2>Active file</h2>
    <div id="file-path" class="file-path">(no file open)</div>
  </div>

  <div class="section">
    <h2>Team examples</h2>
    <div id="examples" class="empty">Open a file to see your team's prompts.</div>
  </div>

  <div class="section">
    <h2>Score your prompt</h2>
    <textarea id="prompt" placeholder="Type a prompt — we score it as you type."></textarea>
    <div id="overall" class="score-overall">—</div>
    <div id="dimensions"></div>
  </div>

  <div class="section">
    <h2>Wiki updates</h2>
    <div id="wiki" class="empty">Watching for autonomous wiki updates…</div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const DIMENSIONS = ${JSON.stringify(DIMENSIONS)};

    const filePathEl   = document.getElementById('file-path');
    const examplesEl   = document.getElementById('examples');
    const promptEl     = document.getElementById('prompt');
    const overallEl    = document.getElementById('overall');
    const dimensionsEl = document.getElementById('dimensions');
    const wikiEl       = document.getElementById('wiki');

    let scoreTimer = null;
    let lastScoreSeq = 0;

    promptEl.addEventListener('input', () => {
      const text = promptEl.value;
      if (scoreTimer) clearTimeout(scoreTimer);
      scoreTimer = setTimeout(() => {
        if (!text.trim()) {
          renderScore(null);
          return;
        }
        const seq = ++lastScoreSeq;
        vscode.postMessage({ type: 'score', seq, prompt: text });
      }, 250);
    });

    window.addEventListener('message', (e) => {
      const m = e.data;
      switch (m.type) {
        case 'filePath':
          filePathEl.textContent = m.path || '(no file open)';
          break;
        case 'examples':
          renderExamples(m.items);
          break;
        case 'score':
          if (m.seq !== lastScoreSeq) return; // stale
          renderScore(m.payload, m.error);
          break;
        case 'wiki':
          renderWiki(m.items);
          break;
        case 'reset':
          promptEl.value = '';
          renderScore(null);
          break;
      }
    });

    function pretty(name) {
      return String(name).replace(/_/g, ' ');
    }

    function renderExamples(items) {
      if (!items || items.length === 0) {
        examplesEl.className = 'empty';
        examplesEl.textContent = 'No team examples for this folder yet.';
        return;
      }
      examplesEl.className = '';
      examplesEl.innerHTML = '';
      for (const it of items.slice(0, 3)) {
        const div = document.createElement('div');
        div.className = 'example';
        const meta = document.createElement('div');
        meta.className = 'example-meta';
        meta.innerHTML =
          '<span>' + (it.topic ? escapeHtml(it.topic) : 'general') + '</span>' +
          '<span>×' + Number(it.reuse_count || 0) + ' @ ' + escapeHtml(it.node_path || '') + '</span>';
        const tmpl = document.createElement('div');
        tmpl.className = 'example-template';
        tmpl.textContent = (it.template || '').slice(0, 200);
        div.appendChild(meta);
        div.appendChild(tmpl);
        examplesEl.appendChild(div);
      }
    }

    function renderScore(payload, error) {
      if (error) {
        overallEl.textContent = '—';
        overallEl.className = 'score-overall';
        dimensionsEl.innerHTML = '<div class="empty">' + escapeHtml(error) + '</div>';
        return;
      }
      if (!payload) {
        overallEl.textContent = '—';
        overallEl.className = 'score-overall';
        dimensionsEl.innerHTML = '';
        return;
      }
      const overall = Number(payload.overall ?? 0);
      overallEl.textContent = overall + '/10';
      overallEl.className = 'score-overall ' + (overall >= 7 ? 'high' : overall >= 4 ? 'med' : 'low');

      dimensionsEl.innerHTML = '';
      for (const dim of DIMENSIONS) {
        const score = Number(payload.dimensions?.[dim] ?? 0);
        const ok = score >= 5;
        const row = document.createElement('div');
        row.className = 'dim-row';
        row.innerHTML =
          '<span class="dim-icon ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓' : '✗') + '</span>' +
          '<span class="dim-name">' + escapeHtml(pretty(dim)) + '</span>' +
          '<span class="dim-score">' + score + '</span>';
        dimensionsEl.appendChild(row);
        const hint = payload.missing?.[dim];
        if (hint) {
          const h = document.createElement('div');
          h.className = 'dim-hint';
          h.textContent = '— ' + hint;
          dimensionsEl.appendChild(h);
        }
      }
    }

    function renderWiki(items) {
      if (!items || items.length === 0) {
        wikiEl.className = 'empty';
        wikiEl.textContent = 'Watching for autonomous wiki updates…';
        return;
      }
      wikiEl.className = '';
      wikiEl.innerHTML = '';
      for (const it of items.slice(0, 8)) {
        const div = document.createElement('div');
        div.className = 'wiki-item' + (it.status === 'durable' ? ' durable' : '');
        const meta = document.createElement('div');
        meta.className = 'wiki-meta';
        meta.textContent = it.node_path + ' · ' + it.status + ' · ×' + it.reinforcement_count;
        const body = document.createElement('div');
        body.textContent = it.body;
        div.appendChild(meta);
        div.appendChild(body);
        wikiEl.appendChild(div);
      }
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

export function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export type Direction = Dimension; // re-export for the diff toast logic
