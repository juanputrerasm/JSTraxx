/*
  Terrain editing, as Traxx does it (Traxx/TraxxViewEdit.cpp):

    MakeEditGrid    the brush: a grid of height offsets for the tool, size, orientation,
                    curvature and altitude
    ApplyEditGrid   the brush laid on the heights around a vertex
    OnTerrainCopy / OnTerrainPaste, OnTerrainRaiseLower (Adjust Terrain Heights),
    OnTerrainCopyBitmap / OnTerrainPasteBitmap

  Tools: 0 Platform (Raise), 1 Hill, 2 Wedge (Slope), 3 Mound, 4 Bumps, 5 Smooth, 6 Plane,
  7 Direct Edit. Float maths is single precision, as Traxx's; its rounding (ROUNDF, which adds
  0.499 and truncates) is kept.
*/
import { interpolateRawAtPoint } from "../traxx/terrain.ts";

export const MAX_TERRAIN_SZ = 40;
const f = Math.fround;

/** ROUNDF: (int)(q - 0.499) for negatives, (int)(q + 0.499) otherwise; NaN reads as 0. */
function roundf(q: number): number {
  if (Number.isNaN(q)) return 0;
  return q < 0 ? Math.trunc(f(q - 0.499)) : Math.trunc(f(q + 0.499));
}

export interface BrushParams {
  tool: number;
  /** The Width and Height spins (before rotation). */
  width: number;
  height: number;
  /** Orientation 0..7, eighths of a turn. */
  orientation: number;
  /** Curvature 0..6; 3 is none. */
  curvature: number;
  /** The Altitude spin (terrainz). */
  altitude: number;
}

export interface EditGrid {
  /** The grid's size after rotation. */
  width: number;
  height: number;
  /** Offsets, row by row: grid[j * width + i]. */
  grid: Int16Array;
}

/** MakeEditGrid. `random` stands in for rand() (0..1), for Bumps. */
export function makeEditGrid(p: BrushParams, random: () => number = Math.random): EditGrid {
  const arg = (Math.PI * p.orientation) / 4;
  const sinarg = f(10 * f(Math.sin(arg)));
  const cosarg = f(10 * f(Math.cos(arg)));
  let width = Math.trunc(Math.trunc(f(Math.abs(f(cosarg * p.width)) + Math.abs(f(sinarg * p.height)))) / 10);
  let height = Math.trunc(Math.trunc(f(Math.abs(f(sinarg * p.width)) + Math.abs(f(cosarg * p.height)))) / 10);
  width = Math.min(width, MAX_TERRAIN_SZ - 1);
  height = Math.min(height, MAX_TERRAIN_SZ - 1);
  const halfwidth = (width - 1) >> 1, halfheight = (height - 1) >> 1;
  const _halfwidth = (p.width - 1) >> 1, _halfheight = (p.height - 1) >> 1;
  const fpixel = f(p.altitude);
  const N = 10 * MAX_TERRAIN_SZ;
  const bellx = new Float32Array(N), belly = new Float32Array(N);
  switch (p.tool) {
    case 1:
      bellx[0] = belly[0] = fpixel;
      for (let i = 1; i < N; i++) {
        bellx[i] = f(fpixel * f(Math.exp(f(f(-0.09 * i * i) / (_halfwidth * _halfwidth)))));
        belly[i] = f(fpixel * f(Math.exp(f(f(-0.09 * i * i) / (_halfheight * _halfheight)))));
      }
      break;
    case 3:
      bellx[0] = fpixel;
      for (let i = 1; i < N; i++) bellx[i] = f(fpixel * f(Math.exp(f(f(-0.06 * i * i) / (_halfwidth * _halfwidth)))));
      break;
    case 4:
      for (let i = 0; i < N; i++) bellx[i] = f(f(fpixel * Math.trunc(random() * 256)) / 255);
      break;
  }
  const power = [0.2, 0.5, 0.75, 1, 1.4, 2, 3][p.curvature] ?? 1;
  const grid = new Int16Array(Math.max(0, width * height));
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const roti = f(f(cosarg * (i - halfwidth)) - f(sinarg * (j - halfheight)));
      const rotj = f(f(sinarg * (i - halfwidth)) + f(cosarg * (j - halfheight)));
      let ii = 10 * halfwidth + roundf(roti);
      const jj = 10 * halfheight + roundf(rotj);
      let fval = 0;
      const bii = Math.min(N - 1, Math.abs(ii - 10 * halfwidth));
      const bjj = Math.min(N - 1, Math.abs(jj - 10 * halfheight));
      switch (p.tool) {
        case 0: fval = f(p.altitude); break;
        case 1: fval = f((fpixel < 0 ? -1 : 1) * f(Math.sqrt(f(bellx[bii] * belly[bjj])))); break;
        case 2:
          ii = 10 * _halfwidth + roundf(roti);
          fval = f(f(f(0.1 * fpixel) * ii) / p.width);
          if (fval < 0) fval = 0;
          break;
        case 3: fval = bellx[bii]; break;
        // Traxx indexes `(i + j*w) % 10*MAXTERRAINSZ`: the remainder of ten, times forty.
        case 4: fval = bellx[((i + j * width) % 10) * MAX_TERRAIN_SZ]; break;
      }
      // Clip at the bounds of the unrotated rectangle.
      if (bii > 10 * (_halfwidth + 1) || bjj > 10 * (_halfheight + 1)) fval = 0;
      if (p.curvature !== 3 && p.tool !== 0 && p.tool !== 5 && p.tool !== 7) {
        fval = f(fval / fpixel);
        fval = f(fpixel * f(Math.pow(fval, power)));
      }
      // terraingrid is short.
      grid[j * width + i] = roundf(fval);
    }
  }
  return { width, height, grid };
}

/** The cells a brush covers around vertex (gi, gj), inclusive and clamped to the map. */
export function brushRect(width: number, height: number, gi: number, gj: number): { minX: number; minY: number; maxX: number; maxY: number } {
  const hw = (width - 1) >> 1, hh = (height - 1) >> 1;
  return { minX: Math.max(0, gi - hw), minY: Math.max(0, gj - hh), maxX: Math.min(255, gi - hw + width - 1), maxY: Math.min(255, gj - hh + height - 1) };
}

/*
  ApplyEditGrid at vertex (gi, gj). Smooth averages each inner point's four neighbours from the
  heights as they were before; Plane sets the altitude (0 for a negative one); Direct Edit
  adds the altitude to one point, held to 0..255; the rest add the brush, held to 2..255.
*/
export function applyEditGrid(heights: Uint8Array, eg: EditGrid, p: BrushParams, gi: number, gj: number): void {
  const w = p.tool === 7 ? 1 : eg.width, h = p.tool === 7 ? 1 : eg.height;
  const hw = (w - 1) >> 1, hh = (h - 1) >> 1;
  if (p.tool === 5) {
    const before = heights.slice();
    for (let j = 1; j < h - 1; j++) {
      const jg = j + gj - hh;
      if (jg < 1 || jg > 254) continue;
      for (let i = 1; i < w - 1; i++) {
        const ig = i + gi - hw;
        if (ig < 1 || ig > 254) continue;
        const c = ig + (jg << 8);
        heights[c] = (before[c + 256] + before[c - 256] + before[c + 1] + before[c - 1]) >> 2;
      }
    }
    return;
  }
  const z = p.altitude;
  for (let j = 0; j < h; j++) {
    const jg = j + gj - hh;
    if (jg < 0 || jg > 255) continue;
    for (let i = 0; i < w; i++) {
      const ig = i + gi - hw;
      if (ig < 0 || ig > 255) continue;
      const c = ig + (jg << 8);
      if (p.tool === 7) heights[c] = z > 0 ? Math.min(255, heights[c] + z) : Math.max(0, heights[c] + z);
      else if (p.tool === 6) heights[c] = z > 0 ? Math.min(255, z) : 0;
      else heights[c] = Math.min(255, Math.max(2, heights[c] + eg.grid[j * eg.width + i]));
    }
  }
}

/*
  The heights the overlay shows for the brush at (gi, gj) (OverlayTerrainGrid): what each
  point would become; -1 off the map.
*/
export function previewHeights(heights: Uint8Array, eg: EditGrid, p: BrushParams, gi: number, gj: number): Int16Array {
  const w = p.tool === 7 ? 1 : eg.width, h = p.tool === 7 ? 1 : eg.height;
  const hw = (w - 1) >> 1, hh = (h - 1) >> 1;
  const out = new Int16Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const ig = i + gi - hw, jg = j + gj - hh;
      let v: number;
      if (ig < 0 || ig > 255 || jg < 0 || jg > 255) v = 0;
      else if (p.tool === 6) v = p.altitude > 0 ? p.altitude : 1;
      else if (p.tool === 5) {
        v = j > 0 && j < eg.height - 1 && i > 0 && i < eg.width - 1 && jg > 0 && jg < 255 && ig > 0 && ig < 255
          ? (heights[ig + 1 + (jg << 8)] + heights[ig - 1 + (jg << 8)] + heights[ig + ((jg + 1) << 8)] + heights[ig + ((jg - 1) << 8)]) >> 2
          : heights[ig + (jg << 8)];
      } else v = Math.min(255, Math.max(0, heights[ig + (jg << 8)] + (p.tool === 7 ? 0 : eg.grid[j * eg.width + i])));
      out[j * w + i] = v;
    }
  }
  return out;
}

/** OnTerrainCopy: the heights under a w x h brush at (gi, gj); -1 where off the map. */
export interface TerrainBlock { width: number; height: number; data: Int16Array }

export function copyTerrain(heights: Uint8Array, width: number, height: number, gi: number, gj: number): TerrainBlock {
  const hw = (width - 1) >> 1, hh = (height - 1) >> 1;
  const data = new Int16Array(width * height).fill(-1);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const ig = i + gi - hw, jg = j + gj - hh;
    if (ig >= 0 && ig <= 255 && jg >= 0 && jg <= 255) data[j * width + i] = heights[ig + (jg << 8)];
  }
  return { width, height, data };
}

/*
  OnTerrainPaste: the block centred on (gi, gj). Traxx's loop swaps the block's width and
  height, which garbles any block that is not square; this pastes it as it was copied.
*/
export function pasteTerrain(heights: Uint8Array, block: TerrainBlock, gi: number, gj: number): void {
  const hw = (block.width - 1) >> 1, hh = (block.height - 1) >> 1;
  for (let j = 0; j < block.height; j++) for (let i = 0; i < block.width; i++) {
    const v = block.data[j * block.width + i];
    const ig = i + gi - hw, jg = j + gj - hh;
    if (v >= 0 && ig >= 0 && ig <= 255 && jg >= 0 && jg <= 255) heights[ig + (jg << 8)] = v;
  }
}

/* CRaiseLowerDlg's rules. */
export function effectiveIncrement(inc: number, min: number, max: number, avoidClip: boolean): number {
  if (avoidClip) {
    if (min + inc < 0) inc = -min;
    if (max + inc > 255) inc = 255 - max;
  }
  return inc;
}

export function scaleHeight(h: number, factor: number): number {
  return Math.min(255, Math.max(0, Math.floor(h * factor + 1e-9)));
}

export function effectiveScale(factor: number, max: number, avoidClip: boolean): number {
  return avoidClip && max > 0 && scaleHeight(max, factor) > 255 ? 255 / max : factor;
}

export function liftHeight(h: number, inc: number): number {
  return Math.min(255, Math.max(0, h + inc));
}

/** Something that stands on the terrain: x and y in ipos, z in whole steps. */
export interface Placed { ipos: [number, number, number] }

/*
  Adjust Terrain Heights (OnTerrainRaiseLower): every height lifted or scaled; optionally
  everything placed on the ground (objects, truck starts, both ends of every course segment)
  moved by exactly the change in ground beneath it (CollectPlacedPoints, ShiftPlacedPoints),
  and the water lifted or scaled in quarter steps.
*/
export function adjustHeights(
  heights: Uint8Array,
  opts: { scale: boolean; increment: number; factor: number; avoidClip: boolean },
  placed: Placed[], water4: number | null,
): { water4: number | null } {
  let min = 255, max = 0;
  for (const h of heights) { if (h < min) min = h; if (h > max) max = h; }
  const factor = effectiveScale(opts.factor, max, opts.avoidClip);
  const inc = effectiveIncrement(opts.increment, min, max, opts.avoidClip);
  const ground = placed.map((p) => interpolateRawAtPoint(heights, p.ipos[0], p.ipos[1]));
  for (let i = 0; i < heights.length; i++) heights[i] = opts.scale ? scaleHeight(heights[i], factor) : liftHeight(heights[i], inc);
  placed.forEach((p, i) => { p.ipos[2] += interpolateRawAtPoint(heights, p.ipos[0], p.ipos[1]) - ground[i]; });
  if (water4 === null) return { water4: null };
  const w = opts.scale ? Math.floor(water4 * factor + 1e-9) : water4 + 4 * inc;
  return { water4: Math.min(4 * 255, Math.max(0, w)) };
}

/*
  The terrain as a 256 x 256 greyscale picture (OnTerrainCopyBitmap writes the heights as an
  8-bit DIB with a grey palette; a DIB is bottom-up, so row 0 of the heights is the bottom of
  the picture). Paste takes a 256 x 256 picture back the same way, reading its grey level.
*/
export function heightsToRgba(heights: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(256 * 256 * 4);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const v = heights[i + (j << 8)], d = (i + (255 - j) * 256) * 4;
    out[d] = out[d + 1] = out[d + 2] = v;
    out[d + 3] = 255;
  }
  return out;
}

export function rgbaToHeights(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array | null {
  if (width !== 256 || height !== 256) return null;
  const out = new Uint8Array(65536);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const s = (i + (255 - j) * 256) * 4;
    out[i + (j << 8)] = Math.round(0.299 * rgba[s] + 0.587 * rgba[s + 1] + 0.114 * rgba[s + 2]);
  }
  return out;
}
