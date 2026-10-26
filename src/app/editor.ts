/*
  The editor: the open track's undo history, the per-mode selections, the clipboard, and the
  edit mode handlers the view's mouse and keys go to. CTraxxView's editing half.

  Edits are made on the document in place, recorded (core/edit/record.ts) and pushed here;
  listeners refresh what each change touched. A POD opened with View POD takes no edits, as
  Traxx's view ignores the mouse when viewonly.
*/
import { Emitter } from "../shared/emitter.ts";
import type { TrackDocument } from "../core/doc/document.ts";
import type { EditMode } from "../core/settings.ts";
import { History, group, type Change, type Touch } from "../core/edit/history.ts";
import { ObjectSelection } from "../core/edit/object-selection.ts";
import type { Recording } from "../core/edit/record.ts";
import type { MenuItem } from "../ui/shell/commands.ts";
import type { ContextMenuOptions } from "../ui/shell/context-menu.ts";
import type { AppState } from "./state.ts";
import type { DocumentService } from "./document-service.ts";

/** A pointer position in the view: pixels from its top left, and the modifier keys. */
export interface ViewPoint {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** What a mode answers a right-click with. */
export interface ContextMenuRequest { items: MenuItem[]; options?: ContextMenuOptions }

/** One edit mode's handling of the view (CTraxxView's per-mode switch cases). */
export interface ModeHandler {
  /** Entered and left (the mode toolbar). */
  activate?(): void;
  deactivate?(): void;
  /** The pointer moved with no button down. */
  hover?(p: ViewPoint): void;
  /** Left button pressed, dragged, released; double-clicked. */
  down?(p: ViewPoint): void;
  drag?(p: ViewPoint): void;
  up?(p: ViewPoint): void;
  dblclick?(p: ViewPoint): void;
  contextMenu?(p: ViewPoint): ContextMenuRequest | null;
  /** A key in the view. Return true when the mode used it. */
  keyDown?(e: KeyboardEvent): boolean;
  keyUp?(e: KeyboardEvent): boolean;
  /** The Textures window's Apply (TX_APPLYTEXTURE): Textures and Ground Boxes modes only. */
  applyTexture?(index: number): void;
  /** Edit > Copy and Paste for this mode (OnEditCopy, OnEditPaste). */
  copy?(): void;
  paste?(p: ViewPoint | null): void;
  canCopy?(): boolean;
  canPaste?(): boolean;
  /** Screen marks for this mode (the 2D overlay). */
  drawOverlay?(g: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => { x: number; y: number } | null): void;
  /** The "Sel" indicator text. */
  selectionText?(): string;
}

export interface EditorEvents extends Record<string, unknown> {
  /** A change was made, undone or redone. */
  changed: Touch;
  /** A selection or hover changed: redraw the overlay. */
  selection: void;
  /** The texture picked in the Textures window changed. */
  texture: number;
}

export class Editor extends Emitter<EditorEvents> {
  readonly history = new History();
  readonly objects = new ObjectSelection();
  /** What each mode copied (Traxx keeps one per mode). */
  readonly clipboard: Partial<Record<"terrain" | "texture" | "object" | "groundBox", unknown>> = {};
  private handlers = new Map<EditMode, ModeHandler>();
  private app: AppState;
  private docs: DocumentService;
  /**
    Actions the modes offer to the windows (the Models window's Apply goes to the Objects mode),
    by name.
  */
  readonly actions: Record<string, (...args: never[]) => unknown> = {};
  /** The texture picked in the Textures window (texturedlg->GetSelection()), or -1. */
  selectedTexture = -1;
  /** The last pointer position in the view, for pasting where the mouse is. */
  lastPoint: ViewPoint | null = null;

  constructor(app: AppState, docs: DocumentService) {
    super();
    this.app = app;
    this.docs = docs;
    docs.on("opened", () => {
      this.history.clear();
      this.objects.select(-1);
      this.selectedTexture = -1;
      this.objects.clear();
      this.emit("selection", undefined);
      app.emit("commands", undefined);
    });
    let current: EditMode = app.mode;
    app.on("mode", (m) => {
      this.handlers.get(current)?.deactivate?.();
      current = m;
      this.handlers.get(m)?.activate?.();
      this.updateSel();
      this.emit("selection", undefined);
    });
  }

  get doc(): TrackDocument | null {
    return this.docs.doc;
  }

  /** Edits are allowed: a track is open and it is not a viewed POD. */
  get canEdit(): boolean {
    return Boolean(this.docs.doc && !this.docs.doc.viewOnly);
  }

  register(mode: EditMode, handler: ModeHandler): void {
    this.handlers.set(mode, handler);
  }

  get handler(): ModeHandler | undefined {
    return this.handlers.get(this.app.mode);
  }

  /** Push a finished recording (or change), mark the track modified and refresh what it touched. */
  commit(change: Change | Recording | null, label?: string): Change | null {
    const c = change && "finish" in change ? change.finish(label) : change;
    if (!c) return null;
    this.history.push(c);
    this.docs.markModified();
    this.emit("changed", c.touch);
    this.app.emit("commands", undefined);
    return c;
  }

  /** Several recordings as one undo step. */
  commitAll(label: string, recordings: (Recording | Change | null)[]): Change | null {
    const changes = recordings.map((r) => (r && "finish" in r ? r.finish() : r)).filter((c): c is Change => c !== null);
    if (!changes.length) return null;
    return this.commit(changes.length === 1 ? { ...changes[0], label } : group(label, changes));
  }

  undo(): void {
    const c = this.history.undo();
    if (c) this.afterHistory(c);
  }

  redo(): void {
    const c = this.history.redo();
    if (c) this.afterHistory(c);
  }

  private afterHistory(c: Change): void {
    this.docs.setModified(!this.history.atSavePoint);
    this.emit("changed", c.touch);
    this.emit("selection", undefined);
    this.app.emit("commands", undefined);
  }

  /** The track was saved. */
  saved(): void {
    this.history.markSaved();
  }

  selectTexture(index: number): void {
    if (index === this.selectedTexture) return;
    this.selectedTexture = index;
    this.emit("texture", index);
    this.app.emit("commands", undefined);
  }

  /** Redraw the marks and the "Sel" indicator. */
  selectionChanged(): void {
    this.updateSel();
    this.emit("selection", undefined);
  }

  private updateSel(): void {
    this.app.setIndicators({ sel: this.handler?.selectionText?.() ?? "" });
  }
}
