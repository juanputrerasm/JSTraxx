/*
  The open track on the page side: holds the TrackDocument, its file name, whether it has
  unsaved changes, and runs the document commands through the asset worker. CTraxxDoc's role.
*/
import { setMode } from "../core/traxx/surface.ts";
import { TERRAINMODE_CLASSIC8 } from "../core/traxx/terrain16.ts";
import type { TrackKind } from "../core/traxx/track-kind.ts";
import { trackTitleTag } from "../core/traxx/track-kind-ui.ts";
import { Emitter } from "../shared/emitter.ts";
import type { WorkerClient } from "../shared/worker-client.ts";
import type { TrackDocument } from "../core/doc/document.ts";
import type { PodTrackList } from "../core/doc/load-pod.ts";
import type { AppState } from "./state.ts";
import { markCustomPalette } from "../core/traxx/palette.ts";
import { EDIT_THIS_TRACK_COPY_FAILED, editThisTrackRefusal, makeEditableFromView } from "../core/doc/edit-this-track.ts";
import type { ModelAsset, TextureAsset } from "../core/doc/document.ts";

/** What the worker's art.extract answers. */
export interface ExtractReply {
  written: number;
  /** Pod1ReportLine's lines. */
  report: string[];
  /** The pod's entry names. */
  entries: string[];
  reloaded: { model: ModelAsset; textures: TextureAsset[] }[];
  sources: { name: string; srf: Uint8Array | null }[];
}

/** Edit This Track could not finish; the message is Traxx's, and the track is still only being viewed. */
export class EditThisTrackError extends Error {}

export interface DocEvents extends Record<string, unknown> {
  /** A different track is open (or none). */
  opened: TrackDocument | null;
  /** The track was saved. */
  saved: string;
  /** The title or the modified flag changed. */
  title: string;
}

/** An error that is an allocation the browser refused (a RangeError's text, also as the worker passes it on). */
export function isAllocationFailure(err: unknown): boolean {
  if (err instanceof RangeError) return true;
  const text = err instanceof Error ? err.message : String(err);
  return /out of memory|allocation failed|invalid (typed )?array length|array buffer/i.test(text);
}

export interface TrackListItem { name: string; path: string; size: number; modified: number }

export class DocumentService extends Emitter<DocEvents> {
  doc: TrackDocument | null = null;
  /** The .TXX this track saves to in tracks/, or null until it has been saved. */
  savePath: string | null = null;
  modified = false;
  /**
    CTraxxDoc::m_sunDefaultsAcked (Traxx 1.7.2): Yes was answered to Write POD's "still Traxx's
    defaults" question for this document. Reset whenever another document (or none) is set, as
    Traxx resets it on File > New and in DeleteContents.
  */
  sunDefaultsAcked = false;
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
    // OnUpdateFrameTitle (Traxx origin/main): a version 6 track's kind follows the usual title, built from the
    // track every time, so it follows File > New, Open and Special > Track Type.
    return `${name}${this.modified ? " *" : ""}${this.doc.viewOnly ? " (view only)" : ""} - JSTraxx${trackTitleTag(this.doc.track)}`;
  }

  /** The track's kind or world changed in place (Track Type, Enlarge World): the title follows. */
  refreshTitle(): void {
    this.emitTitle();
  }

  private set(doc: TrackDocument | null, savePath: string | null): void {
    this.doc = doc;
    this.savePath = savePath;
    this.modified = false;
    this.sunDefaultsAcked = false;
    this.emit("opened", doc);
    this.emitTitle();
    this.app.emit("commands", undefined);
  }

  /*
    The same track again after a change that replaces its world (Special > Enlarge World, whose OnUpdate drops
    the undo, the brush and the selections and re-keys every cache on the new N): every listener takes it as
    newly opened, but it keeps its file and is marked modified.
  */
  reopen(): void {
    const doc = this.doc;
    if (!doc) return;
    this.emit("opened", doc);
    this.modified = !doc.viewOnly;
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

  /**
    File > New; `mode` is File > New's terrain grid (OnNewDocument with m_newTerrainMode), `cells`
    the world size (256, or 512: version 6 only) and `kind` the track kind (track-kind.ts; absent: Classic at 256,
    Standard V6 at 512).
  */
  /*
    TraxxDoc.cpp OnNewDocument: when a 512 x 512 world cannot be had (SetTrackKind fails), the new track is the
    256 one of the same kind, and the caller says so (NEW_512_NO_MEMORY); `shrunk` is then true. In a browser
    the failure is an allocation that throws (a RangeError, in the worker or here).
  */
  async newTrack(mode = TERRAINMODE_CLASSIC8, cells = 256, kind?: TrackKind): Promise<{ shrunk: boolean }> {
    const make = async (n: number) => {
      const doc = await this.worker.call<TrackDocument>("doc.new", n === 256 && !kind ? undefined : { cells: n, kind });
      if (mode !== TERRAINMODE_CLASSIC8) setMode(doc.track, mode);
      return doc;
    };
    let doc: TrackDocument;
    let shrunk = false;
    try {
      doc = await make(cells);
    } catch (err) {
      if (cells === 256 || !isAllocationFailure(err)) throw err;
      doc = await make(256);
      shrunk = true;
    }
    this.set(doc, null);
    return { shrunk };
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
    if (this.doc.viewOnly) throw new Error("A POD opened with View POD is read-only. Use File > Edit This Track to edit it.");
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

  /** Extract Models and Art (OnEditExtract): the files written and the conflict lines (core/doc/extract-art.ts). */
  async extract(): Promise<ExtractReply> {
    if (!this.viewedPod || !this.doc?.viewOnly) throw new Error("Extract works on a POD opened with View POD.");
    return this.worker.call<ExtractReply>("art.extract", { source: this.viewedPod });
  }

  /*
    File > Edit This Track (Traxx origin/main CTraxxDoc::OnFileEditTrack): the viewed pod becomes an
    editable, unsaved track, as if it had been cloned. The art and models are copied out first
    (never replacing a file; a model whose .BIN in the folder differs is read from the folder), then
    the track is converted in memory (core/doc/edit-this-track.ts). Afterwards: not view-only, no
    file (Save asks for a .TXX name), modified, undo empty, no lake message again. Resolves with the
    new stem and the conflict lines; throws EditThisTrackError with Traxx's message on a failure,
    the track then still only being viewed.
  */
  async editThisTrack(): Promise<{ prefix: string; report: string[] }> {
    const doc = this.doc;
    if (!this.viewedPod || !doc?.viewOnly) throw new Error("Edit This Track works on a POD opened with View POD.");
    let r: ExtractReply;
    try {
      r = await this.worker.call<ExtractReply>("art.extract", {
        source: this.viewedPod, readConflicts: true, models: doc.models.map((m) => m.name), modelTextures: doc.modelTextures.map((t) => t.name),
      });
    } catch {
      throw new EditThisTrackError(EDIT_THIS_TRACK_COPY_FAILED);
    }
    // The extract may have read models again from the Models folder: the track shows those (and packs their .SRF).
    for (const { model, textures } of r.reloaded) {
      const k = doc.models.findIndex((m) => m.name.toUpperCase() === model.name.toUpperCase());
      if (k >= 0) doc.models[k] = model;
      for (const t of textures) if (!doc.modelTextures.some((x) => x.name.toUpperCase() === t.name.toUpperCase())) doc.modelTextures.push(t);
    }
    for (const { name, srf } of r.sources) {
      const m = doc.models.find((x) => x.name.toUpperCase() === name.toUpperCase());
      if (m && srf) m.srf = srf;
    }
    const why = makeEditableFromView(doc, r.entries);
    if (why) {
      this.set(doc, null);
      throw new EditThisTrackError(editThisTrackRefusal(why));
    }
    // The POD's own palette stays the track's palette (see markCustomPalette).
    markCustomPalette(doc.track);
    doc.source = { kind: "clone", fileName: this.viewedPod.name };
    this.viewedPod = null;
    this.set(doc, null);
    this.modified = true;
    this.emitTitle();
    return { prefix: doc.track.prefix, report: r.report };
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
