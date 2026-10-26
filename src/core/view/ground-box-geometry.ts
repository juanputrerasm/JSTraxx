/*
  Ground boxes as Traxx builds them (CTraxxView::BuildBuildingPolyobj): a box over its cell
  from ALTITUDESCALE * lower to ALTITUDESCALE * upper, eight corners (0..3 the bottom, 4..7 the
  top, each x0y0, x1y0, x1y1, x0y1), two triangles a face.

  A side is hidden when the neighbouring cell's box covers it (its lower <= this lower and its
  upper >= this upper); the bottom is hidden when the box sits on height 0. Each face takes its
  CL0 word's tile and orientation, with the corner numbers Traxx gives each triangle.
*/
import type { TxxGroundBox } from "../traxx/txx.ts";
import { cornerUv, type TileSet } from "./tiles.ts";
import { ALTITUDE_SCALE } from "./camera.ts";

/* sidevertindex (TraxxView.cpp): two triangles per side, faces 0 south, 1 north, 2 east, 3 west. */
const SIDE_TRIS: [number, number, number][] = [[4, 5, 0], [6, 7, 2], [5, 6, 1], [7, 4, 3], [5, 1, 0], [7, 3, 2], [6, 2, 1], [4, 0, 3]];
/* The texture corner numbers each triangle's vertices take. */
const SIDE_UV1: [number, number, number] = [3, 2, 0];
const SIDE_UV2: [number, number, number] = [2, 1, 0];
const TOP: { tri: [number, number, number]; uv: [number, number, number] }[] = [{ tri: [5, 4, 6], uv: [1, 0, 2] }, { tri: [4, 7, 6], uv: [0, 3, 2] }];
const BOTTOM: { tri: [number, number, number]; uv: [number, number, number] }[] = [{ tri: [1, 2, 0], uv: [1, 2, 0] }, { tri: [2, 3, 0], uv: [2, 3, 0] }];

export interface GroundBoxGeometry {
  positions: Float32Array;
  uvs: Float32Array;
  tiles: Float32Array;
  cells: Float32Array;
  /** Which box each triangle belongs to, and which face (0..5), for picking. */
  faceOf: Int32Array;
}

/** The RA0 / RA1 grids for a set of boxes (what neighbour tests read). */
export function boxGrids(boxes: readonly TxxGroundBox[]): { ra0: Uint8Array; ra1: Uint8Array } {
  const ra0 = new Uint8Array(65536), ra1 = new Uint8Array(65536);
  for (const b of boxes) {
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) {
      const c = ((b.x + i) & 255) + (((b.y + j) & 255) << 8);
      ra0[c] = b.lower;
      ra1[c] = b.upper;
    }
  }
  return { ra0, ra1 };
}

export function groundBoxGeometry(boxes: readonly TxxGroundBox[], tiles: TileSet | null): GroundBoxGeometry {
  const { ra0, ra1 } = boxGrids(boxes);
  const p: number[] = [], uv: number[] = [], tl: number[] = [], cell: number[] = [], faceOf: number[] = [];
  boxes.forEach((b, bi) => {
    const x0 = b.x * 64, y0 = b.y * 64, x1 = x0 + b.w * 64, y1 = y0 + b.h * 64;
    const zl = ALTITUDE_SCALE * b.lower, zu = ALTITUDE_SCALE * b.upper;
    const corner = [[x0, y0, zl], [x1, y0, zl], [x1, y1, zl], [x0, y1, zl], [x0, y0, zu], [x1, y0, zu], [x1, y1, zu], [x0, y1, zu]];
    const covered = (nx: number, ny: number) => ra0[nx + (ny << 8)] <= b.lower && ra1[nx + (ny << 8)] >= b.upper;
    const add = (face: number, tri: [number, number, number], corners: [number, number, number]) => {
      const word = b.faces[face] ?? 0;
      const tex = word & 0x0fff;
      const where = tiles && tex < tiles.where.length ? tiles.where[tex] : -1;
      const side = where >= 0 ? tiles!.side[tex] : 64;
      for (let k = 0; k < 3; k++) {
        p.push(...corner[tri[k]]);
        uv.push(...cornerUv(corners[k], word, side));
        tl.push(where < 0 ? -1 : where >> 15, where < 0 ? 0 : where & 0x7fff);
        cell.push(b.x, b.y);
      }
      faceOf.push(bi * 8 + face);
    };
    const sideVisible = [
      !(b.y > 0 && covered(b.x, b.y - 1)),
      !(b.y < 255 && covered(b.x, b.y + 1)),
      !(b.x < 255 && covered(b.x + 1, b.y)),
      !(b.x > 0 && covered(b.x - 1, b.y)),
    ];
    for (let s = 0; s < 4; s++) {
      if (!sideVisible[s]) continue;
      add(s, SIDE_TRIS[s], SIDE_UV1);
      add(s, SIDE_TRIS[s + 4], SIDE_UV2);
    }
    for (const t of TOP) add(4, t.tri, t.uv);
    if (ra0[b.x + (b.y << 8)] !== 0) for (const t of BOTTOM) add(5, t.tri, t.uv);
  });
  return { positions: new Float32Array(p), uvs: new Float32Array(uv), tiles: new Float32Array(tl), cells: new Float32Array(cell), faceOf: new Int32Array(faceOf) };
}
