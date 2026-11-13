/*
  The drive surface and the terrain grid conversions Traxx 1.7 adds (TrackPOD/TrackPODTerrain.cpp:
  PlanarExpand, ImportHeights, SetMode, GetSurface, CornerV, FineV, TriangleV, SurfaceHeightV,
  GroundAt, AdjustHeights16 / AdjustHeightsFine, SmoothFineFromCoarse, BuildLakeGround,
  TerrainConvertMessage, ApplyStamp16, StampCopy16, StampPaste16, FineVertexAtPoint).

  Heights are v: 1/256 of a terrain step, feet = v / 128. Positions are 1/256 ipos: 16384 per
  32 ft cell, 4096 per 8 ft point. Everything wraps at the map edge, as the engine's surface does.

  The Spline surface (the game's terrainspline.c) is OpenPhotex's terrainSplineExpand, a bit-exact
  port. It is cached per track record and dropped whenever heightsChanged() is called, which every
  writer here does; a caller that edits h16 / fine in place calls it itself.
*/
import { terrainSplineExpand } from "../../vendor/openphotex/terrain/spline.js";
import { interpolateRawAtPoint } from "./terrain.ts";
import {
  mirrorOf, refreshRaw, syncFromRaw, terrainModeName, type Terrain16,
  TERRAINMODE_CLASSIC8, TERRAINMODE_CLASSIC16, TERRAINMODE_SPLINE, TERRAINMODE_FINE, TERRAIN_FINE,
} from "./terrain16.ts";

const COARSE = 256 * 256;
const FINE = TERRAIN_FINE * TERRAIN_FINE;

/** The spline cache (surfcache / surfvalid), kept beside the record so it never reaches a file. */
const surfaceCache = new WeakMap<object, { h16: Uint16Array; surface: Uint16Array }>();
/** The revision counter (HeightsChanged / GetRevision). */
const revisions = new WeakMap<object, number>();

/** HeightsChanged: the heights moved; the spline cache is stale and the revision goes up. */
export function heightsChanged(t: Terrain16): void {
  surfaceCache.delete(t);
  revisions.set(t, (revisions.get(t) ?? 0) + 1);
}

/** GetRevision. */
export function surfaceRevision(t: Terrain16): number {
  return revisions.get(t) ?? 0;
}

/**
  PlanarExpand: the classic driven surface at 4x resolution. Every fine point lies on the
  triangle InterpolateRawAtPoint would put it on (even (x + z) cuts (0,0)-(1,1), odd (1,0)-(0,1));
  weights in quarters, rounded half up; corners wrap mod 256.
*/
export function planarExpand(h: Uint16Array, out: Uint16Array = new Uint16Array(FINE)): Uint16Array {
  for (let z = 0; z < 256; z++) {
    const z1 = (z + 1) & 255;
    for (let x = 0; x < 256; x++) {
      const x1 = (x + 1) & 255;
      const h00 = h[x + (z << 8)], h10 = h[x1 + (z << 8)], h01 = h[x + (z1 << 8)], h11 = h[x1 + (z1 << 8)];
      const parity = (x + z) & 1;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          let n: number;
          if (!parity) n = i >= j ? h00 * (4 - i) + h10 * (i - j) + h11 * j : h00 * (4 - j) + h01 * (j - i) + h11 * i;
          else n = i + j <= 4 ? h00 * (4 - i - j) + h10 * i + h01 * j : h11 * (i + j - 4) + h01 * (4 - i) + h10 * (4 - j);
          out[((4 * z + j) << 10) + 4 * x + i] = (n + 2) >> 2;
        }
      }
    }
  }
  return out;
}

/**
  SetMode: the Terrain Grid conversion table. 8-bit edits are folded in first (SyncFromRaw).

    to FINE        Spline: the spline surface; 16-bit: PlanarExpand of h16; 8-bit: of raw << 8
    to CLASSIC8    the mirror (nearest step), the 16-bit grids dropped
    to 16 / Spline from FINE: the points on the 32 ft grid; from 8-bit: raw << 8; else h16 kept

  Returns false only for a mode out of range (JSTraxx has no allocation to fail).
*/
export function setMode(t: Terrain16, newMode: number): boolean {
  if (newMode < TERRAINMODE_CLASSIC8 || newMode > TERRAINMODE_FINE) return false;
  if (newMode === t.terrainMode) return true;
  syncFromRaw(t);
  const mode = t.terrainMode;
  const raw = t.heights;
  let nshadow = false;
  if (newMode !== TERRAINMODE_CLASSIC8 && !t.rawShadow) nshadow = true;

  if (newMode === TERRAINMODE_FINE) {
    let nfine: Uint16Array;
    if (mode === TERRAINMODE_SPLINE && t.h16) nfine = terrainSplineExpand(t.h16);
    else if (mode === TERRAINMODE_CLASSIC16 && t.h16) nfine = planarExpand(t.h16);
    else {
      const tmp = new Uint16Array(COARSE);
      for (let i = 0; i < COARSE; i++) tmp[i] = raw[i] << 8;
      nfine = planarExpand(tmp);
    }
    t.h16 = null;
    t.fine = nfine;
  } else if (newMode === TERRAINMODE_CLASSIC8) {
    refreshRaw(t);
    t.h16 = t.fine = t.rawShadow = null;
  } else {
    if (t.fine) {
      const nh16 = new Uint16Array(COARSE);
      for (let z = 0; z < 256; z++) for (let x = 0; x < 256; x++) nh16[x + (z << 8)] = t.fine[((4 * z) << 10) + 4 * x];
      t.fine = null;
      t.h16 = nh16;
    } else if (!t.h16) {
      const nh16 = new Uint16Array(COARSE);
      for (let i = 0; i < COARSE; i++) nh16[i] = raw[i] << 8;
      t.h16 = nh16;
    }
  }
  if (nshadow) t.rawShadow = raw.slice(0, COARSE);
  t.terrainMode = newMode;
  refreshRaw(t);
  heightsChanged(t);
  return true;
}

/**
  ImportHeights: a height file of 64 KB, 128 KB or 2 MB into `targetMode`. A 2 MB file only goes to
  FINE. A coarse file going to FINE is PlanarExpanded after the switch.
*/
export function importHeights(t: Terrain16, data: Uint8Array, targetMode: number): boolean {
  const length = data.length;
  if (targetMode < TERRAINMODE_CLASSIC8 || targetMode > TERRAINMODE_FINE) return false;
  if (length !== COARSE && length !== COARSE * 2 && length !== FINE * 2) return false;
  if (length === FINE * 2 && targetMode !== TERRAINMODE_FINE) return false;
  const word = (i: number) => data[2 * i] | (data[2 * i + 1] << 8);
  let tmp: Uint16Array | null = null;
  if (length !== FINE * 2 && targetMode === TERRAINMODE_FINE) {
    tmp = new Uint16Array(COARSE);
    for (let i = 0; i < COARSE; i++) tmp[i] = length === COARSE ? data[i] << 8 : word(i);
  }
  if (!setMode(t, targetMode)) return false;
  if (targetMode === TERRAINMODE_FINE) {
    if (tmp) planarExpand(tmp, t.fine!);
    else for (let i = 0; i < FINE; i++) t.fine![i] = word(i);
  } else if (targetMode === TERRAINMODE_CLASSIC8) {
    for (let i = 0; i < COARSE; i++) t.heights[i] = length === COARSE ? data[i] : mirrorOf(word(i));
  } else {
    for (let i = 0; i < COARSE; i++) t.h16![i] = length === COARSE ? data[i] << 8 : word(i);
  }
  refreshRaw(t);
  heightsChanged(t);
  return true;
}

/** GetSurface: the 1024 x 1024 grid the truck drives on (FINE's own, SPLINE's cached spline), else null. */
export function getSurface(t: Terrain16): Uint16Array | null {
  if (t.terrainMode === TERRAINMODE_FINE) return t.fine;
  if (t.terrainMode !== TERRAINMODE_SPLINE || !t.h16) return null;
  const c = surfaceCache.get(t);
  if (c && c.h16 === t.h16) return c.surface;
  const surface = terrainSplineExpand(t.h16);
  surfaceCache.set(t, { h16: t.h16, surface });
  return surface;
}

/** CornerV: the 32 ft corner in v, wrapped. */
export function cornerV(t: Terrain16, gx: number, gy: number): number {
  gx &= 255; gy &= 255;
  if (t.fine) return t.fine[4 * gx + ((4 * gy) << 10)];
  if (t.h16) return t.h16[gx + (gy << 8)];
  return t.heights[gx + (gy << 8)] << 8;
}

/** FineV: the 8 ft point in v, wrapped; off the coarse triangles when there is no fine surface. */
export function fineV(t: Terrain16, fx: number, fy: number): number {
  const s = getSurface(t);
  if (s) return s[(fx & 1023) + ((fy & 1023) << 10)];
  return surfaceHeightV(t, fx * 4096, fy * 4096);
}

/*
  TriangleV: one cell's triangle, exact. Traxx uses 64-bit; the largest sum here is
  65535 * 16384 * 2 < 2^31 * 2, so plain doubles hold it exactly; the shift is a floor division.
*/
function triangleV(parity: number, h00: number, h10: number, h01: number, h11: number, xf: number, yf: number, shift: number): number {
  const d = 2 ** shift;
  let n: number;
  if (!parity) n = xf >= yf ? h00 * (d - xf) + h10 * (xf - yf) + h11 * yf : h00 * (d - yf) + h01 * (yf - xf) + h11 * xf;
  else n = xf + yf <= d ? h00 * (d - xf - yf) + h10 * xf + h01 * yf : h11 * (xf + yf - d) + h01 * (d - xf) + h10 * (d - yf);
  return Math.floor((n + d / 2) / d);
}

/**
  SurfaceHeightV: the drive surface in v at (px, py) in 1/256 ipos. CLASSIC8 keeps the engine's
  truncating, edge-clamped InterpolateRawAtPoint.
*/
export function surfaceHeightV(t: Terrain16, px: number, py: number): number {
  if (t.terrainMode === TERRAINMODE_CLASSIC8) return interpolateRawAtPoint(t.heights, px >> 8, py >> 8) << 8;
  const s = getSurface(t);
  if (s) {
    const fx = (px >> 12) & 1023, fy = (py >> 12) & 1023;
    const fx1 = (fx + 1) & 1023, fy1 = (fy + 1) & 1023;
    return triangleV((fx + fy) & 1, s[fx + (fy << 10)], s[fx1 + (fy << 10)], s[fx + (fy1 << 10)], s[fx1 + (fy1 << 10)], px & 4095, py & 4095, 12);
  }
  const h16 = t.h16;
  if (!h16) return 0;
  const gx = (px >> 14) & 255, gy = (py >> 14) & 255;
  const gx1 = (gx + 1) & 255, gy1 = (gy + 1) & 255;
  return triangleV((gx + gy) & 1, h16[gx + (gy << 8)], h16[gx1 + (gy << 8)], h16[gx + (gy1 << 8)], h16[gx1 + (gy1 << 8)], px & 16383, py & 16383, 14);
}

/** GroundAt: the ground under ipos (ix + ixf / 256, iy + iyf / 256) as a whole step and its 1/256 fraction. */
export function groundAt(t: Terrain16, ix: number, iy: number, ixf = 0, iyf = 0): { z: number; zfrac: number } {
  if (t.terrainMode === TERRAINMODE_CLASSIC8) return { z: interpolateRawAtPoint(t.heights, ix, iy), zfrac: 0 };
  const v = surfaceHeightV(t, ix * 256 + ixf, iy * 256 + iyf);
  return { z: v >> 8, zfrac: v & 255 };
}

/** VegGroundHeight's non-classic branch: feet at world feet (x, z). */
export function surfaceFeet(t: Terrain16, x: number, z: number): number {
  return Math.fround(surfaceHeightV(t, Math.floor(x * 512 + 0.5), Math.floor(z * 512 + 0.5)) / 128);
}

/** AdjustedHeight: a scale rounds half up (with Traxx's 1e-9), a lift adds; clamped to 0..65535. */
function adjustedHeight(h: number, scale: boolean, lift16: number, f: number): number {
  const v = scale ? Math.floor(h * f + 0.5 + 1e-9) : h + lift16;
  return v < 0 ? 0 : v > 65535 ? 65535 : Math.trunc(v);
}

/** AdjustHeights16 (CLASSIC16 and SPLINE) and AdjustHeightsFine (FINE): Adjust Heights on the real grid. */
export function adjustHeights16(t: Terrain16, scale: boolean, lift16: number, f: number): boolean {
  const g = t.fine ?? t.h16;
  if (!g) return false;
  for (let i = 0; i < g.length; i++) g[i] = adjustedHeight(g[i], scale, lift16, f);
  refreshRaw(t);
  heightsChanged(t);
  return true;
}

/** SmoothFineFromCoarse: every 8 ft point rebuilt from the 32 ft points with the game's spline (FINE only). */
export function smoothFineFromCoarse(t: Terrain16): boolean {
  const fine = t.fine;
  if (!fine) return false;
  const coarse = new Uint16Array(COARSE);
  for (let z = 0; z < 256; z++) for (let x = 0; x < 256; x++) coarse[x + (z << 8)] = fine[4 * x + ((4 * z) << 10)];
  fine.set(terrainSplineExpand(coarse));
  refreshRaw(t);
  heightsChanged(t);
  return true;
}

/** TerrainConvertMessage: the Terrain Grid question, word for word. */
export function terrainConvertMessage(from: number, to: number): string {
  let text = `Convert this track's terrain from ${terrainModeName(from)} to ${terrainModeName(to)}?\n`;
  if (from === TERRAINMODE_CLASSIC8) text += "\n8-bit heights become 16-bit exactly.";
  if (to === TERRAINMODE_FINE) text += "\n16-bit Full Map is filled from the current surface. Spline keeps the smoothed surface, the others keep the 32 ft triangles.";
  if (to === TERRAINMODE_SPLINE) text += "\n16-bit Spline: the game rounds the whole map, jump lips included - a lip becomes a rounded edge about one 32 ft tile wide.";
  if (to === TERRAINMODE_FINE) text += "\n16-bit Full Map: you set every 8 ft point. It is the only way to get crisp lips, sharp ramp edges or ruts on smooth terrain.";
  if (to === TERRAINMODE_CLASSIC8 && from !== TERRAINMODE_CLASSIC8) text += "\n16-bit -> Classic 8-bit rounds to 2 ft steps.";
  if (from === TERRAINMODE_FINE && to !== TERRAINMODE_FINE) text += "\nFull Map -> 32 ft keeps every 4th point.";
  if (to === TERRAINMODE_SPLINE || to === TERRAINMODE_FINE) {
    text += "\n\nAI trucks are not tuned for Spline / Full Map tracks yet. To check the terrain in game, set terrainLog=1 under [Graphics] in system\\monster.ini; the game then writes terrain.txt.";
  }
  text += "\n\nThe terrain undo is cleared by this.";
  return text;
}

/*
  The lakes' ground (BuildLakeGround). CLASSIC8 hands over raw; the drive surface hands over each
  32 ft tile's lowest point in u = v >> 1 and the CORNER_AT_H test of its mode.

  Traxx 1.7.1 (the spillway notches, 423373b): the individual ground points too. `step` is how
  many lattice steps a tile is wide (1 on Classic 16-bit, the corners; 4 on Spline and Full Map,
  the 5 x 5 fine points), `pointU` the ground at lattice point (px, pz) in u, both wrapped
  (Coarse4PointU, FinePointU). Classic 8-bit reads raw and leaves them 0 / null.
*/
export interface LakeGround {
  raw: Uint8Array | null;
  tilemin: Int32Array | null;
  groundAtLevel: ((tile: number, u: number) => boolean) | null;
  step?: number;
  pointU?: ((px: number, pz: number) => number) | null;
}

/** BuildLakeGround (after LakeGroundFor's SyncFromRaw). Null when there is no surface to fill on. */
export function buildLakeGround(t: Terrain16): LakeGround | null {
  if (t.terrainMode === TERRAINMODE_CLASSIC8) return { raw: t.heights, tilemin: null, groundAtLevel: null, step: 0, pointU: null };
  if (t.terrainMode === TERRAINMODE_CLASSIC16 || t.terrainMode === TERRAINMODE_SPLINE) syncFromRaw(t);
  const tilemin = new Int32Array(COARSE);
  if (t.terrainMode === TERRAINMODE_CLASSIC16) {
    const h = t.h16;
    if (!h) return null;
    for (let z = 0; z < 256; z++) {
      const r0 = z << 8, r1 = ((z + 1) & 255) << 8;
      for (let x = 0; x < 256; x++) {
        const x1 = (x + 1) & 255;
        tilemin[x + r0] = Math.min(h[r0 + x], h[r0 + x1], h[r1 + x], h[r1 + x1]) >> 1;
      }
    }
    // Coarse4GroundAt: any of the four corners at u.
    const at = (tile: number, u: number) => {
      const x = tile & 255, z = (tile >> 8) & 255, x1 = (x + 1) & 255, z1 = (z + 1) & 255;
      return (h[x + (z << 8)] >> 1) === u || (h[x1 + (z << 8)] >> 1) === u || (h[x + (z1 << 8)] >> 1) === u || (h[x1 + (z1 << 8)] >> 1) === u;
    };
    return { raw: null, tilemin, groundAtLevel: at, step: 1, pointU: (px, pz) => h[(px & 255) + ((pz & 255) << 8)]! >> 1 };
  }
  const s = getSurface(t);
  if (!s) return null;
  for (let z = 0; z < 256; z++) {
    for (let x = 0; x < 256; x++) {
      let m = 65535;
      for (let dz = 0; dz <= 4; dz++) {
        const row = ((4 * z + dz) & 1023) << 10;
        for (let dx = 0; dx <= 4; dx++) { const v = s[row + ((4 * x + dx) & 1023)]; if (v < m) m = v; }
      }
      tilemin[x + (z << 8)] = m >> 1;
    }
  }
  // FineFlatGroundAt: some 8 ft triangle of the tile flat at u.
  const at = (tile: number, u: number) => {
    const fx0 = 4 * (tile & 255), fz0 = 4 * ((tile >> 8) & 255);
    const a = new Uint8Array(25);
    let n = 0;
    for (let dz = 0; dz <= 4; dz++) {
      const row = ((fz0 + dz) & 1023) << 10;
      for (let dx = 0; dx <= 4; dx++) { const on = (s[row + ((fx0 + dx) & 1023)] >> 1) === u ? 1 : 0; a[dz * 5 + dx] = on; n += on; }
    }
    if (n < 3) return false;
    for (let dz = 0; dz < 4; dz++) {
      for (let dx = 0; dx < 4; dx++) {
        const p = a[dz * 5 + dx], b = a[dz * 5 + dx + 1], c = a[(dz + 1) * 5 + dx + 1], d = a[(dz + 1) * 5 + dx];
        if (((dx ^ dz) & 1) === 0) { if ((p && b && c) || (p && c && d)) return true; }
        else if ((p && b && d) || (b && c && d)) return true;
      }
    }
    return false;
  };
  return { raw: null, tilemin, groundAtLevel: at, step: 4, pointU: (px, pz) => s[((pz & 1023) << 10) + (px & 1023)]! >> 1 };
}

// ---- The 32 ft and 8 ft height tools on a 16-bit grid (ApplyStamp16 and friends). ----

function stampAxis(g: number, size: number, wrapmask: number, wrap: boolean): number {
  if (wrap) return g & wrapmask;
  return g < 0 || g >= size ? -1 : g;
}

/**
  ApplyStamp16: the terrain brush on v. Modes: 5 Smooth (reads `undo`, rounds half up), 6 Plane
  (amount), 7 Manual (signed step, saturating), others add the stamp and clamp to 2 << 8 .. 65535.
  Fine-grid callers pass size 1024, wrapmask 1023, wrap true.
*/
export function applyStamp16(grid: Uint16Array, size: number, wrapmask: number, stamp: ArrayLike<number>, sw: number, sh: number, cx: number, cy: number,
  mode: number, amount: number, undo: Uint16Array | null, wrap: boolean): void {
  const ox = cx - ((sw - 1) >> 1), oy = cy - ((sh - 1) >> 1);
  const smooth = mode === 5;
  if (smooth && !undo) return;
  for (let j = smooth ? 1 : 0; j < (smooth ? sh - 1 : sh); j++) {
    const gy = stampAxis(j + oy, size, wrapmask, wrap);
    if (gy < 0 || (smooth && !wrap && (gy < 1 || gy > size - 2))) continue;
    for (let i = smooth ? 1 : 0; i < (smooth ? sw - 1 : sw); i++) {
      const gx = stampAxis(i + ox, size, wrapmask, wrap);
      if (gx < 0 || (smooth && !wrap && (gx < 1 || gx > size - 2))) continue;
      const k = gx + gy * size;
      let v: number;
      if (smooth) {
        const gxm = (gx - 1) & wrapmask, gxp = (gx + 1) & wrapmask, gym = (gy - 1) & wrapmask, gyp = (gy + 1) & wrapmask;
        v = (undo![gx + gyp * size] + undo![gx + gym * size] + undo![gxp + gy * size] + undo![gxm + gy * size] + 2) >> 2;
      } else if (mode === 7) {
        v = grid[k] + amount;
        v = v < 0 ? 0 : v > 65535 ? 65535 : v;
      } else if (mode === 6) {
        v = amount > 0 ? amount : 0;
        if (v > 65535) v = 65535;
      } else {
        v = grid[k] + stamp[i + j * sw];
        v = v < 2 << 8 ? 2 << 8 : v > 65535 ? 65535 : v;
      }
      grid[k] = v;
    }
  }
}

/** StampCopy16: the block under a stamp. */
export function stampCopy16(grid: Uint16Array, size: number, wrapmask: number, block: Uint16Array, sw: number, sh: number, cx: number, cy: number, wrap: boolean): void {
  const ox = cx - ((sw - 1) >> 1), oy = cy - ((sh - 1) >> 1);
  for (let j = 0; j < sh; j++) {
    const gy = stampAxis(j + oy, size, wrapmask, wrap);
    if (gy < 0) continue;
    for (let i = 0; i < sw; i++) { const gx = stampAxis(i + ox, size, wrapmask, wrap); if (gx >= 0) block[i + j * sw] = grid[gx + gy * size]; }
  }
}

/** StampPaste16: a block back onto the grid. */
export function stampPaste16(grid: Uint16Array, size: number, wrapmask: number, block: Uint16Array, sw: number, sh: number, cx: number, cy: number, wrap: boolean): void {
  const ox = cx - ((sw - 1) >> 1), oy = cy - ((sh - 1) >> 1);
  for (let j = 0; j < sh; j++) {
    const gy = stampAxis(j + oy, size, wrapmask, wrap);
    if (gy < 0) continue;
    for (let i = 0; i < sw; i++) { const gx = stampAxis(i + ox, size, wrapmask, wrap); if (gx >= 0) grid[gx + gy * size] = block[i + j * sw]; }
  }
}

/** FineVertexAtPoint: the nearest 8 ft point to (px, py), as fx | fy << 16. */
export function fineVertexAtPoint(px: number, py: number): number {
  const fx = ((px + 2048) >> 12) & 1023, fy = ((py + 2048) >> 12) & 1023;
  return fx | (fy << 16);
}

/**
  SurfaceTileMinMax: each 32 ft tile's lowest and highest surface point in u = v >> 1: the 4
  corners on 16-bit, the 25 8 ft points on Spline and Full Map. Null on Classic 8-bit or without
  a surface. Body 0's line grid is the tile wholly under the water (max < 32 * H,
  SurfaceWaterGridWet), its fill any water on the tile (min <= 32 * H, SurfaceWaterFillWet).
*/
export function tileMinMaxU(t: Terrain16): { min: Int32Array; max: Int32Array } | null {
  if (t.terrainMode === TERRAINMODE_CLASSIC8) return null;
  const min = new Int32Array(COARSE), max = new Int32Array(COARSE);
  const s = getSurface(t);
  for (let z = 0; z < 256; z++) {
    for (let x = 0; x < 256; x++) {
      let lo = 65535, hi = 0;
      if (s) {
        for (let dz = 0; dz <= 4; dz++) {
          const row = ((4 * z + dz) & 1023) << 10;
          for (let dx = 0; dx <= 4; dx++) { const v = s[row + ((4 * x + dx) & 1023)]!; if (v < lo) lo = v; if (v > hi) hi = v; }
        }
      } else {
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) { const v = cornerV(t, x + dx, z + dz); if (v < lo) lo = v; if (v > hi) hi = v; }
      }
      min[x + (z << 8)] = lo >> 1;
      max[x + (z << 8)] = hi >> 1;
    }
  }
  return { min, max };
}
