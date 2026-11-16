/*
  The terrain map in View Controls (CTraxxView::UpdateMapBuffer): 64 x 64, every fourth cell's
  height / 8 as one of 31 greys ((i << 3) + 3, matched in the track palette), the main course's
  segment starts marked (the first green, the rest red), north up.

  Track format version 6 (spec sections 8.1 and 10 item 8, the overhead map): a world of N cells
  keeps the 64 x 64 map, every (N / 64)th cell, so a 512-cell world shows all of itself at half
  the detail. N comes from the heights (N x N).
*/
import { remapIndices } from "./palette.ts";
import { cellShiftOf, sideOf } from "./world.ts";

export interface MapImage { width: 64; height: 64; rgba: Uint8ClampedArray }

export function terrainMap(heights: Uint8Array, palette: Uint8Array, courseStarts: readonly [number, number][]): MapImage {
  // BestMatch for each grey and the two marker colours, through the same nearest-colour rule.
  const wanted = new Uint8Array(768);
  for (let i = 0; i < 32; i++) wanted.set([(i << 3) + 3, (i << 3) + 3, (i << 3) + 3], i * 3);
  wanted.set([0, 255, 0], 32 * 3);
  wanted.set([255, 0, 0], 33 * 3);
  const match = remapIndices(Uint8Array.from({ length: 34 }, (_, i) => i), wanted, palette);
  const colour = (k: number) => [palette[match[k] * 3], palette[match[k] * 3 + 1], palette[match[k] * 3 + 2]];
  const cell = new Uint8Array(64 * 64);
  const n = sideOf(heights.length), shift = cellShiftOf(n), every = n >> 6;
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) cell[i + (j << 6)] = heights[i * every + j * every * n] >> 3;
  const marks = new Map<number, number>();
  courseStarts.forEach(([x, y], s) => {
    // ipos (64 a cell) to map pixels (N / 64 cells each): x * 64 / (64 N) = x >> log2 N.
    const mx = x >> shift, my = y >> shift;
    if (mx >= 0 && mx < 64 && my >= 0 && my < 64) marks.set(mx + (my << 6), s === 0 ? 32 : 33);
  });
  const rgba = new Uint8ClampedArray(64 * 64 * 4);
  for (let j = 0; j < 64; j++) {
    for (let i = 0; i < 64; i++) {
      const src = i + (j << 6);
      // A bottom-up DIB: grid row 0 is the bottom of the map.
      const dst = (i + ((63 - j) << 6)) * 4;
      const [r, g, b] = colour(marks.get(src) ?? cell[src]);
      rgba[dst] = r; rgba[dst + 1] = g; rgba[dst + 2] = b; rgba[dst + 3] = 255;
    }
  }
  return { width: 64, height: 64, rgba };
}
