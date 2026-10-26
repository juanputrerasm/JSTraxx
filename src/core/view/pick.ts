/*
  Picking the terrain under the pointer: the ray walked cell by cell across the heightfield
  (a 2D DDA), each cell's two triangles tested exactly, split along the same checkerboard
  diagonal the view draws and InterpolateRawAtPoint uses. Scene units: x and y ipos, z
  ALTITUDESCALE units.
*/
import { ALTITUDE_SCALE } from "./camera.ts";

export interface TerrainHit {
  /** The point hit, in scene units. */
  point: [number, number, number];
  /** The cell hit. */
  cell: [number, number];
  /** The nearest grid vertex to the point. */
  vertex: [number, number];
  /** Distance along the ray. */
  t: number;
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
  const corner = (i: number, j: number): V3 => [i * 64, j * 64, ALTITUDE_SCALE * heights[Math.min(255, i) + (Math.min(255, j) << 8)]];
  const hitCell = (i: number, j: number): number => {
    if (i < 0 || j < 0 || i > 254 || j > 254) return -1;
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
    if (Math.abs(dir[k]) < 1e-12) { if (origin[k] < 0 || origin[k] > 255 * 64) return null; continue; }
    let t0 = (0 - origin[k]) / dir[k], t1 = (255 * 64 - origin[k]) / dir[k];
    if (t0 > t1) [t0, t1] = [t1, t0];
    tEnter = Math.max(tEnter, t0);
    tExit = Math.min(tExit, t1);
  }
  if (tEnter > tExit) return null;
  const px = origin[0] + dir[0] * tEnter, py = origin[1] + dir[1] * tEnter;
  let i = Math.min(254, Math.max(0, Math.floor(px / 64))), j = Math.min(254, Math.max(0, Math.floor(py / 64)));
  const stepX = dir[0] > 0 ? 1 : -1, stepY = dir[1] > 0 ? 1 : -1;
  const nextX = (n: number) => ((stepX > 0 ? n + 1 : n) * 64 - origin[0]) / dir[0];
  const nextY = (n: number) => ((stepY > 0 ? n + 1 : n) * 64 - origin[1]) / dir[1];
  let tMaxX = Math.abs(dir[0]) < 1e-12 ? Infinity : nextX(i);
  let tMaxY = Math.abs(dir[1]) < 1e-12 ? Infinity : nextY(j);
  const tDeltaX = Math.abs(dir[0]) < 1e-12 ? Infinity : 64 / Math.abs(dir[0]);
  const tDeltaY = Math.abs(dir[1]) < 1e-12 ? Infinity : 64 / Math.abs(dir[1]);
  for (let guard = 0; guard < 1024; guard++) {
    const t = hitCell(i, j);
    if (t >= 0 && t <= tExit + 1e-6) {
      const point: V3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
      return { point, cell: [i, j], vertex: [Math.min(255, Math.round(point[0] / 64)), Math.min(255, Math.round(point[1] / 64))], t };
    }
    if (tMaxX < tMaxY) { i += stepX; tMaxX += tDeltaX; } else { j += stepY; tMaxY += tDeltaY; }
    if (i < 0 || j < 0 || i > 254 || j > 254 || Math.min(tMaxX, tMaxY) - Math.min(tDeltaX, tDeltaY) > tExit) break;
  }
  return null;
}
