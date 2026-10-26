/*
  Undo and redo. Traxx keeps one level, for terrain and textures only (TraxxUndo in
  TraxxView.h); JSTraxx keeps many, for every mode, which does everything Traxx's does and
  more.

  A change is recorded after it is made: it knows how to put the track back (undo) and how to
  do it again (redo), and what it touched, so the view refreshes only that. A drag or a
  multi-step operation is one change (a group). The save point lets an undo back to the saved
  state clear the "modified" mark.
*/

export interface Rect { minX: number; minY: number; maxX: number; maxY: number }

/** What a change touched, for the view and the panels. */
export interface Touch {
  /** Heights changed in these cells (inclusive). */
  heights?: Rect;
  /** CLR words changed in these cells. */
  clr?: Rect;
  objects?: boolean;
  groundBoxes?: boolean;
  course?: boolean;
  trucks?: boolean;
  /** The texture list or its art. */
  textures?: boolean;
  models?: boolean;
  palette?: boolean;
  water?: boolean;
  /** Anything else on the track record (names, components). */
  track?: boolean;
}

export interface Change {
  label: string;
  undo(): void;
  redo(): void;
  touch: Touch;
}

export function mergeTouch(a: Touch, b: Touch): Touch {
  const rect = (x?: Rect, y?: Rect): Rect | undefined => (!x ? y : !y ? x : {
    minX: Math.min(x.minX, y.minX), minY: Math.min(x.minY, y.minY), maxX: Math.max(x.maxX, y.maxX), maxY: Math.max(x.maxY, y.maxY),
  });
  const out: Touch = { ...a, ...b };
  out.heights = rect(a.heights, b.heights);
  out.clr = rect(a.clr, b.clr);
  for (const k of ["objects", "groundBoxes", "course", "trucks", "textures", "models", "palette", "water", "track"] as const) out[k] = Boolean(a[k] || b[k]) || undefined;
  return out;
}

/** Several changes as one: undone last first. */
export function group(label: string, changes: Change[]): Change {
  const touch = changes.reduce<Touch>((t, c) => mergeTouch(t, c.touch), {});
  return {
    label,
    touch,
    undo: () => { for (let i = changes.length - 1; i >= 0; i--) changes[i].undo(); },
    redo: () => { for (const c of changes) c.redo(); },
  };
}

export class History {
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];
  /** How many changes deep the saved state is, or -1 when it can no longer be reached. */
  private savedAt = 0;
  readonly limit: number;

  constructor(limit = 200) {
    this.limit = limit;
  }

  push(change: Change): void {
    this.undoStack.push(change);
    if (this.savedAt > this.undoStack.length - 1) this.savedAt = -1;
    this.redoStack = [];
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
      if (this.savedAt >= 0) this.savedAt--;
    }
  }

  undo(): Change | null {
    const c = this.undoStack.pop();
    if (!c) return null;
    c.undo();
    this.redoStack.push(c);
    return c;
  }

  redo(): Change | null {
    const c = this.redoStack.pop();
    if (!c) return null;
    c.redo();
    this.undoStack.push(c);
    return c;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoLabel(): string | null { return this.undoStack[this.undoStack.length - 1]?.label ?? null; }
  get redoLabel(): string | null { return this.redoStack[this.redoStack.length - 1]?.label ?? null; }

  /** The track was saved: this is the clean state. */
  markSaved(): void { this.savedAt = this.undoStack.length; }
  get atSavePoint(): boolean { return this.savedAt === this.undoStack.length; }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.savedAt = 0;
  }
}
