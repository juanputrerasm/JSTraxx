/*
  Picking the terrain under the pointer: the ray walked cell by cell across the heightfield
  (a 2D DDA), each cell's two triangles tested exactly, split along the same checkerboard
  diagonal the view draws and InterpolateRawAtPoint uses. Scene units: x and y ipos, z
  ALTITUDESCALE units.

  Traxx 1.7 (COpenGLTerrainRenderer::PickSurfaceRay, b100b6b and 9f861ea): every mode but
  Classic 8-bit picks on the drive surface itself (pickSurface): the ray walked across the
  window's 32 ft triangles, refined on Spline and Full Map against SurfaceHeightV, the point
  kept with its 1/256 fractions.

  Traxx 1.7.1 world-wrap border (3f26cfc, e7bdc4b): the pick geometry is the ground as drawn,
  the map plus its 3-cell border of wrapped copies (SurfaceCornerInWrapBand); a hit whose point
  is off the map's 0..N-1 cells is no hit (N = 256, or a track format version 6 world's
  worldCells, spec section 8.1), so a click on the border does nothing and is never
  wrapped onto a real cell. The point is floored, so a hit just past the low edge is off it.
*/
import { ALTITUDE_SCALE } from "./camera.ts";
import type { Terrain16 } from "../traxx/terrain16.ts";
import { TERRAINMODE_CLASSIC8 } from "../traxx/terrain16.ts";
import { pickPoint, pickRay } from "../traxx/surface-pick.ts";
import { SURFACE_WRAP_BORDER_CELLS } from "./surface-tiles.ts";
import { cellsOf, sideOf } from "../traxx/world.ts";

/** PickTerrainRay's border test: the hit's whole ipos point is off the map of `cells` a side. */
function offMap(x: number, y: number, cells = 256): boolean {
  return x < 0 || x >= cells << 6 || y < 0 || y >= cells << 6;
}

export interface TerrainHit {
  /** The point hit, in scene units. */
  point: [number, number, number];
  /** The cell hit. */
  cell: [number, number];
  /** The nearest grid vertex to the point. */
  vertex: [number, number];
  /** Distance along the ray. */
  t: number;
  /**
    The point as Traxx's pick gives it (ScreenToTerrainPoint): whole ipos x, y and whole steps z,
    and the 1/256 left over on each (always 0 on Classic 8-bit, where the point is truncated).
  */
  ipos: [number, number, number];
  fraction: [number, number, number];
}

type V3 = [number, number, number];

function triangle(o: V3, d: V3, a: V3, b: V3, c: V3): number {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return -1;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return -1;
  const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
  return t >= 0 ? t : -1;
}

/** The first terrain cell the ray hits, or null. `dir` need not be normalised. */
export function pickTerrain(heights: Uint8Array, origin: V3, dir: V3, maxT = 1e6): TerrainHit | null {
  // The heights are N x N (spec section 8.2), so they say N.
  const cells = sideOf(heights.length), mask = cells - 1;
  // The cells the ground is drawn on: the map and the border, -3..N+2; corners wrap & (N - 1).
  const lo = -SURFACE_WRAP_BORDER_CELLS, hi = mask + SURFACE_WRAP_BORDER_CELLS;
  const corner = (i: number, j: number): V3 => [i * 64, j * 64, ALTITUDE_SCALE * heights[(i & mask) + (j & mask) * cells]];
  const hitCell = (i: number, j: number): number => {
    if (i < lo || j < lo || i > hi || j > hi) return -1;
    const v00 = corner(i, j), v10 = corner(i + 1, j), v11 = corner(i + 1, j + 1), v01 = corner(i, j + 1);
    const tris: [V3, V3, V3][] = ((i + j) & 1) ? [[v01, v11, v10], [v10, v00, v01]] : [[v00, v01, v11], [v11, v10, v00]];
    let best = -1;
    for (const [a, b, c] of tris) {
      const t = triangle(origin, dir, a, b, c);
      if (t >= 0 && (best < 0 || t < best)) best = t;
    }
    return best;
  };
  // Start where the ray enters the map's square, if it starts outside.
  let tEnter = 0, tExit = maxT;
  for (const k of [0, 1] as const) {
    if (Math.abs(dir[k]) < 1e-12) { if (origin[k] < lo * 64 || origin[k] > (hi + 1) * 64) return null; continue; }
    let t0 = (lo * 64 - origin[k]) / dir[k], t1 = ((hi + 1) * 64 - origin[k]) / dir[k];
    if (t0 > t1) [t0, t1] = [t1, t0];
    tEnter = Math.max(tEnter, t0);
    tExit = Math.min(tExit, t1);
  }
  if (tEnter > tExit) return null;
  const px = origin[0] + dir[0] * tEnter, py = origin[1] + dir[1] * tEnter;
  let i = Math.min(hi, Math.max(lo, Math.floor(px / 64))), j = Math.min(hi, Math.max(lo, Math.floor(py / 64)));
  const stepX = dir[0] > 0 ? 1 : -1, stepY = dir[1] > 0 ? 1 : -1;
  const nextX = (n: number) => ((stepX > 0 ? n + 1 : n) * 64 - origin[0]) / dir[0];
  const nextY = (n: number) => ((stepY > 0 ? n + 1 : n) * 64 - origin[1]) / dir[1];
  let tMaxX = Math.abs(dir[0]) < 1e-12 ? Infinity : nextX(i);
  let tMaxY = Math.abs(dir[1]) < 1e-12 ? Infinity : nextY(j);
  const tDeltaX = Math.abs(dir[0]) < 1e-12 ? Infinity : 64 / Math.abs(dir[0]);
  const tDeltaY = Math.abs(dir[1]) < 1e-12 ? Infinity : 64 / Math.abs(dir[1]);
  for (let guard = 0, guards = Math.max(1024, 4 * (cells + 6)); guard < guards; guard++) {
    const t = hitCell(i, j);
    if (t >= 0 && t <= tExit + 1e-6) {
      const point: V3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
      const ix = Math.floor(point[0]), iy = Math.floor(point[1]);
      if (offMap(ix, iy, cells)) return null;
      return {
        point, cell: [ix >> 6, iy >> 6], vertex: [Math.round(point[0] / 64) & mask, Math.round(point[1] / 64) & mask], t,
        ipos: [ix, iy, Math.trunc(point[2] / ALTITUDE_SCALE)], fraction: [0, 0, 0],
      };
    }
    if (tMaxX < tMaxY) { i += stepX; tMaxX += tDeltaX; } else { j += stepY; tMaxY += tDeltaY; }
    if (i < lo || j < lo || i > hi || j > hi || Math.min(tMaxX, tMaxY) - Math.min(tDeltaX, tDeltaY) > tExit) break;
  }
  return null;
}

/**
  PickSurfaceRay: the pick on a 16-bit, Spline or Full Map track, in scene units. The window is
  the grid window's cells x0..x0 + n - 2, y0..y0 + n - 2 (n = gridsize), as Traxx passes
  lastgridx0 .. lastgridx0 + n - 2; heights beyond the map are 0. Scene to surface space: x, y
  times 256 (1/256 ipos), z times 256 / ALTITUDE_SCALE (v). The vertex is the nearer corner of
  the (window-clamped) cell on each axis, as PickSurfaceRay's vertexindex. Null on Classic 8-bit
  and on a miss. JSTraxx's ray starts at the camera with tmin 0 (Traxx's 8 is its near plane).
*/
export function pickSurface(t: Terrain16, origin: V3, dir: V3, window: { x0: number; y0: number; n: number }): TerrainHit | null {
  if (t.terrainMode === TERRAINMODE_CLASSIC8 || window.n < 2) return null;
  const zs = 256 / ALTITUDE_SCALE;
  const org = [origin[0] * 256, origin[1] * 256, origin[2] * zs] as const;
  const d = [dir[0] * 256, dir[1] * 256, dir[2] * zs] as const;
  const { x0, y0, n } = window;
  const hit = pickRay(t, org, d, 0, x0, y0, x0 + n - 2, y0 + n - 2);
  if (!hit) return null;
  const { px, py, v } = pickPoint(t, org, d, hit.t);
  const cells = cellsOf(t), last = cells - 1;
  if (offMap(px >> 8, py >> 8, cells)) return null;
  const ci = Math.min(n - 2, Math.max(0, hit.cellx - x0)), cj = Math.min(n - 2, Math.max(0, hit.celly - y0));
  const inx = px - (x0 + ci) * 16384, iny = py - (y0 + cj) * 16384;
  const vx = x0 + ci + (inx >= 8192 ? 1 : 0), vy = y0 + cj + (iny >= 8192 ? 1 : 0);
  return {
    point: [px / 256, py / 256, (ALTITUDE_SCALE * v) / 256],
    // On the map (the border was refused above); the vertex past cell N - 1 is column / row 0.
    cell: [Math.min(last, Math.max(0, x0 + ci)), Math.min(last, Math.max(0, y0 + cj))],
    vertex: [vx & last, vy & last],
    t: hit.t,
    ipos: [px >> 8, py >> 8, v >> 8],
    fraction: [px & 255, py & 255, v & 255],
  };
}
