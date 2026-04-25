// VS Code extension entry. Owns:
// - the activitybar contribution / sidebar webview
// - the postMessage bridge that forwards score / examples / wiki to the webview
// - 250ms-debounced /score forwarding (debounce on the webview side; here we
//   add only a per-keystroke abort to cancel inflight requests)
// - 2s polling of /wiki/recent → toast + sidebar update
//
// All HTTP happens in the extension host (no CSP), then the result flows
// to the webview via postMessage. Webview is render-only.
import * as vscode from 'vscode';
import * as api from './api.ts';
import { activeFilePath, activeFolderPath } from './paths.ts';
import { getNonce, getWebviewHtml } from './webview.ts';
import { applyWikiSnapshot, diffWikiItems, maxSince } from './wiki-diff.ts';

function readConfig(): api.ApiConfig & { userId: string } {
  const cfg = vscode.workspace.getConfiguration('trailhead');
  return {
    apiUrl: cfg.get<string>('apiUrl') ?? 'https://trailheadapi-production.up.railway.app',
    teamToken: cfg.get<string>('teamToken') ?? 'trailhead_demo_acme_2026',
    userId: cfg.get<string>('userId') ?? 'demo',
  };
}

class CoachViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'trailhead.coach';

  private view: vscode.WebviewView | undefined;
  private wikiState = new Map<string, api.WikiRecentItem>();
  private wikiSince = new Date(Date.now() - 24 * 3600_000).toISOString();
  private wikiTimer: NodeJS.Timeout | undefined;
  private inflightScore: AbortController | undefined;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = getWebviewHtml(getNonce());
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    view.onDidDispose(() => {
      this.stopWikiPolling();
      this.view = undefined;
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) this.startWikiPolling();
      else this.stopWikiPolling();
    });
    if (view.visible) this.startWikiPolling();

    // Push initial active-file context once the webview signals ready.
  }

  private async onMessage(m: any): Promise<void> {
    if (!this.view) return;
    switch (m?.type) {
      case 'ready':
        this.pushFileContext();
        break;
      case 'score':
        await this.handleScore(m.seq, m.prompt);
        break;
    }
  }

  // Called from extension activation when the active editor changes.
  public pushFileContext(): void {
    if (!this.view) return;
    const filePath = activeFilePath();
    const folder = activeFolderPath();
    this.view.webview.postMessage({ type: 'filePath', path: filePath ?? '' });
    if (folder !== null) this.loadExamples(folder);
    else this.view.webview.postMessage({ type: 'examples', items: [] });
  }

  private async loadExamples(folder: string): Promise<void> {
    const cfg = readConfig();
    try {
      const res = await api.examples(cfg, folder);
      this.view?.webview.postMessage({ type: 'examples', items: res.items });
    } catch {
      // /examples may not be deployed yet — show empty state, no toast spam.
      this.view?.webview.postMessage({ type: 'examples', items: [] });
    }
  }

  private async handleScore(seq: number, prompt: string): Promise<void> {
    if (!this.view) return;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      this.view.webview.postMessage({ type: 'score', seq, payload: null });
      return;
    }
    this.inflightScore?.abort();
    const ac = new AbortController();
    this.inflightScore = ac;
    const cfg = readConfig();
    try {
      const res = await api.score(
        cfg,
        {
          prompt,
          file_path: activeFilePath() ?? undefined,
          user_id: cfg.userId,
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      this.view.webview.postMessage({ type: 'score', seq, payload: res });
    } catch (e) {
      if (ac.signal.aborted) return;
      const msg = (e as Error).message;
      this.view.webview.postMessage({ type: 'score', seq, error: `score failed: ${msg}` });
    }
  }

  private startWikiPolling(): void {
    if (this.wikiTimer) return;
    const tick = async () => {
      await this.pollWiki().catch(() => {});
    };
    void tick();
    this.wikiTimer = setInterval(tick, 2000);
  }

  private stopWikiPolling(): void {
    if (this.wikiTimer) clearInterval(this.wikiTimer);
    this.wikiTimer = undefined;
  }

  private async pollWiki(): Promise<void> {
    if (!this.view) return;
    const cfg = readConfig();
    let res: api.WikiRecentResponse;
    try {
      res = await api.wikiRecent(cfg, this.wikiSince);
    } catch {
      return; // endpoint may not be deployed; fail silently
    }
    const toasts = diffWikiItems(this.wikiState, res.items);
    for (const t of toasts) {
      vscode.window.showInformationMessage(t.text);
    }
    applyWikiSnapshot(this.wikiState, res.items);
    this.wikiSince = maxSince(res.items, this.wikiSince);
    this.view.webview.postMessage({
      type: 'wiki',
      items: [...this.wikiState.values()].sort(
        (a, b) => b.last_seen_at.localeCompare(a.last_seen_at),
      ),
    });
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new CoachViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CoachViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => provider.pushFileContext()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('trailhead.refresh', () => provider.pushFileContext()),
  );
}

export function deactivate(): void {}
