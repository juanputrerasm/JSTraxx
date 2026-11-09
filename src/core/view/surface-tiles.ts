/*
  The drive surface's tiles as Traxx 1.7 draws them (Traxx/SurfaceMesh.cpp: SurfaceTileLod,
  SurfaceTileNeighbourLods, SurfaceTileStraightSides, SurfaceTileHeightGrid; used by
  Traxx/OpenGLTerrainRenderer.cpp: SurfaceTileLodsFor, CompileSurfaceTileWireframeList,
  DrawLakes' wall rings, DrawVegetationMaskWashSurface).

  A tile is 4 x 4 cells (TRAXX_GL_TERRAIN_TILE_SIZE), 64 tiles an axis. On a Spline or Full Map
  track a tile within 8 tiles (TRAXX_GL_FINE_LOD_TILES, the larger of x and y) of the camera's
  tile is drawn from the 8 ft points, every other one from the 32 ft corners. 16-bit is 32 ft
  everywhere: its surface IS the 32 ft triangles. Classic 8-bit never comes here.

  No cracks: each side of an 8 ft tile that faces a 32 ft tile has its points moved onto the
  32 ft neighbour's straight edge (per 32 ft cell, between the cell's two corners), so both tiles
  draw the same edge. Drawing only: placement, editing and the lakes read the true surface.

  The camera's cell is the grid window's centre (DrawTerrainScene: lastgridx = gridx).

  Heights here are v (1/256 step) as floats; the view's z is ALTITUDE_SCALE * v / 256 (Traxx's
  SurfaceZOfV 0.75 v at its 4096 units a cell).
*/
import type { Terrain16 } from "../traxx/terrain16.ts";
import { TERRAINMODE_SPLINE, TERRAINMODE_FINE } from "../traxx/terrain16.ts";
import { cornerV, fineV } from "../traxx/surface.ts";

export const SURFACE_LOD_8FT = 8;
export const SURFACE_LOD_32FT = 32;
export const SURFACE_SIDE_LEFT = 0;
export const SURFACE_SIDE_RIGHT = 1;
export const SURFACE_SIDE_TOP = 2;
export const SURFACE_SIDE_BOTTOM = 3;
/** TRAXX_GL_TERRAIN_TILE_SIZE. */
export const TILE_SIZE = 4;
/** TRAXX_GL_TERRAIN_TILES_PER_AXIS: (255 / 4) + 1. */
export const TILES_PER_AXIS = 64;
/** TRAXX_GL_FINE_LOD_TILES. */
export const FINE_LOD_TILES = 8;
/** SURFACE_FINE_PER_CELL. */
const Q = 4;

/** The track has an 8 ft surface to draw (Spline, Full Map): SurfaceTileLodsFor's finesurface. */
export function hasFineLod(t: { terrainMode?: number }): boolean {
  return t.terrainMode === TERRAINMODE_SPLINE || t.terrainMode === TERRAINMODE_FINE;
}

/* SurfaceFloorDiv. */
function floorDiv(a: number, b: number): number {
  return a >= 0 ? Math.trunc(a / b) : -Math.trunc((-a + b - 1) / b);
}

/** SurfaceTileLod: 8 ft within `radius` tiles of the camera's tile on a fine surface, else 32 ft. */
export function surfaceTileLod(fine: boolean, tx: number, ty: number, camgx: number, camgy: number, tilesize = TILE_SIZE, radius = FINE_LOD_TILES): number {
  if (!fine || tilesize <= 0) return SURFACE_LOD_32FT;
  const dx = Math.abs(tx - floorDiv(camgx, tilesize)), dy = Math.abs(ty - floorDiv(camgy, tilesize));
  return dx <= radius && dy <= radius ? SURFACE_LOD_8FT : SURFACE_LOD_32FT;
}

/** SurfaceTileNeighbourLods: left, right, top, bottom; a neighbour off the map counts as the tile's own level. */
export function surfaceTileNeighbourLods(fine: boolean, tx: number, ty: number, camgx: number, camgy: number,
  tilesize = TILE_SIZE, radius = FINE_LOD_TILES, perAxis = TILES_PER_AXIS): [number, number, number, number] {
  const own = surfaceTileLod(fine, tx, ty, camgx, camgy, tilesize, radius);
  const step = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  return step.map(([sx, sy]) => {
    const nx = tx + sx, ny = ty + sy;
    return nx < 0 || ny < 0 || nx >= perAxis || ny >= perAxis ? own : surfaceTileLod(fine, nx, ny, camgx, camgy, tilesize, radius);
  }) as [number, number, number, number];
}

/** SurfaceTileStraightSides: bit 1 << side for each side of an 8 ft tile facing a 32 ft one. */
export function surfaceTileStraightSides(lod: number, nbr: readonly number[]): number {
  if (lod !== SURFACE_LOD_8FT) return 0;
  let sides = 0;
  for (let d = 0; d < 4; d++) if (nbr[d] === SURFACE_LOD_32FT) sides |= 1 << d;
  return sides;
}

/** SurfaceTileLodsFor: the tile's level and its neighbours', for the camera's cell. */
export function surfaceTileLodsFor(t: { terrainMode?: number }, tx: number, ty: number, camgx: number, camgy: number): { lod: number; nbr: [number, number, number, number] } {
  const fine = hasFineLod(t);
  return { lod: surfaceTileLod(fine, tx, ty, camgx, camgy), nbr: surfaceTileNeighbourLods(fine, tx, ty, camgx, camgy) };
}

/**
  SurfaceTileHeightGrid: the tile's heights as drawn, n x n points row-major (rows = y), in v:
  n = 5 at 32 ft (the corners), 17 at 8 ft (the 8 ft points, the straightened sides on the
  32 ft neighbours' chords: (a (4 - f) + b f) / 4, SurfaceStraightZ). Corners wrap, as CornerV
  and FineV do. A track without an 8 ft surface is always 32 ft.
*/
export function surfaceTileHeightGrid(t: Terrain16, tx: number, ty: number, lod: number, nbr: readonly number[]): { n: number; v: Float64Array } {
  const ts = TILE_SIZE, gx0 = tx * ts, gy0 = ty * ts;
  if (lod !== SURFACE_LOD_8FT || !hasFineLod(t)) {
    const n = ts + 1, v = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = cornerV(t, gx0 + i, gy0 + j);
    return { n, v };
  }
  const n = ts * Q + 1, v = new Float64Array(n * n);
  const fx0 = gx0 * Q, fy0 = gy0 * Q;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = fineV(t, fx0 + i, fy0 + j);
  const sides = surfaceTileStraightSides(lod, nbr);
  for (let d = 0; d < 4; d++) {
    if (!(sides & (1 << d))) continue;
    const vertical = d === SURFACE_SIDE_LEFT || d === SURFACE_SIDE_RIGHT;
    const line = d === SURFACE_SIDE_LEFT || d === SURFACE_SIDE_TOP ? 0 : ts;
    for (let k = 0; k < n; k++) {
      const c = Math.trunc(k / Q), f = k % Q;
      const ax = vertical ? gx0 + line : gx0 + c, ay = vertical ? gy0 + c : gy0 + line;
      const bx = vertical ? ax : ax + 1, by = vertical ? ay + 1 : ay;
      const a = cornerV(t, ax, ay);
      const b = f === 0 ? a : cornerV(t, bx, by);
      const ii = vertical ? line * Q : k, jj = vertical ? k : line * Q;
      v[jj * n + ii] = (a * (Q - f) + b * f) / Q;
    }
  }
  return { n, v };
}

/**
  The tile's stamp for the camera's cell: its level and the sides it straightens
  (SurfaceTileStampFor's lod and SurfaceTileStraightSides). A tile's mesh, wire, wash and wall
  rings change with the camera only when this changes.
*/
export function surfaceTileStamp(t: { terrainMode?: number }, tx: number, ty: number, camgx: number, camgy: number): number {
  const { lod, nbr } = surfaceTileLodsFor(t, tx, ty, camgx, camgy);
  return lod * 16 + surfaceTileStraightSides(lod, nbr);
}

/**
  A cache of the tiles' height grids for one camera tile: the grid of tile (tx, ty) at the level
  the terrain pass draws it, built once. Callers drop it when the heights change.
*/
export class SurfaceTileGrids {
  private grids = new Map<number, { n: number; per: number; v: Float64Array }>();
  readonly t: Terrain16;
  readonly camgx: number;
  readonly camgy: number;
  constructor(t: Terrain16, camgx: number, camgy: number) {
    this.t = t;
    this.camgx = camgx;
    this.camgy = camgy;
  }

  /** Tile (tx, ty)'s grid; per = (n - 1) / 4 points a cell side (1 or 4). */
  grid(tx: number, ty: number): { n: number; per: number; v: Float64Array } {
    const key = tx + ty * 256;
    let g = this.grids.get(key);
    if (!g) {
      const { lod, nbr } = surfaceTileLodsFor(this.t, tx, ty, this.camgx, this.camgy);
      const hg = surfaceTileHeightGrid(this.t, tx, ty, lod, nbr);
      g = { ...hg, per: (hg.n - 1) / TILE_SIZE };
      this.grids.set(key, g);
    }
    return g;
  }

  /** The drawn height (v) at grid point (a, b) of cell (gi, gj), a and b in 0..per. */
  at(gi: number, gj: number, a: number, b: number): number {
    const tx = gi >> 2, ty = gj >> 2;
    const g = this.grid(tx, ty);
    return g.v[((gj - ty * TILE_SIZE) * g.per + b) * g.n + (gi - tx * TILE_SIZE) * g.per + a]!;
  }

  /** Grid steps a side of cell (gi, gj): 1 at 32 ft, 4 at 8 ft. */
  per(gi: number, gj: number): number {
    return this.grid(gi >> 2, gj >> 2).per;
  }
}
