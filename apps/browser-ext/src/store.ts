// In-memory state for the content script. No persistence across reloads —
// fresh tabs lose old scores by design (spec §2 / §5.6); MutationObserver
// re-walks the existing DOM and the wiki poller backfills the toast state.
import type { DimensionScores, MissingHints, WikiRecentItem } from '@trailhead/shared';

export interface ScoredEntry {
  overall: number;
  dimensions: DimensionScores;
  missing: MissingHints;
  /** id returned by /capture once the user rates the assistant reply */
  captureId?: string;
}

export interface DiffPanel {
  /** raw JSON from /diff, cached so re-clicks toggle without a refetch */
  // Loosely typed here to avoid pulling DiffResponse into every importer
  data: unknown;
}

class Store {
  private byHash = new Map<string, ScoredEntry>();
  private diffByHash = new Map<string, DiffPanel>();
  private wikiByItemId = new Map<string, WikiRecentItem>();

  private _lastHash = '';
  private _lastSeenIso: string = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // ----- score cache ---------------------------------------------------------
  setScore(hash: string, entry: ScoredEntry): void {
    this.byHash.set(hash, entry);
  }
  getScore(hash: string): ScoredEntry | undefined {
    return this.byHash.get(hash);
  }
  setLastHash(hash: string): void {
    this._lastHash = hash;
  }
  get lastHash(): string {
    return this._lastHash;
  }

  // ----- diff cache ----------------------------------------------------------
  setDiff(hash: string, panel: DiffPanel): void {
    this.diffByHash.set(hash, panel);
  }
  getDiff(hash: string): DiffPanel | undefined {
    return this.diffByHash.get(hash);
  }

  // ----- wiki state ----------------------------------------------------------
  getWikiItem(id: string): WikiRecentItem | undefined {
    return this.wikiByItemId.get(id);
  }
  setWikiItem(item: WikiRecentItem): void {
    this.wikiByItemId.set(item.id, item);
  }
  get lastSeenIso(): string {
    return this._lastSeenIso;
  }
  setLastSeenIso(iso: string): void {
    this._lastSeenIso = iso;
  }

  // ----- capture id linking --------------------------------------------------
  setCaptureId(hash: string, id: string): void {
    const e = this.byHash.get(hash);
    if (e) {
      e.captureId = id;
      this.byHash.set(hash, e);
    }
  }
}

export const store = new Store();
