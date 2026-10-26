/*
  The open track on the page side: holds the TrackDocument, its file name, whether it has
  unsaved changes, and runs the document commands through the asset worker. CTraxxDoc's role.
*/
import { Emitter } from "../shared/emitter.ts";
import type { WorkerClient } from "../shared/worker-client.ts";
import type { TrackDocument } from "../core/doc/document.ts";
import type { PodTrackList } from "../core/doc/load-pod.ts";
import type { AppState } from "./state.ts";
import { markCustomPalette } from "../core/traxx/palette.ts";

export interface DocEvents extends Record<string, unknown> {
  /** A different track is open (or none). */
  opened: TrackDocument | null;
  /** The track was saved. */
  saved: string;
  /** The title or the modified flag changed. */
  title: string;
}

export interface TrackListItem { name: string; path: string; size: number; modified: number }

export class DocumentService extends Emitter<DocEvents> {
  doc: TrackDocument | null = null;
  /** The .TXX this track saves to in tracks/, or null until it has been saved. */
  savePath: string | null = null;
  modified = false;
  private worker: WorkerClient;
  private app: AppState;

  constructor(app: AppState, worker: WorkerClient) {
    super();
    this.app = app;
    this.worker = worker;
  }

  get title(): string {
    if (!this.doc) return "JSTraxx";
    const name = this.doc.viewOnly ? this.doc.track.trackName : this.savePath ? this.savePath.split("/").pop()! : "Untitled";
    return `${name}${this.modified ? " *" : ""}${this.doc.viewOnly ? " (view only)" : ""} - JSTraxx`;
  }

  private set(doc: TrackDocument | null, savePath: string | null): void {
    this.doc = doc;
    this.savePath = savePath;
    this.modified = false;
    this.emit("opened", doc);
    this.emitTitle();
    this.app.emit("commands", undefined);
  }

  markModified(): void {
    if (this.modified || !this.doc || this.doc.viewOnly) return;
    this.modified = true;
    this.emitTitle();
  }

  /** Set or clear the mark directly (undo back to the saved state clears it). */
  setModified(on: boolean): void {
    if (this.modified === on || !this.doc) return;
    this.modified = on && !this.doc.viewOnly;
    this.emitTitle();
  }

  private emitTitle(): void {
    document.title = this.title;
    this.emit("title", this.title);
  }

  async newTrack(): Promise<void> {
    this.set(await this.worker.call<TrackDocument>("doc.new"), null);
  }

  async openTxx(source: string | File, fileName: string): Promise<TrackDocument> {
    const doc = await this.worker.call<TrackDocument>("doc.openTxx", { source, fileName });
    this.set(doc, typeof source === "string" ? source : null);
    this.remember(fileName, typeof source === "string" ? source : null);
    return doc;
  }

  podTracks(file: File): Promise<PodTrackList> {
    return this.worker.call<PodTrackList>("pod.tracks", { source: file });
  }

  /** The POD a viewed track came from, for Extract and Import. */
  viewedPod: File | null = null;

  async viewPod(file: File, which: number): Promise<TrackDocument> {
    const doc = await this.worker.call<TrackDocument>("doc.viewPod", { source: file, which, fileName: file.name });
    this.viewedPod = file;
    this.set(doc, null);
    return doc;
  }

  cloneList(files: File[]): Promise<{ sits: string[]; loose: string[] }> {
    return this.worker.call<{ sits: string[]; loose: string[] }>("clone.list", { files });
  }

  async clone(files: File[], sitPath: string): Promise<TrackDocument> {
    const doc = await this.worker.call<TrackDocument>("doc.clone", { files, sitPath });
    this.set(doc, null);
    return doc;
  }

  /** Save to `fileName` in tracks/ (Save As), or to the current file. */
  /*
    The autosave's quiet save (CTraxxFrame's timer: pod.SaveBinary): the track written over its
    own file, or to TraxxAuto.txx, leaving the modified mark and the file name as they were.
  */
  async autosave(specialFile: boolean): Promise<string | null> {
    if (!this.doc || this.doc.viewOnly || !this.modified || !this.savePath) return null;
    const name = specialFile ? "TraxxAuto.txx" : this.savePath.split("/").pop()!;
    const { path } = await this.worker.call<{ path: string; size: number }>("doc.saveTxx", { track: this.doc.track, fileName: name });
    return path;
  }

  async save(fileName?: string): Promise<string> {
    if (!this.doc) throw new Error("No track is open.");
    if (this.doc.viewOnly) throw new Error("A POD opened with View POD is read-only. Import it as a track to edit it.");
    const name = fileName ?? this.savePath?.split("/").pop();
    if (!name) throw new Error("Choose a name first.");
    const { path } = await this.worker.call<{ path: string; size: number }>("doc.saveTxx", { track: this.doc.track, fileName: name });
    this.savePath = path;
    this.modified = false;
    this.emit("saved", path);
    this.doc.source = { kind: "txx", fileName: path.split("/").pop()!, project: path };
    this.emitTitle();
    this.remember(path.split("/").pop()!, path);
    this.app.emit("commands", undefined);
    return path;
  }

  /** The current track as .TXX bytes. */
  txxBytes(): Promise<Uint8Array> {
    if (!this.doc) throw new Error("No track is open.");
    return this.worker.call<Uint8Array>("doc.txxBytes", { track: this.doc.track });
  }

  listTracks(): Promise<TrackListItem[]> {
    return this.worker.call<TrackListItem[]>("tracks.list");
  }

  async extract(): Promise<{ written: number; skipped: number }> {
    if (!this.viewedPod || !this.doc?.viewOnly) throw new Error("Extract works on a POD opened with View POD.");
    return this.worker.call("art.extract", { source: this.viewedPod });
  }

  /*
    Import the viewed POD as an editable track (a JSTraxx addition): extract its art and
    models, then save it as a .TXX and reopen that, exactly as an author would by hand in
    Traxx (Extract, then rebuild the track).
  */
  async importViewed(fileName: string): Promise<{ written: number; skipped: number }> {
    if (!this.doc?.viewOnly) throw new Error("Import works on a POD opened with View POD.");
    const counts = await this.extract();
    // The POD's own palette stays the track's palette (see markCustomPalette).
    markCustomPalette(this.doc.track);
    this.doc.viewOnly = false;
    try {
      const path = await this.save(fileName);
      await this.openTxx(path, path.split("/").pop()!);
    } catch (err) {
      if (this.doc) this.doc.viewOnly = true;
      throw err;
    }
    return counts;
  }

  close(): void {
    this.viewedPod = null;
    this.set(null, null);
  }

  /** The recent-tracks list (Traxx's MRU): saved tracks only, newest first, four at most. */
  private remember(_name: string, path: string | null): void {
    if (!path) return;
    this.app.updateSettings((s) => { s.recent = [path, ...s.recent.filter((p) => p !== path)].slice(0, 4); });
  }
}
