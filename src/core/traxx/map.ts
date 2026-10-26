/*
  The terrain map in View Controls (CTraxxView::UpdateMapBuffer): 64 x 64, every fourth cell's
  height / 8 as one of 31 greys ((i << 3) + 3, matched in the track palette), the main course's
  segment starts marked (the first green, the rest red), north up.
*/
import { remapIndices } from "./palette.ts";

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
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) cell[i + (j << 6)] = heights[(i << 2) + (j << 10)] >> 3;
  const marks = new Map<number, number>();
  courseStarts.forEach(([x, y], s) => {
    const mx = x >> 8, my = y >> 8;
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
