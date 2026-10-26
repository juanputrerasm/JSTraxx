/*
  Recording changes. Two kinds cover every edit:

    a grid patch  a rectangle of a 256 x 256 grid (heights, CLR words), copied before and
                  after; small, so terrain brushes and texture paint cost little;
    a snapshot    named fields of an object (the track's boxes, courses, trucks, ground
                  boxes...), deep-copied before and after.

  Both are taken around the edit: start recording, make the change, finish. For a drag the
  start is taken on the press and the finish on the release, so the whole drag is one step.
*/
import type { Change, Rect, Touch } from "./history.ts";

type Grid = Uint8Array | Uint16Array;

function copyRect(grid: Grid, r: Rect): Grid {
  const w = r.maxX - r.minX + 1, h = r.maxY - r.minY + 1;
  const out = new (grid.constructor as { new (n: number): Grid })(w * h);
  for (let j = 0; j < h; j++) out.set(grid.subarray(r.minX + (r.minY + j) * 256, r.minX + (r.minY + j) * 256 + w), j * w);
  return out;
}

function pasteRect(grid: Grid, r: Rect, data: Grid): void {
  const w = r.maxX - r.minX + 1, h = r.maxY - r.minY + 1;
  for (let j = 0; j < h; j++) grid.set(data.subarray(j * w, (j + 1) * w), r.minX + (r.minY + j) * 256);
}

export function clampRect(r: Rect, max = 255): Rect {
  return { minX: Math.max(0, Math.min(max, r.minX)), minY: Math.max(0, Math.min(max, r.minY)), maxX: Math.max(0, Math.min(max, r.maxX)), maxY: Math.max(0, Math.min(max, r.maxY)) };
}

export interface Recording { finish(label?: string): Change | null }

/** Start recording a rectangle of a grid. `touch` names what changes there. */
export function recordGrid(grid: Grid, rect: Rect, label: string, touch: (r: Rect) => Touch): Recording {
  const r = clampRect(rect);
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
