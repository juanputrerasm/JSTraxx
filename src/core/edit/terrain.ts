/*
  Terrain editing, as Traxx does it (Traxx/TraxxViewEdit.cpp):

    MakeEditGrid    the brush: a grid of height offsets for the tool, size, orientation,
                    curvature and altitude, in whole steps (terraingrid) and in v (terraingridv)
    ApplyEditGrid   the brush laid on the heights around a vertex
    OnTerrainCopy / OnTerrainPaste, OnTerrainRaiseLower (Adjust Terrain Heights),
    OnTerrainCopyBitmap / OnTerrainPasteBitmap

  Tools: 0 Platform (Raise), 1 Hill, 2 Wedge (Slope), 3 Mound, 4 Bumps, 5 Smooth, 6 Plane,
  7 Direct Edit. Float maths is single precision, as Traxx's; its rounding (ROUNDF, which adds
  0.499 and truncates) is kept.

  Traxx 1.7: a classic 8-bit track edits raw as ever. CLASSIC16 and Spline edit h16 in v
  (1/256 step), clipped at the map edge; a Full Map edits its 1024 x 1024 grid of 8 ft points,
  wrapping as the drive surface does (ApplyStamp16, StampCopy16, StampPaste16), and counts the
  brush in 8 ft points, 1 to 100. The Altitude is a decimal number of steps on every 16-bit
  track (v = floor(steps * 256 + 0.5)); the classic brush uses its nearest whole step.

  Track format version 6 (spec sections 7.3 and 8.1): the grids are N x N (4N x 4N fine), N the
  track's worldCells, and a 32-bit grid clamps to its own range (world.ts heightLimits).
*/
import { refreshRaw, TERRAINMODE_CLASSIC8, type Terrain16 } from "../traxx/terrain16.ts";
import { applyStamp16, heightsChanged } from "../traxx/surface.ts";
import { cellsOf, heightLimits, sideOf, type HeightGrid } from "../traxx/world.ts";
import { placedGround, shiftPlaced, type Ground, type PlacedPoint } from "../traxx/box-ground.ts";

/*
  The brush stamp's size limits (Traxx/TraxxView.h, "THE BRUSH STAMP'S SIZE LIMITS"): the edit
  bar's width and height are 1-25 cells on the 32 ft grids and 1-100 points on a Full Map;
  rotation widens a stamp by up to sqrt 2, so it is kept under MAXTERRAINSZ (Full Map) or
  MAXTERRAINSZ_COARSE (everything else, exactly as before).
*/
export const MAX_TERRAIN_SZ = 160;
export const MAX_TERRAIN_SZ_COARSE = 40;
export const EDITSIZE_MAX_COARSE = 25;
export const EDITSIZE_MAX_FINE = 100;
/** AMPLITUDE_MAXV (TraxxFrame.cpp): the Altitude's limit in v, +-255 steps. */
export const AMPLITUDE_MAXV = 255 * 256;

const f = Math.fround;

/** ROUNDF: (int)(q - 0.499) for negatives, (int)(q + 0.499) otherwise; NaN reads as 0. */
function roundf(q: number): number {
  if (Number.isNaN(q)) return 0;
  return q < 0 ? Math.trunc(f(q - 0.499)) : Math.trunc(f(q + 0.499));
}

/** TerrainWholeSteps (TraxxView.h): v as whole steps, to nearest, half away from zero. */
export function terrainWholeSteps(v: number): number {
  return v >= 0 ? (v + 128) >> 8 : 0 - ((-v + 128) >> 8);
}

/**
  The Altitude in v (terrainzv). JSTraxx keeps the edit bar's value in steps, always a multiple
  of 1/256, so this is AmplitudeFromBox's floor(x * 256 + 0.5).
*/
export function altitudeV(altitude: number): number {
  return Math.floor(altitude * 256 + 0.5);
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
  /** The Altitude, in steps (a multiple of 1/256; whole on a classic 8-bit track). */
  altitude: number;
  /** The track is a Full Map: the brush counts 8 ft points under Full Map's limits (EditOnFine). */
  fine?: boolean;
}

export interface EditGrid {
  /** The grid's size after rotation. */
  width: number;
  height: number;
  /** terraingrid: offsets in whole steps (the classic brush), row by row: grid[j * width + i]. */
  grid: Int16Array;
  /** terraingridv: the same brush in v (1/256 step) at the fractional amplitude, for the 16-bit grids. */
  gridV: Int32Array;
}

/** MakeEditGrid (Traxx 1.7). `random` stands in for rand() (0..1), for Bumps. */
export function makeEditGrid(p: BrushParams, random: () => number = Math.random): EditGrid {
  const fine = Boolean(p.fine);
  const maxsz = fine ? MAX_TERRAIN_SZ : MAX_TERRAIN_SZ_COARSE;
  const maxedit = fine ? EDITSIZE_MAX_FINE : EDITSIZE_MAX_COARSE;
  const belln = 10 * maxsz;
  // A stale width never builds an outsized stamp.
  const pw = Math.min(p.width, maxedit), ph = Math.min(p.height, maxedit);
  const arg = (3.141592654 * p.orientation) / 4;
  const sinarg = f(10 * f(Math.sin(arg)));
  const cosarg = f(10 * f(Math.cos(arg)));
  let width = Math.trunc(Math.trunc(f(Math.abs(f(cosarg * pw)) + Math.abs(f(sinarg * ph)))) / 10);
  let height = Math.trunc(Math.trunc(f(Math.abs(f(sinarg * pw)) + Math.abs(f(cosarg * ph)))) / 10);
  width = Math.min(width, maxsz - 1);
  height = Math.min(height, maxsz - 1);
  const halfwidth = (width - 1) >> 1, halfheight = (height - 1) >> 1;
  const _halfwidth = (pw - 1) >> 1, _halfheight = (ph - 1) >> 1;
  const zv = altitudeV(p.altitude);
  const fpixel = f(terrainWholeSteps(zv));
  // The 16-bit stamp's amplitude, in steps with fractions.
  const fpixelv = f(zv / 256);
  const bellx = new Float32Array(belln), belly = new Float32Array(belln);
  const bellvx = new Float32Array(belln), bellvy = new Float32Array(belln);
  const c09 = f(-0.09), c06 = f(-0.06), c01 = f(0.1);
  switch (p.tool) {
    case 1:
      bellx[0] = belly[0] = fpixel;
      bellvx[0] = bellvy[0] = fpixelv;
      for (let i = 1; i < belln; i++) {
        const ex = f(Math.exp(f(f(c09 * (i * i)) / f(_halfwidth * _halfwidth))));
        const ey = f(Math.exp(f(f(c09 * (i * i)) / f(_halfheight * _halfheight))));
        bellx[i] = f(fpixel * ex); belly[i] = f(fpixel * ey);
        bellvx[i] = f(fpixelv * ex); bellvy[i] = f(fpixelv * ey);
      }
      break;
    case 3:
      bellx[0] = fpixel;
      bellvx[0] = fpixelv;
      for (let i = 1; i < belln; i++) {
        const ex = f(Math.exp(f(f(c06 * (i * i)) / f(_halfwidth * _halfwidth))));
        bellx[i] = f(fpixel * ex);
        bellvx[i] = f(fpixelv * ex);
      }
      break;
    case 4:
      // Random bumps: one rand() per entry, shared by both tables.
      for (let i = 0; i < belln; i++) {
        const r = Math.trunc(random() * 256) & 255;
        bellx[i] = f(f(fpixel * r) / 255);
        bellvx[i] = f(f(fpixelv * r) / 255);
      }
      break;
  }
  const power = [0.2, 0.5, 0.75, 1, 1.4, 2, 3][p.curvature] ?? 1;
  const grid = new Int16Array(Math.max(0, width * height));
  const gridV = new Int32Array(Math.max(0, width * height));
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const roti = f(f(cosarg * (i - halfwidth)) - f(sinarg * (j - halfheight)));
      const rotj = f(f(sinarg * (i - halfwidth)) + f(cosarg * (j - halfheight)));
      let ii = 10 * halfwidth + roundf(roti);
      const jj = 10 * halfheight + roundf(rotj);
      let fval = 0, fvalv = 0;
      const bii = Math.min(belln - 1, Math.abs(ii - 10 * halfwidth));
      const bjj = Math.min(belln - 1, Math.abs(jj - 10 * halfheight));
      switch (p.tool) {
        case 0: fval = fpixel; fvalv = fpixelv; break;
        case 1:
          fval = f((fpixel < 0 ? -1 : 1) * f(Math.sqrt(f(bellx[bii] * belly[bjj]))));
          fvalv = f((fpixelv < 0 ? -1 : 1) * f(Math.sqrt(f(bellvx[bii] * bellvy[bjj]))));
          break;
        case 2:
          ii = 10 * _halfwidth + roundf(roti);
          fval = f(f(f(c01 * fpixel) * ii) / pw);
          if (fval < 0) fval = 0;
          fvalv = f(f(f(c01 * fpixelv) * ii) / pw);
          if (fvalv < 0) fvalv = 0;
          break;
        case 3: fval = bellx[bii]; fvalv = bellvx[bii]; break;
        // Traxx indexes `(i + j*w) % 10*(belln/10)`: the remainder of ten, times belln / 10.
        case 4: {
          const k = ((i + j * width) % 10) * (belln / 10);
          fval = bellx[k]; fvalv = bellvx[k];
          break;
        }
      }
      // Clip at the bounds of the unrotated rectangle.
      if (bii > 10 * (_halfwidth + 1) || bjj > 10 * (_halfheight + 1)) { fval = 0; fvalv = 0; }
      if (p.curvature !== 3 && p.tool !== 0 && p.tool !== 5 && p.tool !== 7) {
        fval = f(fval / fpixel);
        fval = f(fpixel * f(Math.pow(fval, power)));
        if (fpixelv !== 0) {
          fvalv = f(fvalv / fpixelv);
          fvalv = f(fpixelv * f(Math.pow(fvalv, power)));
        } else fvalv = 0;
      }
      // terraingrid is short.
      grid[j * width + i] = roundf(fval);
      gridV[j * width + i] = roundf(f(fvalv * 256));
    }
  }
  return { width, height, grid, gridV };
}

/** The cells a brush covers around vertex (gi, gj), inclusive and clamped to the map (N = `cells`). */
export function brushRect(width: number, height: number, gi: number, gj: number, cells = 256): { minX: number; minY: number; maxX: number; maxY: number } {
  const hw = (width - 1) >> 1, hh = (height - 1) >> 1;
  return { minX: Math.max(0, gi - hw), minY: Math.max(0, gj - hh), maxX: Math.min(cells - 1, gi - hw + width - 1), maxY: Math.min(cells - 1, gj - hh + height - 1) };
}

/*
  ApplyEditGrid on a classic 8-bit track, at vertex (gi, gj). Smooth averages each inner point's
  four neighbours from the heights as they were before; Plane sets the altitude (0 for a
  negative one); Direct Edit adds the altitude to one point, held to 0..255; the rest add the
  brush, held to 2..255. The altitude is terrainz, the nearest whole step.
*/
export function applyEditGrid(heights: Uint8Array, eg: EditGrid, p: BrushParams, gi: number, gj: number): void {
  const w = p.tool === 7 ? 1 : eg.width, h = p.tool === 7 ? 1 : eg.height;
  const hw = (w - 1) >> 1, hh = (h - 1) >> 1;
  const n = sideOf(heights.length);
  if (p.tool === 5) {
    const before = heights.slice();
    for (let j = 1; j < h - 1; j++) {
      const jg = j + gj - hh;
      if (jg < 1 || jg > n - 2) continue;
      for (let i = 1; i < w - 1; i++) {
        const ig = i + gi - hw;
        if (ig < 1 || ig > n - 2) continue;
        const c = ig + jg * n;
        heights[c] = (before[c + n]! + before[c - n]! + before[c + 1]! + before[c - 1]!) >> 2;
      }
    }
    return;
  }
  const z = terrainWholeSteps(altitudeV(p.altitude));
  for (let j = 0; j < h; j++) {
    const jg = j + gj - hh;
    if (jg < 0 || jg > n - 1) continue;
    for (let i = 0; i < w; i++) {
      const ig = i + gi - hw;
      if (ig < 0 || ig > n - 1) continue;
      const c = ig + jg * n;
      if (p.tool === 7) heights[c] = z > 0 ? Math.min(255, heights[c] + z) : Math.max(0, heights[c] + z);
      else if (p.tool === 6) heights[c] = z > 0 ? Math.min(255, z) : 0;
      else heights[c] = Math.min(255, Math.max(2, heights[c] + eg.grid[j * eg.width + i]));
    }
  }
}

/**
  The grid a terrain tool works on (Traxx 1.7): a Full Map's 1024 x 1024 points (wrapping),
  else h16 on a 16-bit track (clipped), else raw.
*/
export interface EditTarget {
  kind: "raw" | "h16" | "fine";
  grid: Uint8Array | HeightGrid;
  size: number;
  wrapmask: number;
  wrap: boolean;
}

export function editTarget(t: Terrain16): EditTarget {
  const n = cellsOf(t);
  if (t.fine) return { kind: "fine", grid: t.fine, size: 4 * n, wrapmask: 4 * n - 1, wrap: true };
  if (t.h16 && t.terrainMode !== TERRAINMODE_CLASSIC8) return { kind: "h16", grid: t.h16, size: n, wrapmask: n - 1, wrap: false };
  return { kind: "raw", grid: t.heights, size: n, wrapmask: n - 1, wrap: false };
}

/**
  ApplyEditGrid (Traxx 1.7) on whatever the track edits. (cx, cy) is the vertex on that grid: a
  32 ft vertex, or on a Full Map the 8 ft point (editfine). A 16-bit grid takes terraingridv
  through ApplyStamp16 (Smooth reading the grid as it was), then RefreshRaw rebuilds the mirror.
*/
export function applyBrush(t: Terrain16, eg: EditGrid, p: BrushParams, cx: number, cy: number): void {
  const tg = editTarget(t);
  if (tg.kind === "raw") { applyEditGrid(t.heights, eg, p, cx, cy); return; }
  const w = p.tool === 7 ? 1 : eg.width, h = p.tool === 7 ? 1 : eg.height;
  const g = tg.grid as HeightGrid;
  applyStamp16(g, tg.size, tg.wrapmask, eg.gridV, w, h, cx, cy, p.tool, altitudeV(p.altitude), p.tool === 5 ? g.slice() : null, tg.wrap);
  refreshRaw(t);
  heightsChanged(t);
}

/**
  The window of the edited grid a stamp of w x h centred on (cx, cy) writes (unwrapped; a Full
  Map wraps it), and the 32 ft cells whose mirror can change with it, padded by one cell for
  the drawing and clamped (a window across the map edge touches that whole axis).
*/
export function stampWindow(t: Terrain16, w: number, h: number, cx: number, cy: number): {
  x0: number; y0: number; w: number; h: number;
  coarse: { x0: number; y0: number; w: number; h: number };
  touch: { minX: number; minY: number; maxX: number; maxY: number };
} {
  const x0 = cx - ((w - 1) >> 1), y0 = cy - ((h - 1) >> 1);
  const shift = t.fine ? 2 : 0;
  const n = cellsOf(t), last = n - 1;
  const cx0 = x0 >> shift, cy0 = y0 >> shift;
  const cx1 = (x0 + w - 1) >> shift, cy1 = (y0 + h - 1) >> shift;
  const axis = (a: number, b: number) => (a < 0 || b > last ? (t.fine ? [0, last] : [Math.max(0, a), Math.min(last, b)]) : [Math.max(0, a - 1), Math.min(last, b + 1)]);
  const [minX, maxX] = axis(cx0, cx1), [minY, maxY] = axis(cy0, cy1);
  return {
    x0, y0, w, h,
    coarse: { x0: cx0, y0: cy0, w: Math.min(n, cx1 - cx0 + 1), h: Math.min(n, cy1 - cy0 + 1) },
    touch: { minX, minY, maxX, maxY },
  };
}

/**
  OverlayTerrainGrid's stamp: the heights the brush at (cx, cy) would make, in v. A Full Map
  draws its 8 ft points, and above 40 a side every 2nd point, above 80 every 4th, always with
  the centre and the far edge; the 32 ft grids draw every cell. 16-bit tracks read h16 or the
  fine grid (wrapped), classic 8-bit tracks raw (0 off the map).
*/
export interface BrushPreview {
  /** The stamp columns and rows drawn. */
  cols: number[];
  rows: number[];
  /** Where the centre is in cols / rows. */
  ci: number;
  cj: number;
  /** Each drawn point's height in v, row by row (cols.length per row). */
  v: Int32Array;
  /** The ground and the new height at the centre, in v. */
  baseV: number;
  editV: number;
  /** Labels to a tenth of a step (16-bit) rather than whole steps. */
  precise: boolean;
  /** One stamp cell in ipos: 64 (32 ft) or 16 (8 ft). */
  spacing: number;
}

export function brushPreview(t: Terrain16, eg: EditGrid, p: BrushParams, cx: number, cy: number): BrushPreview {
  const tg = editTarget(t);
  const w = p.tool === 7 ? 1 : eg.width, h = p.tool === 7 ? 1 : eg.height;
  const hw = (w - 1) >> 1, hh = (h - 1) >> 1;
  const onfine = tg.kind === "fine";
  let step = 1;
  if (onfine) { const m = Math.max(w, h); step = m > 80 ? 4 : m > 40 ? 2 : 1; }
  const cols: number[] = [], rows: number[] = [];
  let ci = 0, cj = 0;
  for (let i = 0; i < w; i++) if (i % step === 0 || i === hw || i === w - 1) { if (i === hw) ci = cols.length; cols.push(i); }
  for (let j = 0; j < h; j++) if (j % step === 0 || j === hh || j === h - 1) { if (j === hh) cj = rows.length; rows.push(j); }
  const v = new Int32Array(cols.length * rows.length);
  const zv = altitudeV(p.altitude), z = terrainWholeSteps(zv);
  const g = tg.grid, size = tg.size, mask = tg.wrapmask;
  const last = size - 1;
  const [vlo, vhi] = tg.kind === "raw" ? [0, 65535] : heightLimits(g as HeightGrid);
  let baseV = 0, editV = 0;
  rows.forEach((j, jj) => {
    cols.forEach((i, ii) => {
      let out: number;
      let gx = i + cx - hw, gy = j + cy - hh;
      if (onfine) { gx &= mask; gy &= mask; }
      const on = onfine || (gx >= 0 && gx < size && gy >= 0 && gy < size);
      const inner = j > 0 && j < eg.height - 1 && i > 0 && i < eg.width - 1;
      const at = (x: number, y: number) => g[(x & mask) + (y & mask) * size]!;
      if (!on) out = 0;
      else if (tg.kind === "raw") {
        let s: number;
        if (p.tool === 6) s = z > 0 ? z : 1;
        else if (p.tool === 5) s = inner && gy > 0 && gy < last && gx > 0 && gx < last ? (at(gx + 1, gy) + at(gx - 1, gy) + at(gx, gy + 1) + at(gx, gy - 1)) >> 2 : at(gx, gy);
        else s = Math.min(255, Math.max(0, at(gx, gy) + (p.tool === 7 ? 0 : eg.grid[j * eg.width + i]!)));
        out = s << 8;
      } else {
        if (p.tool === 6) out = g instanceof Int32Array ? Math.min(vhi, Math.max(vlo, zv)) : zv > 0 ? zv : 256;
        else if (p.tool === 5) {
          out = inner && (onfine || (gy > 0 && gy < last && gx > 0 && gx < last))
            ? Math.floor((at(gx + 1, gy) + at(gx - 1, gy) + at(gx, gy + 1) + at(gx, gy - 1) + 2) / 4)
            : at(gx, gy);
        } else out = Math.min(vhi, Math.max(vlo, at(gx, gy) + (p.tool === 7 ? 0 : eg.gridV[j * eg.width + i]!)));
      }
      v[jj * cols.length + ii] = out;
      if (i === hw && j === hh) {
        editV = out;
        baseV = on ? (tg.kind === "raw" ? at(gx, gy) << 8 : at(gx, gy)) : 0;
      }
    });
  });
  return { cols, rows, ci, cj, v, baseV, editV, precise: tg.kind !== "raw", spacing: onfine ? 16 : 64 };
}

/**
  v / 256 printed with `places` decimals (1 or 2) as the C runtime's "%.Nf" does: v / 256 is exact
  in binary, so the digits are exact, and an exact tie goes to the even digit (Windows' UCRT, as
  glibc). JavaScript's toFixed would round such a tie up.
*/
export function formatV(v: number, places: 1 | 2): string {
  const scale = places === 1 ? 10 : 100;
  const n = Math.abs(v) * scale;
  let q = Math.floor(n / 256);
  const r = n - q * 256;
  if (r > 128 || (r === 128 && (q & 1))) q++;
  return `${v < 0 ? "-" : ""}${Math.floor(q / scale)}.${String(q % scale).padStart(places, "0")}`;
}

/** A height in v as the overlay labels it: whole steps on a classic track, "%.1f" of a step on 16-bit. */
export function previewLabel(v: number, precise: boolean): string {
  return precise ? formatV(v, 1) : String(v >> 8);
}

/**
  Copy Area's block (terraincopy, Traxx 1.7): heights in v, row by row, and whether it holds
  8 ft points (copied on a Full Map) or 32 ft cells. A block pastes only on its own kind of grid
  (TerrainPasteFits). -1 marks a cell that was off the map when copied, which a paste skips
  (Traxx leaves the old block's value there).
*/
export interface TerrainBlock { width: number; height: number; fine: boolean; data: Int32Array }

function stampAxis(g: number, size: number, wrapmask: number, wrap: boolean): number {
  if (wrap) return g & wrapmask;
  return g < 0 || g >= size ? -1 : g;
}

function copyBlock(tg: EditTarget, width: number, height: number, cx: number, cy: number): Int32Array {
  const ox = cx - ((width - 1) >> 1), oy = cy - ((height - 1) >> 1);
  const data = new Int32Array(width * height).fill(-1);
  for (let j = 0; j < height; j++) {
    const gy = stampAxis(j + oy, tg.size, tg.wrapmask, tg.wrap);
    if (gy < 0) continue;
    for (let i = 0; i < width; i++) {
      const gx = stampAxis(i + ox, tg.size, tg.wrapmask, tg.wrap);
      if (gx < 0) continue;
      const h = tg.grid[gx + gy * tg.size]!;
      // Classic 8-bit: the block is kept in v too (raw << 8), which Paste turns back into the same bytes.
      data[i + j * width] = tg.kind === "raw" ? h << 8 : h;
    }
  }
  return data;
}

/**
  OnTerrainCopy: the w x h block (the rotated brush size) around (cx, cy): a Full Map's 8 ft
  points (wrapping, StampCopy16), h16 as it is on a 16-bit track, raw << 8 on a classic one.
*/
export function copyArea(t: Terrain16, width: number, height: number, cx: number, cy: number): TerrainBlock {
  const tg = editTarget(t);
  return { width, height, fine: tg.kind === "fine", data: copyBlock(tg, width, height, cx, cy) };
}

/** TerrainPasteFits: 8 ft points paste only on a Full Map, 32 ft cells only elsewhere. */
export function pasteFits(block: TerrainBlock, t: Terrain16): boolean {
  return block.fine === Boolean(t.fine);
}

/**
  OnTerrainPaste: the block centred on (cx, cy). A Full Map (wrapping) and a 16-bit track
  (clipped) take it whole, fractions and all (StampPaste16), then the mirror follows; a classic
  track takes each v back to raw rounded to nearest. Traxx 1.7 fixed the swapped width and
  height of the old loop, so a block that is not square pastes as it was copied.
*/
export function pasteArea(t: Terrain16, block: TerrainBlock, cx: number, cy: number): boolean {
  if (!pasteFits(block, t)) return false;
  const tg = editTarget(t);
  const ox = cx - ((block.width - 1) >> 1), oy = cy - ((block.height - 1) >> 1);
  for (let j = 0; j < block.height; j++) {
    const gy = stampAxis(j + oy, tg.size, tg.wrapmask, tg.wrap);
    if (gy < 0) continue;
    for (let i = 0; i < block.width; i++) {
      const gx = stampAxis(i + ox, tg.size, tg.wrapmask, tg.wrap);
      const v = block.data[i + j * block.width]!;
      if (gx < 0 || v < 0) continue;
      if (tg.kind === "raw") { const b = (v + 128) >> 8; tg.grid[gx + gy * tg.size] = b > 255 ? 255 : b; }
      else tg.grid[gx + gy * tg.size] = v;
    }
  }
  if (tg.kind !== "raw") { refreshRaw(t); heightsChanged(t); }
  return true;
}

/** OnTerrainCopy on raw alone: the w x h block at (gi, gj) in v (raw << 8); -1 where off the map. */
export function copyTerrain(heights: Uint8Array, width: number, height: number, gi: number, gj: number): TerrainBlock {
  const n = sideOf(heights.length);
  return { width, height, fine: false, data: copyBlock({ kind: "raw", grid: heights, size: n, wrapmask: n - 1, wrap: false }, width, height, gi, gj) };
}

/** OnTerrainPaste on raw alone (a classic track). */
export function pasteTerrain(heights: Uint8Array, block: TerrainBlock, gi: number, gj: number): void {
  pasteArea({ terrainMode: TERRAINMODE_CLASSIC8, h16: null, fine: null, rawShadow: null, heights, worldCells: sideOf(heights.length) }, block, gi, gj);
}

/**
  OnTerrainPasteBitmap's write: on a 16-bit track a bitmap byte b is the height b << 8 in h16,
  then the mirror follows; a classic track takes the bytes. A Full Map refuses it (TerrainIsFine:
  Import Heightmap covers it there).
*/
export function pasteBitmapHeights(t: Terrain16, data: Uint8Array): boolean {
  if (t.fine) return false;
  const n = cellsOf(t), bw = sideOf(data.length);
  // Traxx 1.8.2 (d932015): the picture is N x N, or on a 512 world 256 x 256 into cells 0..255.
  if (bw * bw !== data.length || !pasteBitmapFits(bw, bw, n)) return false;
  if (t.h16) {
    for (let r = 0; r < bw; r++) for (let c = 0; c < bw; c++) t.h16[r * n + c] = data[r * bw + c]! << 8;
    refreshRaw(t);
    heightsChanged(t);
  } else for (let r = 0; r < bw; r++) t.heights.set(data.subarray(r * bw, (r + 1) * bw), r * n);   // Traxx: Classic 8-bit is always 256 x 256
  return true;
}

/**
  OnTerrainPasteBitmap's shape test (Traxx 1.8.2, d932015): a square picture of the world's N, or
  on a 512 world a 256 x 256 one, which goes into the top-left corner (cells 0..255, the corner a
  256 track keeps when it is enlarged).
*/
export function pasteBitmapFits(width: number, height: number, cells: number): boolean {
  return width === height && (width === cells || (cells === 512 && width === 256));
}

/**
  OnTerrainPasteBitmap's three refusals, or null when the picture fits. Traxx's "un-compressed,
  8-bit" is about the clipboard's DIB; a browser hands JSTraxx a decoded picture, read by its grey
  level, so those words are left out.
*/
export function pasteBitmapRefusal(width: number, height: number, cells: number): string | null {
  if (pasteBitmapFits(width, height, cells)) return null;
  if (width === 512 && height === 512 && cells === 256) {
    return "Sorry, this bitmap is 512 x 512 pixels but this track's world is 256 x 256. A 512 x 512 bitmap needs a 512 x 512 track.";
  }
  if (cells === 512) return "Sorry, Bitmap must be 512 x 512 pixels (or 256 x 256, which goes in the top-left corner).";
  return "Sorry, Bitmap must be 256 x 256 pixels.";
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

/*
  Traxx origin/main RaiseLowerDlg.cpp: the same in v, for a v6 track. Heights are 0..hmax (the terrain's height
  limit); a scale rounds to the nearest (half up), as AdjustHeights16 does, so the readout is what the grid gets.
*/
export function effectiveIncrementV(incv: number, minv: number, maxv: number, hmax: number, avoidClip: boolean): number {
  if (avoidClip) {
    if (minv + incv < 0) incv = -minv;
    if (maxv + incv > hmax) incv = hmax - maxv;
  }
  return incv;
}

export function scaleHeightV(h: number, factor: number, hmax: number): number {
  const v = Math.floor(h * factor + 0.5 + 1e-9);
  return Math.trunc(v < 0 ? 0 : v > hmax ? hmax : v);
}

export function effectiveScaleV(factor: number, maxv: number, hmax: number, avoidClip: boolean): number {
  return avoidClip && maxv > 0 && scaleHeightV(maxv, factor, 0x7fffffff) > hmax ? hmax / maxv : factor;
}

export function liftHeightV(h: number, incv: number, hmax: number): number {
  const v = h + incv;
  return Math.trunc(v < 0 ? 0 : v > hmax ? hmax : v);
}

/** A v6 track's Adjust Terrain Heights (the dialog in feet): the exact range in v, the ceiling and the lift typed. */
export interface AdjustFeet { minv: number; maxv: number; hmax: number; liftv: number }

/** Something that stands on the terrain: x and y in ipos, z in whole steps. */
/** A truck start or course end (ipos only), or an object (with its fraction). */
export type Placed = PlacedPoint;

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
  /** A 16-bit track: adjust its real grid with the factor and the lift in v instead (AdjustHeights16 / Fine). */
  grid16?: (scale: boolean, liftv: number, factor: number) => void,
  /** The track, so placed points are grounded on the drive surface off Classic 8-bit (CollectPlacedPoints). */
  track?: Ground,
  /** The water's range, half feet: Traxx's 0..1020, or a version 6 document's (v6.ts trackWaterRange). */
  waterRange: readonly [number, number] = [0, 4 * 255],
  /** Traxx origin/main: a v6 track's dialog in feet (with grid16): the factor and lift judged in v. */
  feet?: AdjustFeet,
): { water4: number | null; factor: number; inc: number; dq: number } {
  let min = 255, max = 0;
  for (const h of heights) { if (h < min) min = h; if (h > max) max = h; }
  let factor: number, inc: number, liftv: number;
  if (feet && grid16) {
    factor = effectiveScaleV(opts.factor, feet.maxv, feet.hmax, opts.avoidClip);
    liftv = effectiveIncrementV(feet.liftv, feet.minv, feet.maxv, feet.hmax, opts.avoidClip);
    inc = 0;
  } else {
    factor = effectiveScale(opts.factor, max, opts.avoidClip);
    inc = effectiveIncrement(opts.increment, min, max, opts.avoidClip);
    liftv = inc * 256;
  }
  // The lift of the water and the lakes in their units (half feet): 4 a step, or 64 v apiece on a v6 track.
  const dq = feet && grid16 ? Math.floor(liftv / 64 + 0.5) : 4 * inc;
  const g: Ground = track ?? heights;
  const ground = placed.map((p) => placedGround(g, p));
  if (grid16) grid16(opts.scale, liftv, factor);
  else for (let i = 0; i < heights.length; i++) heights[i] = opts.scale ? scaleHeight(heights[i], factor) : liftHeight(heights[i], inc);
  placed.forEach((p, i) => shiftPlaced(g, p, ground[i]!));
  if (water4 === null) return { water4: null, factor, inc, dq };
  const w = opts.scale ? Math.floor(water4 * factor + 1e-9) : water4 + dq;
  return { water4: Math.min(waterRange[1], Math.max(waterRange[0], w)), factor, inc, dq };
}

/*
  The terrain as an N x N greyscale picture (OnTerrainCopyBitmap writes the heights as an
  8-bit DIB with a grey palette; a DIB is bottom-up, so row 0 of the heights is the bottom of
  the picture). Paste takes an N x N picture back the same way, reading its grey level. N is 256,
  or 512 in a version 6 world (spec section 8.1); a 512 world also takes a 256 x 256 picture
  (Traxx 1.8.2), whose rows come back 256 long (pasteBitmapHeights puts them in the corner).
*/
export function heightsToRgba(heights: Uint8Array): Uint8ClampedArray {
  const n = sideOf(heights.length);
  const out = new Uint8ClampedArray(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = heights[i + j * n]!, d = (i + (n - 1 - j) * n) * 4;
    out[d] = out[d + 1] = out[d + 2] = v;
    out[d + 3] = 255;
  }
  return out;
}

export function rgbaToHeights(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, cells = 256): Uint8Array | null {
  if (!pasteBitmapFits(width, height, cells)) return null;
  const n = width;
  const out = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const s = (i + (n - 1 - j) * n) * 4;
    out[i + j * n] = Math.round(0.299 * rgba[s]! + 0.587 * rgba[s + 1]! + 0.114 * rgba[s + 2]!);
  }
  return out;
}
