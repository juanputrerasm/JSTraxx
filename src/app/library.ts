/*
  The game library: the PODs the author added (jstraxx/library), mounted in the order and
  with the exclusions set in Options > Library. Remounts whenever either changes.

  Ahead of the PODs, a .TXX reads its art and models from the project's ART and MODELS folders in
  browser storage (core/storage.ts); the library shows them and can clear them.
*/
import { Emitter } from "../shared/emitter.ts";
import { orderLibrary } from "../core/settings.ts";
import type { AppState } from "./state.ts";
import type { WorkerClient } from "../shared/worker-client.ts";
import type { LibraryItem, MountSummary } from "../worker/asset-worker.ts";
import type { StoredFile, StoreFolder, StoreSummary } from "../core/storage.ts";

export interface LibraryEntry extends LibraryItem { enabled: boolean; summary: MountSummary | null }

export class Library extends Emitter<{ changed: LibraryEntry[]; progress: { label: string; done: number; total: number } | null }> {
  entries: LibraryEntry[] = [];
  private app: AppState;
  private worker: WorkerClient;

  constructor(app: AppState, worker: WorkerClient) {
    super();
    this.app = app;
    this.worker = worker;
    worker.on("progress", (p) => this.emit("progress", p as { label: string; done: number; total: number } | null));
  }

  /** Re-reads the folder and remounts. */
  async refresh(): Promise<void> {
    const items = await this.worker.call<LibraryItem[]>("library.list");
    const s = this.app.settings;
    const order = orderLibrary(items.map((i) => i.name), s.library_order);
    const disabled = new Set(s.library_disabled);
    const byName = new Map(items.map((i) => [i.name, i]));
    const enabled = order.filter((n) => !disabled.has(n));
    const summaries = await this.worker.call<MountSummary[]>("vfs.mount", { order: enabled });
    const summaryOf = new Map(summaries.map((m) => [m.name, m]));
    this.entries = order.map((name) => ({ ...byName.get(name)!, enabled: !disabled.has(name), summary: summaryOf.get(name) ?? null }));
    this.emit("changed", this.entries);
    const tracks = summaries.reduce((n, m) => n + m.tracks.length, 0);
    const bad = summaries.filter((m) => m.error).length;
    this.app.status(`${enabled.length} game POD${enabled.length === 1 ? "" : "s"} mounted, ${tracks} track${tracks === 1 ? "" : "s"}${bad ? `, ${bad} unreadable` : ""}`);
  }

  async import(files: File[]): Promise<string[]> {
    const added = await this.worker.call<string[]>("library.import", { files });
    await this.refresh();
    return added;
  }

  /** What the project's ART and MODELS folders in browser storage hold. */
  storeSummary(): Promise<StoreSummary> {
    return this.worker.call<StoreSummary>("store.summary");
  }

  /** The stored files a clear with this filter would delete. */
  storeMatch(folders: StoreFolder[], filter: string): Promise<StoredFile[]> {
    return this.worker.call<StoredFile[]>("store.match", { folders, filter });
  }

  /** Deletes the stored files the filter picks; returns how many. */
  async clearStore(folders: StoreFolder[], filter: string): Promise<number> {
    const removed = await this.worker.call<number>("store.clear", { folders, filter });
    await this.worker.call("art.forget");
    this.app.status(`${removed} file${removed === 1 ? "" : "s"} deleted from browser storage`);
    return removed;
  }

  async remove(name: string): Promise<void> {
    await this.worker.call("library.remove", { name });
    this.app.updateSettings((s) => {
      s.library_order = s.library_order.filter((n) => n !== name);
      s.library_disabled = s.library_disabled.filter((n) => n !== name);
    });
    await this.refresh();
  }

  /** Applies a new order and enabled set, then remounts. */
  async arrange(order: string[], disabled: string[]): Promise<void> {
    this.app.updateSettings((s) => { s.library_order = [...order]; s.library_disabled = [...disabled]; });
    await this.refresh();
  }
}
