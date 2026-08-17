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

// Trailhead ships no hosted API — the backend is self-hosted, so `trailhead.apiUrl`
// is required config. This default matches the port apps/api listens on
// (PORT ?? 3000) and the port the root docker-compose.yml publishes.
const DEFAULT_API_URL = 'http://localhost:3000';

function readConfig(): api.ApiConfig & { userId: string } {
  const cfg = vscode.workspace.getConfiguration('trailhead');
  const configured = (cfg.get<string>('apiUrl') ?? '').trim().replace(/\/+$/, '');
  return {
    apiUrl: configured || DEFAULT_API_URL,
    teamToken: cfg.get<string>('teamToken') ?? 'trailhead_demo_acme_2026',
    userId: cfg.get<string>('userId') ?? 'demo',
  };
}

// A self-hosted API that isn't running fails at the network layer. Undici
// surfaces that as a TypeError / "fetch failed" — distinct from a 4xx, which
// resolves normally. Those get a visible, actionable notification instead of
// an empty sidebar, because silence here reads as "the extension is broken".
function isUnreachable(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network/i.test(msg);
}

// Latched so a 2s wiki poll against a down server doesn't produce a
// notification storm. Cleared by noteApiReachable() on the next success, so a
// server that goes away again re-notifies.
let apiUnreachableNotified = false;

function noteApiReachable(): void {
  apiUnreachableNotified = false;
}

function notifyApiUnreachable(cfg: { apiUrl: string }, err: unknown): void {
  if (!isUnreachable(err) || apiUnreachableNotified) return;
  apiUnreachableNotified = true;
  const isDefault = cfg.apiUrl === DEFAULT_API_URL;
  const detail = isDefault
    ? `Trailhead can't reach an API at ${cfg.apiUrl}. Trailhead is self-hosted: start one with \`docker compose up\` from the repo root (see SELFHOSTING.md), or set "trailhead.apiUrl" in Settings to your server's URL.`
    : `Trailhead can't reach the API at ${cfg.apiUrl}. Check that the server is running, or correct "trailhead.apiUrl" in Settings.`;
  // Optional-called: the bundle-load test stubs `vscode` with a minimal window.
  vscode.window.showErrorMessage?.(detail);
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
      noteApiReachable();
      this.view?.webview.postMessage({ type: 'examples', items: res.items });
    } catch (e) {
      // /examples may not be deployed yet — show empty state, no toast spam.
      // An unreachable server is a different problem and does get surfaced.
      notifyApiUnreachable(cfg, e);
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
      noteApiReachable();
      this.view.webview.postMessage({ type: 'score', seq, payload: res });
    } catch (e) {
      if (ac.signal.aborted) return;
      notifyApiUnreachable(cfg, e);
      const msg = isUnreachable(e)
        ? `can't reach the Trailhead API at ${cfg.apiUrl} — check "trailhead.apiUrl" in Settings`
        : (e as Error).message;
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
      noteApiReachable();
    } catch (e) {
      // Endpoint may not be deployed; that stays silent. An unreachable
      // server surfaces once (latched) rather than every 2s poll.
      notifyApiUnreachable(cfg, e);
      return;
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
