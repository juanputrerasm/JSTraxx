/*
  Picking on the drive surface, every mode but Classic 8-bit (TrackPOD/TrackPODTerrain.cpp:
  PickCornerV, PickTriangle, RayCoarseHit, PickSurfaceV, RefineRayOnSurface, PickRay, PickPoint).

  A ray in surface space, P = org + t dir: x, y in 1/256 ipos (16384 per 32 ft cell, 512 per
  foot), z in v (128 per foot). Corners wrap (& (N - 1)) within the world-wrap border, 3 cells past
  the map, as the ground is drawn; further out they are 0 (Traxx 1.7.1).
*/
import type { Terrain16 } from "./terrain16.ts";
import { TERRAINMODE_CLASSIC8, TERRAINMODE_FINE, TERRAINMODE_SPLINE } from "./terrain16.ts";
import { cornerV, surfaceHeightV } from "./surface.ts";
import { cellsOf } from "./world.ts";
import { surfaceCornerInWrapBand } from "../view/surface-tiles.ts";

type V3 = readonly [number, number, number];
const CELL = 16384;

/* PickCornerV (1.7.1): within the drawn border (3 cells) the ground is the wrapped copy; further out nothing is drawn (0). */
function pickCornerV(t: Terrain16, gx: number, gy: number): number {
  if (!surfaceCornerInWrapBand(gx, gy, cellsOf(t))) return 0;
  return cornerV(t, gx, gy); // cornerV wraps at N (track format version 6, spec section 8.1)
}

/* PickTriangle: Moller-Trumbore in doubles, the det threshold relative (the axes are in different units). */
function pickTriangle(o: V3, d: V3, a: V3, b: V3, c: V3, tmin: number): number | null {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = [d[1] * e2[2]! - d[2] * e2[1]!, d[2] * e2[0]! - d[0] * e2[2]!, d[0] * e2[1]! - d[1] * e2[0]!];
  const det = e1[0]! * p[0]! + e1[1]! * p[1]! + e1[2]! * p[2]!;
  const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const q = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
  const n1 = Math.hypot(e1[0]!, e1[1]!, e1[2]!), n2 = Math.hypot(p[0]!, p[1]!, p[2]!);
  if (Math.abs(det) <= 1e-12 * n1 * n2) return null;
  const u = (s[0]! * p[0]! + s[1]! * p[1]! + s[2]! * p[2]!) / det;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const v = (d[0] * q[0]! + d[1] * q[1]! + d[2] * q[2]!) / det;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const tt = (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) / det;
  if (tt < tmin - 1e-12) return null;
  return tt;
}

/**
  RayCoarseHit: the first of the window's 32 ft triangles (cells cx0..cx1, cy0..cy1 inclusive,
  the engine's diagonals) the ray meets at t >= tmin, by a cell-to-cell walk; exact on 16-bit.
*/
export function rayCoarseHit(t: Terrain16, org: V3, dir: V3, tmin: number, cx0: number, cy0: number, cx1: number, cy1: number): { t: number; cellx: number; celly: number } | null {
  if (cx1 < cx0 || cy1 < cy0) return null;
  const lo = [cx0 * CELL, cy0 * CELL], hi = [(cx1 + 1) * CELL, (cy1 + 1) * CELL];
  let tenter = tmin, texit = 1e300;
  for (let a = 0; a < 2; a++) {
    if (dir[a] === 0) {
      if (org[a]! < lo[a]! || org[a]! >= hi[a]!) return null;
    } else {
      let t1 = (lo[a]! - org[a]!) / dir[a]!, t2 = (hi[a]! - org[a]!) / dir[a]!;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tenter) tenter = t1;
      if (t2 < texit) texit = t2;
    }
  }
  if (tenter > texit) return null;
  if (texit > 1e299) texit = tenter + 1e12;

  let cx = Math.floor((org[0] + tenter * dir[0]) / CELL), cy = Math.floor((org[1] + tenter * dir[1]) / CELL);
  cx = Math.min(cx1, Math.max(cx0, cx));
  cy = Math.min(cy1, Math.max(cy0, cy));
  const sx = dir[0] > 0 ? 1 : -1, sy = dir[1] > 0 ? 1 : -1;
  let tmaxx = 1e300, tmaxy = 1e300, tdx = 1e300, tdy = 1e300;
  if (dir[0] !== 0) { tmaxx = ((sx > 0 ? cx + 1 : cx) * CELL - org[0]) / dir[0]; tdx = CELL / Math.abs(dir[0]); }
  if (dir[1] !== 0) { tmaxy = ((sy > 0 ? cy + 1 : cy) * CELL - org[1]) / dir[1]; tdy = CELL / Math.abs(dir[1]); }

  let tcur = tenter;
  let guard = cx1 - cx0 + (cy1 - cy0) + 4;
  while (guard-- > 0) {
    let tout = tmaxx < tmaxy ? tmaxx : tmaxy;
    if (tout > texit) tout = texit;
    const h00 = pickCornerV(t, cx, cy), h10 = pickCornerV(t, cx + 1, cy), h01 = pickCornerV(t, cx, cy + 1), h11 = pickCornerV(t, cx + 1, cy + 1);
    const top = Math.max(h00, h10, h01, h11);
    // Above the cell's highest corner at both ends of its stay: neither triangle can be met.
    const zin = org[2] + tcur * dir[2], zout = org[2] + tout * dir[2];
    if (zin <= top + 1 || zout <= top + 1) {
      const x0 = cx * CELL, x1 = (cx + 1) * CELL, y0 = cy * CELL, y1 = (cy + 1) * CELL;
      const A: V3 = [x0, y0, h00], B: V3 = [x1, y0, h10], C: V3 = [x0, y1, h01], D: V3 = [x1, y1, h11];
      const tris: [V3, V3, V3][] = ((cx + cy) & 1) === 0 ? [[A, B, D], [A, D, C]] : [[A, B, C], [D, C, B]];
      let best = 1e300, got = false;
      for (const [p, q, r] of tris) {
        const t1 = pickTriangle(org, dir, p, q, r, tmin);
        if (t1 !== null && t1 < best) { best = t1; got = true; }
      }
      if (got) return { t: best, cellx: cx, celly: cy };
    }
    if (tout >= texit) break;
    tcur = tout;
    if (tmaxx < tmaxy) {
      cx += sx; tmaxx += tdx;
      if (cx < cx0 || cx > cx1) break;
    } else {
      cy += sy; tmaxy += tdy;
      if (cy < cy0 || cy > cy1) break;
    }
  }
  return null;
}

/* PickSurfaceV: the surface at a point of the ray, 0 beyond the map. */
function pickSurfaceV(t: Terrain16, px: number, py: number): number {
  const side = cellsOf(t) * CELL;
  if (px < 0 || py < 0 || px >= side || py >= side) return 0;
  return surfaceHeightV(t, Math.floor(px + 0.5), Math.floor(py + 0.5));
}

/**
  RefineRayOnSurface (Spline and Full Map): march from 64 ft before the coarse hit to 64 ft past
  it in 2 ft steps against SurfaceHeightV and bisect the first above-to-under step (30 halvings).
  When the start is already under the surface (a fine crest above the coarse chord), it steps
  back toward tmin 64 ft at a time first (9f861ea). Null (keep the coarse t) when there is no
  such step or the mode is another.
*/
export function refineRayOnSurface(t: Terrain16, org: V3, dir: V3, tmin: number, coarset: number): number | null {
  if (t.terrainMode !== TERRAINMODE_SPLINE && t.terrainMode !== TERRAINMODE_FINE) return null;
  const fx = dir[0] / 512, fy = dir[1] / 512, fz = dir[2] / 128;
  const len = Math.sqrt(fx * fx + fy * fy + fz * fz);
  if (len <= 0) return null;
  const dt = 2 / len, span = 64 / len;
  let t0 = coarset - span;
  const t1 = coarset + span;
  if (t0 < tmin) t0 = tmin;
  const f = (tt: number) => org[2] + tt * dir[2] - pickSurfaceV(t, org[0] + tt * dir[0], org[1] + tt * dir[1]);
  let prev = t0;
  let fprev = f(prev);
  while (fprev <= 0 && prev > tmin) {
    prev -= span;
    if (prev < tmin) prev = tmin;
    fprev = f(prev);
  }
  if (fprev <= 0) return null;
  for (;;) {
    let cur = prev + dt;
    if (cur > t1) cur = t1;
    if (f(cur) <= 0) {
      let a = prev, b = cur;
      for (let i = 0; i < 30; i++) {
        const m = 0.5 * (a + b);
        if (f(m) > 0) a = m; else b = m;
      }
      return b;
    }
    if (cur >= t1) return null;
    prev = cur;
  }
}

/** PickRay: the coarse hit, refined on Spline and Full Map. Null on Classic 8-bit and on a miss. */
export function pickRay(t: Terrain16, org: V3, dir: V3, tmin: number, cx0: number, cy0: number, cx1: number, cy1: number): { t: number; cellx: number; celly: number } | null {
  if (t.terrainMode === TERRAINMODE_CLASSIC8) return null;
  const coarse = rayCoarseHit(t, org, dir, tmin, cx0, cy0, cx1, cy1);
  if (!coarse) return null;
  const refined = refineRayOnSurface(t, org, dir, tmin, coarse.t);
  const tt = refined ?? coarse.t;
  return { t: tt, cellx: Math.floor((org[0] + tt * dir[0]) / CELL), celly: Math.floor((org[1] + tt * dir[1]) / CELL) };
}

/** PickPoint: the hit as 1/256 ipos integers (rounded half up) and the surface v there. */
export function pickPoint(t: Terrain16, org: V3, dir: V3, tt: number): { px: number; py: number; v: number } {
  const x = org[0] + tt * dir[0], y = org[1] + tt * dir[1];
  return { px: Math.floor(x + 0.5), py: Math.floor(y + 0.5), v: pickSurfaceV(t, x, y) };
}
