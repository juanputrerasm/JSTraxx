/*
  Recording changes. Two kinds cover every edit:

    a grid patch  a rectangle of an N x N grid (heights, CLR words; N = 256, or 512 in a track
                  format version 6 world, told by the grid's length), copied before and
                  after; small, so terrain brushes and texture paint cost little;
    a snapshot    named fields of an object (the track's boxes, courses, trucks, ground
                  boxes...), deep-copied before and after.

  Both are taken around the edit: start recording, make the change, finish. For a drag the
  start is taken on the press and the finish on the release, so the whole drag is one step.
*/
import type { Change, Rect, Touch } from "./history.ts";
import { sideOf } from "../traxx/world.ts";

/** A grid of cells: bytes, words, or the 32-bit heights of a version 6 track (world.ts). */
type Grid = Uint8Array | Uint16Array | Int32Array;

function copyRect(grid: Grid, r: Rect): Grid {
  const w = r.maxX - r.minX + 1, h = r.maxY - r.minY + 1;
  const n = sideOf(grid.length);
  const out = new (grid.constructor as { new (n: number): Grid })(w * h);
  for (let j = 0; j < h; j++) {
    const row = r.minX + (r.minY + j) * n;
    for (let i = 0; i < w; i++) out[j * w + i] = grid[row + i]!;
  }
  return out;
}

function pasteRect(grid: Grid, r: Rect, data: Grid): void {
  const w = r.maxX - r.minX + 1, h = r.maxY - r.minY + 1;
  const n = sideOf(grid.length);
  for (let j = 0; j < h; j++) {
    const row = r.minX + (r.minY + j) * n;
    for (let i = 0; i < w; i++) grid[row + i] = data[j * w + i]!;
  }
}

export function clampRect(r: Rect, max = 255): Rect {
  return { minX: Math.max(0, Math.min(max, r.minX)), minY: Math.max(0, Math.min(max, r.minY)), maxX: Math.max(0, Math.min(max, r.maxX)), maxY: Math.max(0, Math.min(max, r.maxY)) };
}

export interface Recording { finish(label?: string): Change | null }

/** Start recording a rectangle of a grid. `touch` names what changes there. */
export function recordGrid(grid: Grid, rect: Rect, label: string, touch: (r: Rect) => Touch): Recording {
  const r = clampRect(rect, sideOf(grid.length) - 1);
  const before = copyRect(grid, r);
  return {
    finish(finalLabel = label) {
      const after = copyRect(grid, r);
      let same = true;
      for (let i = 0; i < after.length && same; i++) same = after[i] === before[i];
      if (same) return null;
      return { label: finalLabel, touch: touch(r), undo: () => pasteRect(grid, r, before), redo: () => pasteRect(grid, r, after) };
    },
  };
}

/*
  Start recording a w x h window of a size x size grid whose corner (x0, y0) may lie off the map:
  coordinates wrap (size is a power of two), as a Full Map's surface and its brush do
  (ApplyStamp16 with wrap). Only the window is kept, so an 8 ft stroke does not cost a 2 MB
  snapshot per undo step (Traxx keeps one level, a whole copy: TraxxUndo's gridfine).
*/
export function recordWindow(grid: Grid, size: number, x0: number, y0: number, w: number, h: number, label: string, touch: Touch): Recording {
  const mask = size - 1;
  w = Math.max(0, Math.min(size, w));
  h = Math.max(0, Math.min(size, h));
  const read = (): Grid => {
    const out = new (grid.constructor as { new (n: number): Grid })(w * h);
    for (let j = 0; j < h; j++) {
      const row = ((y0 + j) & mask) * size;
      for (let i = 0; i < w; i++) out[j * w + i] = grid[row + ((x0 + i) & mask)]!;
    }
    return out;
  };
  const write = (data: Grid) => {
    for (let j = 0; j < h; j++) {
      const row = ((y0 + j) & mask) * size;
      for (let i = 0; i < w; i++) grid[row + ((x0 + i) & mask)] = data[j * w + i]!;
    }
  };
  const before = read();
  return {
    finish(finalLabel = label) {
      const after = read();
      let same = true;
      for (let i = 0; i < after.length && same; i++) same = after[i] === before[i];
      if (same) return null;
      return { label: finalLabel, touch, undo: () => write(before), redo: () => write(after) };
    },
  };
}

/** Start recording fields of an object; finish compares and makes the change. */
export function recordFields<T extends object, K extends keyof T>(target: T, keys: readonly K[], label: string, touch: Touch): Recording {
  const before = keys.map((k) => structuredClone(target[k]));
  return {
    finish(finalLabel = label) {
      const after = keys.map((k) => structuredClone(target[k]));
      if (equalValues(before, after)) return null;
      const put = (values: unknown[]) => keys.forEach((k, i) => { target[k] = structuredClone(values[i]) as T[K]; });
      return { label: finalLabel, touch, undo: () => put(before), redo: () => put(after) };
    },
  };
}

/** Deep equality for the plain data a track holds (arrays, typed arrays, objects, numbers, strings). */
export function equalValues(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return Number.isNaN(a) && Number.isNaN(b as number);
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const x = a as unknown as ArrayLike<number>, y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!equalValues((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}
