/*
  The world's size and the height store of MTM2 track format version 6
  (openmtm2.github.io/proposals/track-format-v6.md, sections 6, 7.3 and 8).

  Traxx 1.7.1 has one world, 256 x 256 cells of 32 ft, and heights of 0..512 ft. Format
  version 6 lets a track have N = 256 or 512 cells a side (worldCells) and heights anywhere a
  step and base can put them. Everything that is a grid in the editor follows N:

    cell index        x + z * N              (x + (z << 8) when N = 256)
    cell wrap         & (N - 1)
    fine (8 ft) grid  4N a side, & (4N - 1)
    world side        W = 32 N ft, 64 N ipos (an ipos is half a foot), 16384 N in 1/256 ipos

  Heights stay in v units, 1/128 ft (1/256 of Traxx's 2 ft step), as Traxx 1.7 keeps them. A
  track whose heights fit CP4 (0 <= v <= 65535) keeps them in a Uint16Array, exactly as Traxx
  does; a version 6 track keeps them in an Int32Array (the spec's RECOMMENDED 32-bit store at
  1/128 ft, section 7.3), so negative heights and tall tracks survive. A tool clamps to the
  range of the store it writes (heightLimits).
*/

/** Cells a side of the retail world, and of every track that is not version 6. */
export const WORLD_CELLS_CLASSIC = 256;
/** The worldCells values a version 6 track may have (spec section 6). */
export const WORLD_CELLS_CHOICES = [256, 512] as const;
export type WorldCells = (typeof WORLD_CELLS_CHOICES)[number];

/** A height grid in v units (1/128 ft): Uint16Array for a CP4-range track, Int32Array for version 6. */
export type HeightGrid = Uint16Array | Int32Array;

/** The lowest and highest v an Int32Array store holds: base -32768 ft, base 32767 + 65535 ft at step 1. */
export const V6_V_MIN = -32768 * 128;
export const V6_V_MAX = (32767 + 65535) * 128;

/** Anything that knows its world size; absent means the retail 256. */
export interface HasWorld {
  worldCells?: number;
}

/** N: the cells a side of a track (256 when it does not say). */
export function cellsOf(t: HasWorld | null | undefined): number {
  const n = t?.worldCells;
  return n === 512 ? 512 : 256;
}

/** log2 N: the shift of a row (8 for 256, 9 for 512). */
export function cellShiftOf(n: number): number {
  return n === 512 ? 9 : 8;
}

/** The side of a square grid of `length` cells. */
export function sideOf(length: number): number {
  return Math.round(Math.sqrt(length));
}

/** W, the world's side in feet (8192 or 16384). */
export function worldFtOf(n: number): number {
  return 32 * n;
}

/** The world's side in ipos (half feet): 64 per cell. */
export function worldIposOf(n: number): number {
  return 64 * n;
}

/** A grid of v heights of `length` cells: 32-bit when `wide`. */
export function newHeightGrid(length: number, wide: boolean): HeightGrid {
  return wide ? new Int32Array(length) : new Uint16Array(length);
}

/** A copy of `g` in a store of the same kind, or 32-bit when `wide`. */
export function heightGridLike(g: HeightGrid, length = g.length, wide = g instanceof Int32Array): HeightGrid {
  return newHeightGrid(length, wide);
}

/** Whether a grid is the version 6 32-bit store. */
export function isWideGrid(g: HeightGrid | null | undefined): g is Int32Array {
  return g instanceof Int32Array;
}

/** The v range a store holds: 0..65535 for Uint16Array (CP4), the version 6 range for Int32Array. */
export function heightLimits(g: HeightGrid | null | undefined): [number, number] {
  return g instanceof Int32Array ? [V6_V_MIN, V6_V_MAX] : [0, 65535];
}

/** `v` clamped to what `g` holds, truncated as Traxx's (int) casts do. */
export function clampHeight(g: HeightGrid | null | undefined, v: number): number {
  const [lo, hi] = heightLimits(g);
  return v < lo ? lo : v > hi ? hi : Math.trunc(v);
}

/** A grid as u16 samples for the CP4 code paths (spline, 16-bit writers), clamped to 0..65535. */
export function asU16(g: HeightGrid): Uint16Array {
  if (g instanceof Uint16Array) return g;
  const out = new Uint16Array(g.length);
  for (let i = 0; i < g.length; i++) { const v = g[i]!; out[i] = v < 0 ? 0 : v > 65535 ? 65535 : v; }
  return out;
}

/** The lowest and highest v of a grid; [0, 0] when empty. */
export function heightRange(g: ArrayLike<number>): [number, number] {
  if (g.length === 0) return [0, 0];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < g.length; i++) { const v = g[i]!; if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

/** Whether every height of a grid fits CP4's 16-bit 0..65535 v (0 to just under 512 ft). */
export function fitsCp4(g: ArrayLike<number>): boolean {
  const [lo, hi] = heightRange(g);
  return lo >= 0 && hi <= 65535;
}
