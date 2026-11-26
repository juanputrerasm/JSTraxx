/*
  Lakes: extra water bodies above the track's main water (body 0), packed as WORLD\<stem>.WTR
  (TrackPOD/TrackPODLakes.cpp, Traxx/TrackPODLakes.h).

  Only the authored part (height, flags, seeds: TxxLake) is saved in the .TXX. The rest (filled
  tiles, spill, box, errors) is derived by recompute() from the ground and body 0, whenever the
  terrain or a lake changes. Units: H in water units (0.5 ft, the same as waterLevel4). On a
  Classic 8-bit track a corner is 4 * raw; the drive surface compares u = v >> 1 with 32 * H.
  Containment is strict: ground exactly at H does not hold water. Body 0 is there when it is not 0: no track's water
  is below 0 ft (v6.ts trackWaterRange), so "not 0" is Traxx's "> 0".

  Traxx 1.7.1 (423373b, 56cd559): SPILLWAY NOTCHES (water-bodies handover 4.1a). A waterfall whose
  source is a lake cuts one opening in that lake's wall; the notches come from the falls alone
  (falls.ts trackNotches) and are an input here (LakeNotches, null for none).

  Traxx 1.7.3 (e175d20, f719a05, 056a2d3, 22cad2a, a28fe7d, 71a93b8): THE EDGE RULE.
    - Two rules (LakeNotches.rule, LAKE_RULE_*). EDGE, the default: water crosses between
      4-neighbours only through an edge whose lowest point is <= H (2 corners on Classic, the 5 fine
      points on Spline / Full Map); a notch is an EDGE (LakeNotchEdge), closed to the fill and the
      spill, and a lip point exactly at H reads H + 1 in every height lookup of that lake. TILE: the
      1.7.1 rule (a tile is wet when its lowest point is <= H; a notch is a barrier tile), kept for
      the .WTR files built before it (header flags bit 0 = 0).
    - The spill is one priority flood for both rules and both kinds of ground, its heap ordered by
      key, then z, then x (the contract's; it was a LIFO bucket queue). Under EDGE the key of a tile
      is the edgeMin it was reached through and the level rises to it before the stop tests; the
      spill has no "seed tile wet at the result" tail.
    - Recompute keeps where a leaking lake's water gets out (escape) and the ground points exactly
      at H that give CORNER_AT_H (atcount / atstep / atx / atz); both are derived, never saved.
    - BuildWTR writes the rule (header flags bit 0 and minor 1 for EDGE); ParseWTR reads it.

  Track format version 6 (track-format-v6.md 8.2, 9.1): the tile map is N x N, a seed and a box
  run 0..N-1, and every walk and flood wraps at N. N is the side of the ground's grid (groundCells)
  or of the tile map; at N = 256 everything below is exactly Traxx's code.
*/
import { writeWtr, parseWtr, isWtr, wtrHeightRange } from "../../vendor/openphotex/mtm/wtr.js";
import type { StoredLakeMap, TxxLake } from "./txx.ts";
import { buildLakeGround, type LakeGround } from "./surface.ts";
import type { Terrain16 } from "./terrain16.ts";
import {
  groundCells, groundSurfaceRange, heightLevel, lakeMaxHeightFor, lakeMinHeightFor, pointLevel, pointStep, makeLakeNotches, lakeRuleOf,
  LAKE_LIP_E, LAKE_LIP_N, LAKE_LIP_NE, LAKE_LIP_NW, LAKE_LIP_S, LAKE_LIP_SE, LAKE_LIP_SW, LAKE_LIP_W, LAKE_MAX_AT, LAKE_RULE_EDGE, LAKE_RULE_TILE,
  type LakeNotches, type LakeNotchEdge,
} from "./lake-ground.ts";
import { trackNotches, type TraxxFall } from "./falls.ts";
import { cellShiftOf, cellsOf, sideOf } from "./world.ts";

export { LAKE_MAX_HEIGHT, LAKE_V6_MAX_HEIGHT, LAKE_V6_MIN_HEIGHT, groundCells, lakeMaxHeightFor, lakeMinHeightFor } from "./lake-ground.ts";
export {
  LAKE_RULE_TILE, LAKE_RULE_EDGE, LAKE_DIR_N, LAKE_DIR_E, LAKE_DIR_S, LAKE_DIR_W, LAKE_MAX_AT, setLakeDefaultRule, lakeDefaultRule, lakeRuleOf,
  trackLakeRule, type LakeNotches, type LakeNotchEdge,
} from "./lake-ground.ts";

function dims(n: number): { N: number; M: number; SH: number; T: number } {
  return { N: n, M: n - 1, SH: cellShiftOf(n), T: n * n };
}
/** N of a tile map (or any N x N byte grid). */
const mapCells = (tmap: { length: number }) => (tmap.length === TILES_CLASSIC ? 256 : sideOf(tmap.length));
export const LAKE_MAX_LAKES = 255;
export const LAKE_MAX_SEEDS = 8;
export const LAKE_NO_BASIN = -1;
export const LAKEFLAG_REFLECTIVE = 0x0001;

export const LAKEERR_SEED_ABOVE_WATER = 0x0001;
export const LAKEERR_LEAK = 0x0002;
export const LAKEERR_TOUCHES_BODY0 = 0x0004;
export const LAKEERR_BELOW_BODY0 = 0x0008;
export const LAKEERR_OVERLAP = 0x0010;
export const LAKEERR_MERGE = 0x0020;
export const LAKEERR_CORNER_AT_H = 0x0040;
export const LAKEERR_TOO_MANY = 0x0080;
/*
  Track format version 6 (spec 9.1): the world's size picks the .WTR version, so a 256-cell
  track's lakes (version 1) hold 1..4096 half-feet (0.5 to 2,048 ft) whatever its terrain. JSTraxx
  only: Traxx's ground cannot go past 511.5 ft, so it is judged only on a version 6 (wide) ground.
*/
export const LAKEERR_HEIGHT = 0x0100;
/** The last error bit, for the loops that list them. */
export const LAKEERR_LAST = LAKEERR_HEIGHT;

/** The heights a version 1 .WTR holds, half-feet (OpenPhotex wtrHeightRange(1)). */
const [WTR_V1_LO, WTR_V1_HI] = wtrHeightRange(1);

/** The tiles of the retail 256 x 256 world. */
const TILES_CLASSIC = 65536;
/** N, E, S, W: the order the downhill walk breaks ties (and LAKE_DIR_*). */
const DX = [0, 1, 0, -1];
const DZ = [-1, 0, 1, 0];

/** One lake's derived fields (Lake's part Recompute fills). */
export interface LakeState {
  spill: number;
  /** The tile (x + z * N) where a LEAKing lake's water gets out; -1 = none. */
  escape: number;
  /**
    Where CORNER_AT_H is: the ground points the test flags, in LATTICE coordinates (atstep steps
    make one tile: 1 on Classic, 4 on Spline / Full Map, 1 = the tile's NW corner on a ground
    without points). atcount = the distinct points (it can pass LAKE_MAX_AT); atx / atz the first
    LAKE_MAX_AT in tile order (z, then x), then row by row within the tile.
  */
  atcount: number;
  atstep: number;
  atx: number[];
  atz: number[];
  tilecount: number;
  minx: number; minz: number; maxx: number; maxz: number;
  errors: number;
}

/**
  The derived state of a track's lakes: one entry per lake, and the tile map (0 dry, else index + 1).
  `notches` is the notch input it was derived with (HoldsUpTo and the Lake window read it); `rule`
  the rule it was filled under.
*/
export interface LakesState {
  lakes: LakeState[];
  tmap: Uint8Array;
  notches?: LakeNotches | null;
  rule: number;
}

/**
  SetNotches (+ SetNotchEdges and the rule): null for no notches under the default rule. Under EDGE
  a notch tile is turned into the edges its lip bits N / E / S / W name (the transition form).
*/
export function lakeNotches(notchlake: Uint8Array | null, lipedges: Uint8Array | null, edges: readonly LakeNotchEdge[] | null = null,
  rule?: number): LakeNotches | null {
  return makeLakeNotches(notchlake, lipedges, edges, rule);
}

/** HasNotches: does lake index `l` own any notch (a tile under TILE, an edge under EDGE). */
export function lakeHasNotches(n: LakeNotches | null | undefined, l: number): boolean {
  if (!n || l < 0 || l >= LAKE_MAX_LAKES) return false;
  if (n.rule === LAKE_RULE_EDGE) return n.hasedge[l + 1] === 1;
  return n.notchlake !== null && n.hasnotch[l + 1] === 1;
}

/** NOTCH_FAR_HOLDS (wtr_check, the ruling of 11-11): the far points of a notch tile hold at H + 1. Test hook only. */
let notchFarHolds = true;
export function setNotchFarHolds(on: boolean): void {
  notchFarHolds = on;
}

/* UseEdge: the EDGE rule, on a ground that can give points (else the TILE code runs). */
function useEdge(n: LakeNotches | null | undefined, g: LakeGround): boolean {
  return lakeRuleOf(n) === LAKE_RULE_EDGE && pointStep(g) > 0;
}

/*
  ONE LAKE'S VIEW OF THE GROUND WITH ITS NOTCHES (LakeView, BuildView; wtr_check notch_view).
  TILE: flag[tile] 1 = a notch tile of the lake (a barrier), 2 = a tile sharing ground points with
  one, whose lowest point is recomputed under the notch rule (low[tile]). EDGE: flag 2 = a tile
  with a lip point in its closed square (low[] through the lip rule), closed[tile] bit d = its side
  d is a notch edge, lip = the lattice points of the notch edges. Rebuilt for each H.
*/
interface LakeView {
  flag: Uint8Array;
  low: Int32Array;
  touched: Int32Array;
  ntouched: number;
  active: boolean;
  S: number;
  lv: number;
  g: LakeGround | null;
  lip: Uint8Array | null;
  edge: boolean;
  closed: Uint8Array;
  lipkey: Set<number>;
  /** N, N - 1 and log2 N of the ground (version 6, spec 8.1). */
  N: number;
  M: number;
  SH: number;
}

function viewInit(n = 256): LakeView {
  const { M, SH, T } = dims(n);
  return {
    flag: new Uint8Array(T), low: new Int32Array(T), touched: new Int32Array(T), ntouched: 0, active: false, S: 0, lv: 0, g: null, lip: null,
    edge: false, closed: new Uint8Array(T), lipkey: new Set(), N: n, M, SH,
  };
}

/* ViewPoint (TILE): lattice point (px, pz) inside a notch tile's closed square, and on one of its lip edges. */
function viewPoint(v: LakeView, px: number, pz: number): { innotch: boolean; onlip: boolean } {
  const S = v.S, W = v.N * S, M = v.M, SH = v.SH;
  px &= W - 1;
  pz &= W - 1;
  const ax = [Math.trunc(px / S)], az = [Math.trunc(pz / S)];
  if (px % S === 0) ax.push((Math.trunc(px / S) - 1) & M);
  if (pz % S === 0) az.push((Math.trunc(pz / S) - 1) & M);
  let innotch = false, onlip = false;
  for (const a of ax) {
    for (const b of az) {
      const t = (a & M) + ((b & M) << SH);
      if (v.flag[t] !== 1) continue;
      innotch = true;
      const lx = (px - S * a) & (W - 1), lz = (pz - S * b) & (W - 1);
      const m = v.lip ? v.lip[t]! : 0;
      if (((m & LAKE_LIP_N) && lz === 0) || ((m & LAKE_LIP_E) && lx === S) || ((m & LAKE_LIP_S) && lz === S) || ((m & LAKE_LIP_W) && lx === 0) ||
        ((m & LAKE_LIP_NW) && lx === 0 && lz === 0) || ((m & LAKE_LIP_NE) && lx === S && lz === 0) ||
        ((m & LAKE_LIP_SE) && lx === S && lz === S) || ((m & LAKE_LIP_SW) && lx === 0 && lz === S)) onlip = true;
    }
  }
  return { innotch, onlip };
}

/* ViewTileLow (TILE): the lowest point of tile (x, z) under the notch rule. */
function viewTileLow(v: LakeView, x: number, z: number): number {
  const S = v.S;
  let m = 0x7fffffff;
  for (let dz = 0; dz <= S; dz++) {
    for (let dx = 0; dx <= S; dx++) {
      const px = S * x + dx, pz = S * z + dz;
      let u = pointLevel(v.g!, px, pz);
      const { innotch, onlip } = viewPoint(v, px, pz);
      if (onlip) { if (u === v.lv) u = v.lv + 1; }
      else if (innotch && notchFarHolds && u < v.lv + 1) u = v.lv + 1;
      if (u < m) m = u;
    }
  }
  return m;
}

/*
  THE EDGE RULE'S GROUND (handover 4.1, 4.1a). A tile's edge d (N, E, S, W) has S + 1 lattice
  points, shared with the neighbour across it; edgeMin is the lowest of them, through the lip rule
  (a lip point exactly at H reads H + 1). The edge is OPEN at H when edgeMin <= H and it is not a
  notch edge of the lake.
*/
function lipKey(v: LakeView, px: number, pz: number): number {
  const W = v.N * v.S;
  return (px & (W - 1)) + (pz & (W - 1)) * W;
}

function viewIsLip(v: LakeView | null, px: number, pz: number): boolean {
  if (!v || !v.active || !v.edge || v.lipkey.size === 0) return false;
  return v.lipkey.has(lipKey(v, px, pz));
}

function edgePointAt(g: LakeGround, v: LakeView | null, px: number, pz: number): number {
  let u = pointLevel(g, px, pz);
  if (v && v.active && v.edge && u === v.lv && viewIsLip(v, px, pz)) u = v.lv + 1;
  return u;
}

/* EdgeGeom: edge d of tile (x, z), its first lattice point and the step along it. */
function edgeGeom(S: number, M: number, x: number, z: number, d: number): { bx: number; bz: number; sx: number; sz: number } {
  let bx = S * (x & M), bz = S * (z & M), sx = 0, sz = 0;
  switch (d) {
    case 0: sx = 1; break; // N: z = tz
    case 1: bx += S; sz = 1; break; // E: x = tx + 1
    case 2: bz += S; sx = 1; break; // S: z = tz + 1
    default: sz = 1; break; // W: x = tx
  }
  return { bx, bz, sx, sz };
}

/* EdgeMinG: edgeMin of edge d of tile (x, z), in the ground's level, through the view's lip rule (v may be null). */
function edgeMinG(g: LakeGround, v: LakeView | null, x: number, z: number, d: number): number {
  const S = pointStep(g), n = groundCells(g), W = n * S;
  const { bx, bz, sx, sz } = edgeGeom(S, n - 1, x, z, d);
  let m = 0x7fffffff;
  for (let i = 0; i <= S; i++) {
    const u = edgePointAt(g, v, (bx + sx * i) & (W - 1), (bz + sz * i) & (W - 1));
    if (u < m) m = u;
  }
  return m;
}

/* EdgeClosed: is edge d of tile (x, z) a notch edge of the view's lake (closed whatever its points)? */
function edgeClosed(v: LakeView | null, x: number, z: number, d: number): boolean {
  return Boolean(v && v.active && v.edge && ((v.closed[(x & v.M) + ((z & v.M) << v.SH)]! >> d) & 1));
}

function viewTouch(v: LakeView, t: number): void {
  if (v.closed[t] === 0 && v.flag[t] === 0) v.touched[v.ntouched++] = t;
}

/* ViewAddNotchEdge: close edge d of tile (x, z) from both sides and record its points as lip points. */
function viewAddNotchEdge(v: LakeView, x: number, z: number, d: number): void {
  const { M, SH, S } = v;
  const nx = (x + DX[d]!) & M, nz = (z + DZ[d]!) & M;
  const t = (x & M) + ((z & M) << SH), nt = nx + (nz << SH);
  viewTouch(v, t);
  v.closed[t]! |= 1 << d;
  viewTouch(v, nt);
  v.closed[nt]! |= 1 << ((d + 2) & 3);
  const { bx, bz, sx, sz } = edgeGeom(S, M, x, z, d);
  for (let i = 0; i <= S; i++) v.lipkey.add(lipKey(v, bx + sx * i, bz + sz * i));
}

const VIEW_OX = [-1, 0, 1, -1, 1, -1, 0, 1];
const VIEW_OZ = [-1, -1, -1, 0, 0, 1, 1, 1];

/* BuildView: lake l's view at h (inactive for a lake without notches). */
function buildView(v: LakeView, g: LakeGround, notches: LakeNotches | null | undefined, l: number, h: number): void {
  const { M, SH, T } = dims(v.N);
  for (let i = 0; i < v.ntouched; i++) { v.flag[v.touched[i]!] = 0; v.closed[v.touched[i]!] = 0; }
  v.ntouched = 0;
  v.active = false;
  v.edge = false;
  v.lipkey.clear();
  if (!lakeHasNotches(notches, l)) return;
  const n = notches!;
  v.g = g;
  v.lip = n.lips;
  v.S = pointStep(g);
  v.lv = heightLevel(g, h);
  // THE EDGE RULE: the lake's notch edges (explicit, then the lip bits of its notch tiles) and the lip points.
  if (useEdge(n, g)) {
    v.edge = true;
    v.active = true;
    for (const e of n.edges) if (e.lake === l + 1 && e.dir < 4) viewAddNotchEdge(v, e.x, e.z, e.dir);
    if (n.notchlake && n.lips) {
      for (let t = 0; t < T; t++) {
        if (n.notchlake[t] !== l + 1) continue;
        for (let k = 0; k < 4; k++) if (n.lips[t]! & (1 << k)) viewAddNotchEdge(v, t & M, t >> SH, k);
      }
    }
    // Every tile whose closed square holds a lip point: its lowest point under the lip rule.
    const S = v.S, W = v.N * S;
    for (const key of v.lipkey) {
      const px = key % W, pz = Math.trunc(key / W);
      const ax = [Math.trunc(px / S)], az = [Math.trunc(pz / S)];
      if (px % S === 0) ax.push((Math.trunc(px / S) - 1) & M);
      if (pz % S === 0) az.push((Math.trunc(pz / S) - 1) & M);
      for (const a of ax) {
        for (const b of az) {
          const tt = (a & M) + ((b & M) << SH);
          if (v.flag[tt] !== 2) { viewTouch(v, tt); v.flag[tt] = 2; }
        }
      }
    }
    for (let k = 0; k < v.ntouched; k++) {
      const tt = v.touched[k]!;
      if (v.flag[tt] !== 2) continue;
      const tx = tt & M, tz = tt >> SH;
      let m = 0x7fffffff;
      for (let dz = 0; dz <= S; dz++) {
        for (let dx = 0; dx <= S; dx++) {
          const u = edgePointAt(g, v, (S * tx + dx) & (W - 1), (S * tz + dz) & (W - 1));
          if (u < m) m = u;
        }
      }
      v.low[tt] = m;
    }
    return;
  }
  if (n.notchlake) for (let t = 0; t < T; t++) if (n.notchlake[t] === l + 1) { v.flag[t] = 1; v.touched[v.ntouched++] = t; }
  v.active = true;
  if (v.S === 0) return; // no ground points to read: the notch tiles are barriers only
  const nn = v.ntouched;
  for (let i = 0; i < nn; i++) {
    const x = v.touched[i]! & M, z = v.touched[i]! >> SH;
    for (let d = 0; d < 8; d++) {
      const u = ((x + VIEW_OX[d]!) & M) + (((z + VIEW_OZ[d]!) & M) << SH);
      if (v.flag[u] === 0) { v.flag[u] = 2; v.touched[v.ntouched++] = u; }
    }
  }
  for (let i = nn; i < v.ntouched; i++) { const t = v.touched[i]!; v.low[t] = viewTileLow(v, t & M, t >> SH); }
}

/* LowV: the lowest point of a tile for the fill and the flood, the view's or the plain ground's. */
function lowV(g: LakeGround, v: LakeView | null, x: number, z: number): number {
  if (v && v.active) {
    const t = (x & v.M) + ((z & v.M) << v.SH);
    if (v.flag[t] === 2) return v.low[t]!;
  }
  return tileLow(g, x, z);
}

function notchTile(v: LakeView | null, x: number, z: number): boolean {
  return Boolean(v && v.active && v.flag[(x & v.M) + ((z & v.M) << v.SH)] === 1);
}

/* The at-H and lip flags of the (S + 1)^2 points of tile (x, z), as GroundAtV and AtCollect read them. */
function pointFlags(g: LakeGround, v: LakeView | null, S: number, M: number, x: number, z: number, lv: number): { A: boolean[][]; L: boolean[][] } {
  const A: boolean[][] = [], L: boolean[][] = [];
  for (let dz = 0; dz <= S; dz++) {
    A.push([]); L.push([]);
    for (let dx = 0; dx <= S; dx++) {
      const px = S * (x & M) + dx, pz = S * (z & M) + dz;
      let onlip = false;
      if (v && v.active) onlip = v.edge ? viewIsLip(v, px, pz) : viewPoint(v, px, pz).onlip;
      A[dz]!.push(pointLevel(g, px, pz) === lv);
      L[dz]!.push(onlip);
    }
  }
  return { A, L };
}

/*
  GroundAtV: is the ground of tile (x, z) at level h for CORNER_AT_H in the lake's view? A corner
  (Classic) or a flat triangle (fine) at exactly H touching a lip is exempt; a notch tile is never
  asked.
*/
function groundAtV(g: LakeGround, v: LakeView | null, x: number, z: number, h: number): boolean {
  if (!v || !v.active) return groundAtH(g, x, z, h);
  if (notchTile(v, x, z)) return false;
  if (!groundAtH(g, x, z, h)) return false;
  if (v.S === 0) return true;
  const S = v.S;
  const { A, L } = pointFlags(g, v, S, v.M, x, z, v.lv);
  if (S === 1) {
    for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) if (A[dz]![dx] && !L[dz]![dx]) return true;
    return false;
  }
  // Fine: the flat triangles of the 4 x 4 cells (FineFlatGroundAt's triangulation), none touching a lip.
  for (let dz = 0; dz < S; dz++) {
    for (let dx = 0; dx < S; dx++) {
      const a = A[dz]![dx]!, b = A[dz]![dx + 1]!, c = A[dz + 1]![dx + 1]!, d = A[dz + 1]![dx]!;
      const la = L[dz]![dx]!, lb = L[dz]![dx + 1]!, lc = L[dz + 1]![dx + 1]!, ld = L[dz + 1]![dx]!;
      if (((dx ^ dz) & 1) === 0) {
        if (a && b && c && !(la || lb || lc)) return true;
        if (a && c && d && !(la || lc || ld)) return true;
      } else {
        if (a && b && d && !(la || lb || ld)) return true;
        if (b && c && d && !(lb || lc || ld)) return true;
      }
    }
  }
  return false;
}

/*
  WHERE CORNER_AT_H IS (AtRec, AtAdd, AtCollect): the same decisions as GroundAt / GroundAtV,
  naming the points at exactly H instead of saying yes or no (lip points left out under the lake's
  view). Lattice points, wrapped at W = N * step, each counted once (bm, W * W, per lake).
*/
interface AtRec { lk: LakeState; bm: Uint8Array; W: number }

function atAdd(r: AtRec, px: number, pz: number): void {
  px &= r.W - 1;
  pz &= r.W - 1;
  if (r.bm[px + pz * r.W]) return;
  r.bm[px + pz * r.W] = 1;
  if (r.lk.atcount < LAKE_MAX_AT) { r.lk.atx.push(px); r.lk.atz.push(pz); }
  r.lk.atcount++;
}

function atCollect(g: LakeGround, v: LakeView | null, x: number, z: number, h: number, r: AtRec): void {
  const view = Boolean(v && v.active);
  const S = view ? v!.S : pointStep(g);
  const M = groundCells(g) - 1;
  if (view && notchTile(v, x, z)) return;
  if (!groundAtH(g, x, z, h)) return;
  if (S < 1 || S > 4) { atAdd(r, x & M, z & M); return; } // no ground points: the tile's NW corner stands for it (step 1)
  const { A, L } = pointFlags(g, view ? v : null, S, M, x, z, levelOf(g, h));
  if (S === 1) {
    for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) if (A[dz]![dx] && !L[dz]![dx]) atAdd(r, (x & M) + dx, (z & M) + dz);
    return;
  }
  for (let dz = 0; dz < S; dz++) {
    for (let dx = 0; dx < S; dx++) {
      const a = A[dz]![dx]!, b = A[dz]![dx + 1]!, c = A[dz + 1]![dx + 1]!, d = A[dz + 1]![dx]!;
      const la = L[dz]![dx]!, lb = L[dz]![dx + 1]!, lc = L[dz + 1]![dx + 1]!, ld = L[dz + 1]![dx]!;
      const bx = S * (x & M) + dx, bz = S * (z & M) + dz;
      if (((dx ^ dz) & 1) === 0) {
        if (a && b && c && !(la || lb || lc)) { atAdd(r, bx, bz); atAdd(r, bx + 1, bz); atAdd(r, bx + 1, bz + 1); }
        if (a && c && d && !(la || lc || ld)) { atAdd(r, bx, bz); atAdd(r, bx + 1, bz + 1); atAdd(r, bx, bz + 1); }
      } else {
        if (a && b && d && !(la || lb || ld)) { atAdd(r, bx, bz); atAdd(r, bx + 1, bz); atAdd(r, bx, bz + 1); }
        if (b && c && d && !(lb || lc || ld)) { atAdd(r, bx + 1, bz); atAdd(r, bx + 1, bz + 1); atAdd(r, bx, bz + 1); }
      }
    }
  }
}

function corner(raw: Uint8Array, x: number, z: number): number {
  if (raw.length === TILES_CLASSIC) return 4 * raw[(x & 255) + ((z & 255) << 8)]!;
  const n = mapCells(raw);
  return 4 * raw[(x & (n - 1)) + (z & (n - 1)) * n]!;
}

function minCorner(raw: Uint8Array, x: number, z: number): number {
  return Math.min(corner(raw, x, z), corner(raw, x + 1, z), corner(raw, x + 1, z + 1), corner(raw, x, z + 1));
}

function cornerAt(raw: Uint8Array, x: number, z: number, h: number): boolean {
  return corner(raw, x, z) === h || corner(raw, x + 1, z) === h || corner(raw, x + 1, z + 1) === h || corner(raw, x, z + 1) === h;
}

function tileLow(g: LakeGround, x: number, z: number): number {
  if (g.raw) return minCorner(g.raw, x, z);
  const { M, SH } = dims(groundCells(g));
  return g.tilemin![(x & M) + ((z & M) << SH)]!;
}

const levelOf = heightLevel;

function groundAtH(g: LakeGround, x: number, z: number, h: number): boolean {
  if (g.raw) return cornerAt(g.raw, x, z, h);
  const { M, SH } = dims(groundCells(g));
  return g.groundAtLevel!((x & M) + ((z & M) << SH), levelOf(g, h));
}

function hasGround(g: LakeGround | null): g is LakeGround {
  return Boolean(g && (g.raw || (g.tilemin && g.groundAtLevel)));
}

/** HeldBelow: the highest H a rim whose lowest point is `low` (u) holds. */
const heldBelow = (low: number) => (low - 1) >> 5;
/** WetFrom: the lowest H that wets a tile whose lowest point is `low` (u). */
const wetFrom = (low: number) => (low + 31) >> 5;
/** WetFromG, HeldG: the same on either ground (8-bit: low is H). */
const wetFromG = (g: LakeGround, low: number) => (g.raw ? low : wetFrom(low));
const heldG = (g: LakeGround, low: number) => (g.raw ? low - 1 : heldBelow(low));

/** ErrorText: one plain line per error bit. */
export function lakeErrorText(bit: number): string {
  switch (bit) {
    case LAKEERR_SEED_ABOVE_WATER: return "A seed tile is above the water - lower the seed or raise the height";
    case LAKEERR_LEAK: return "The water spills over the rim - lower the height or raise the rim";
    case LAKEERR_TOUCHES_BODY0: return "The lake reaches the track's main water - it would drain into it";
    case LAKEERR_BELOW_BODY0: return "The lake is no higher than the track's main water - raise its height";
    case LAKEERR_OVERLAP: return "The lake overlaps another lake at a different height - separate them";
    case LAKEERR_MERGE: return "The lake shares or touches another lake at the same height - make them one lake with two seeds";
    case LAKEERR_CORNER_AT_H: return "The ground is exactly at the water's height - move it by a quarter step";
    case LAKEERR_TOO_MANY: return "Too many lakes, or a lake with no seed or more than 8 seeds";
    case LAKEERR_HEIGHT: return "The lake is outside 0.5 to 2,048 ft: a 256-cell track's lakes (.WTR version 1) hold no other height - change its height, or use a 512-cell world";
  }
  return "";
}

/** The static FitHeight: cap at maxh, then off a multiple of 4. */
export function fitHeight8(h: number, maxh: number): number {
  if (h > maxh) h = maxh;
  if (h > 0 && h % 4 === 0) h--;
  return h;
}

/** The static NearestLegalHeight: nearest value in [lo, hi] off a multiple of 4, ties low; -1 if none. */
export function nearestLegalHeight8(h: number, lo: number, hi: number): number {
  if (lo > hi) return -1;
  if (h < lo) h = lo;
  if (h > hi) h = hi;
  for (let d = 0; h - d >= lo || h + d <= hi; d++) {
    if (h - d >= lo && (h - d) % 4 !== 0) return h - d;
    if (h + d <= hi && (h + d) % 4 !== 0) return h + d;
  }
  return -1;
}

/** AnyErrors. */
export function anyLakeErrors(s: LakesState): number {
  return s.lakes.reduce((e, l) => e | l.errors, 0);
}

/** LakeAt: lake index under a tile, or -1. */
export function lakeAt(s: LakesState | null, lakes: readonly TxxLake[], x: number, z: number): number {
  if (!s) return -1;
  const { M, SH } = dims(mapCells(s.tmap));
  const v = s.tmap[(x & M) + ((z & M) << SH)]!;
  return v === 0 || v > lakes.length ? -1 : v - 1;
}

/** SeedIndex. */
export function seedIndex(lakes: readonly TxxLake[], l: number, x: number, z: number, cells = 256): number {
  const M = cells - 1;
  if (l < 0 || l >= lakes.length) return -1;
  const seeds = lakes[l]!.seeds;
  for (let i = 0; i < seeds.length && i < LAKE_MAX_SEEDS; i++) if (seeds[i]![0] === (x & M) && seeds[i]![1] === (z & M)) return i;
  return -1;
}

/** DistinctHeights: reflection passes the engine needs (body 0 counts one). */
export function distinctHeights(lakes: readonly TxxLake[], body0: number): number {
  return (body0 !== 0 ? 1 : 0) + new Set(lakes.map((l) => l.height)).size;
}

/**
  Spill: the highest H the basin around (x, z) holds. `tmap` is the current tile map (other lakes
  stop the flood); `self` is this lake's index or -1. LAKE_MAX_HEIGHT for no spill; LAKE_NO_BASIN
  when the result is at or under body 0 or (TILE rule) (x, z) is dry at it. A lake with notches
  (`notches`, its height from `lakes`) floods in its own view at its height. The rule is the
  notches' (lakeRuleOf: null is the default).
*/
export function lakeSpill(g: LakeGround | null, tmap: Uint8Array | null, body0: number, x: number, z: number, self: number,
  notches: LakeNotches | null = null, lakes: readonly TxxLake[] | null = null): number {
  return lakeSpillAt(g, tmap, body0, x, z, self, notches, lakes).spill;
}

/**
  Spill with its escape tile: the tile the flood stopped at (the pour tile, the sea tile or the
  other lake's tile), x + z * N; -1 when the flood never stopped (no spill) or could not run.
  It is set for LAKE_NO_BASIN too, when the flood did stop.
*/
export function lakeSpillAt(g: LakeGround | null, tmap: Uint8Array | null, body0: number, x: number, z: number, self: number,
  notches: LakeNotches | null = null, lakes: readonly TxxLake[] | null = null): { spill: number; escape: number } {
  if (!hasGround(g)) return { spill: LAKE_NO_BASIN, escape: -1 };
  if (self >= 0 && lakeHasNotches(notches, self) && lakes && lakes[self]) {
    const view = viewInit(groundCells(g));
    buildView(view, g, notches, self, lakes[self]!.height);
    return spillSurface(g, view, notches, tmap, body0, x, z, self);
  }
  return spillSurface(g, null, notches, tmap, body0, x, z, self);
}

/*
  THE HEAP (LakeHeap, HeapPush, HeapPop): the lowest key, then the lowest z, then the lowest x
  (the contract's order, for both rules). Traxx packs key (16 bits, clamped 0..65535), z, x into a
  DWORD; here the key times the tile count plus the tile index x + z * N, which orders the same.
  A version 6 (wide) ground keys from its own lowest u, not clamped.
*/
class LakeHeap {
  private a: Float64Array;
  private T: number;
  private base: number;
  private wide: boolean;
  n = 0;
  constructor(cap: number, T: number, base: number, wide: boolean) {
    this.a = new Float64Array(cap);
    this.T = T;
    this.base = base;
    this.wide = wide;
  }
  push(key: number, tile: number): void {
    let k = key - this.base;
    if (k < 0) k = 0;
    else if (!this.wide && k > 65535) k = 65535;
    const e = k * this.T + tile;
    let i = this.n++;
    if (i >= this.a.length) { const b = new Float64Array(this.a.length * 2); b.set(this.a); this.a = b; }
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.a[par]! <= e) break;
      this.a[i] = this.a[par]!;
      i = par;
    }
    this.a[i] = e;
  }
  pop(): { key: number; tile: number } {
    const top = this.a[0]!, e = this.a[--this.n]!;
    const n = this.n;
    let i = 0;
    if (n > 0) {
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.a[c + 1]! < this.a[c]!) c++;
        if (this.a[c]! >= e) break;
        this.a[i] = this.a[c]!;
        i = c;
      }
      this.a[i] = e;
    }
    const tile = top % this.T;
    return { key: (top - tile) / this.T + this.base, tile };
  }
}

/*
  SpillSurface (THE SPILL, handover 4.3 EDGE, 4.5.3 TILE): walk downhill to the floor of the basin,
  then flood upward in heap order; the level the flood has reached when it first pours out (steps
  down, meets the sea or meets another lake) is one above the basin's capacity. With a view the
  notch tiles (TILE) or notch edges (EDGE) are never crossed and the lip rule applies; the sea is
  judged on the plain ground.
*/
function spillSurface(g: LakeGround, v: LakeView | null, notches: LakeNotches | null | undefined, tmap: Uint8Array | null, body0: number,
  x: number, z: number, self: number): { spill: number; escape: number } {
  const sea = levelOf(g, body0);
  const edge = useEdge(notches, g);
  const { M, SH, T } = dims(groundCells(g));
  // Version 6: a ground below 0 or at 512 ft or more keys its own u range (groundSurfaceRange).
  const range = g.raw ? { base: 0, wide: false } : groundSurfaceRange(g);
  let tx = x & M, tz = z & M;
  // 1. Downhill to the floor; ties go to the first of N, E, S, W. TILE: never onto a notch tile.
  // EDGE: only across an edge that holds the tile's lowest point, and never a notch edge.
  for (;;) {
    const here = lowV(g, v, tx, tz);
    let best = here, bx = tx, bz = tz, any = false;
    for (let d = 0; d < 4; d++) {
      const nx = (tx + DX[d]!) & M, nz = (tz + DZ[d]!) & M;
      if (edge) {
        if (edgeClosed(v, tx, tz, d) || edgeMinG(g, v, tx, tz, d) !== here) continue;
        const m = lowV(g, v, nx, nz);
        if (!any || m < best) { any = true; best = m; bx = nx; bz = nz; }
        continue;
      }
      if (notchTile(v, nx, nz)) continue;
      const m = lowV(g, v, nx, nz);
      if (m < best) { best = m; bx = nx; bz = nz; }
    }
    if (best >= here) break;
    tx = bx; tz = bz;
  }
  // 2. The priority flood upward.
  const mark = new Uint8Array(T);
  const heap = new LakeHeap(4096, T, range.base, range.wide);
  let i = tx + (tz << SH);
  let level = lowV(g, v, tx, tz);
  mark[i] = 1;
  heap.push(level, i);
  let result = 0, found = false;
  while (heap.n > 0) {
    const e = heap.pop();
    i = e.tile;
    const ux = i & M, uz = i >> SH;
    const mc = lowV(g, v, ux, uz);
    if (edge && e.key > level) level = e.key; // FIRST: the water had to rise over the edge it came through
    if (mc < level) { result = heldG(g, level); found = true; break; } // crossed the pour point, going downhill
    if (body0 !== 0 && tileLow(g, ux, uz) <= sea) { result = heldG(g, level); found = true; break; } // reached the sea
    if (tmap && tmap[i] !== 0 && tmap[i] !== self + 1) { result = heldG(g, level); found = true; break; } // met another lake
    if (!edge && mc > level) level = mc;
    for (let d = 0; d < 4; d++) {
      const nx = (ux + DX[d]!) & M, nz = (uz + DZ[d]!) & M, ni = nx + (nz << SH);
      if (mark[ni]) continue;
      if (edge) {
        if (edgeClosed(v, ux, uz, d)) continue;
        mark[ni] = 1;
        heap.push(edgeMinG(g, v, ux, uz, d), ni);
      } else if (!notchTile(v, nx, nz)) {
        mark[ni] = 1;
        heap.push(lowV(g, v, nx, nz), ni);
      }
    }
  }
  const escape = found ? i : -1;
  if (!found) return { spill: lakeMaxHeightFor(g), escape };
  if (body0 !== 0 && result <= body0) return { spill: LAKE_NO_BASIN, escape };
  // TILE rule only: the tile itself must be wet at that height. The EDGE contract (4.3) has no such test.
  if (!edge && tileLow(g, x, z) > levelOf(g, result)) return { spill: LAKE_NO_BASIN, escape };
  return { spill: result, escape };
}

/**
  LevelTouchesGround: lake l filled at h leaves ground of a filled or shore tile at 32 * h. A lake
  with notches is judged in its own view at h (lip points exempt, notch tiles or edges barriers;
  shore tiles not looked at). Under the EDGE rule the fill crosses open edges only and the tiles
  round it are not looked at (handover 4.4).
*/
function levelTouchesGround(g: LakeGround, lake: TxxLake, h: number, view: LakeView | null, notches: LakeNotches | null | undefined, l: number): boolean {
  const lv = levelOf(g, h);
  const edge = useEdge(notches, g);
  const { M, SH, T } = dims(groundCells(g));
  if (view) {
    buildView(view, g, notches, l, h);
    if (!view.active) view = null;
  }
  const mark = new Uint8Array(T);
  const queue = new Int32Array(T);
  let qh = 0, qt = 0;
  for (const [sx, sz] of lake.seeds.slice(0, LAKE_MAX_SEEDS)) {
    const t = sx + (sz << SH);
    if (lowV(g, view, sx, sz) <= lv && !mark[t] && !notchTile(view, t & M, t >> SH)) { mark[t] = 1; queue[qt++] = t; }
  }
  while (qh < qt) {
    const t = queue[qh++]!;
    const tx = t & M, tz = t >> SH;
    if (groundAtV(g, view, tx, tz, h)) return true;
    for (let d = 0; d < 4; d++) {
      const nx = (tx + DX[d]!) & M, nz = (tz + DZ[d]!) & M, ni = nx + (nz << SH);
      if (mark[ni] || notchTile(view, nx, nz)) continue;
      if (edge) {
        if (!edgeClosed(view, tx, tz, d) && edgeMinG(g, view, tx, tz, d) <= lv) { mark[ni] = 1; queue[qt++] = ni; }
        continue;
      }
      if (lowV(g, view, nx, nz) <= lv) { mark[ni] = 1; queue[qt++] = ni; }
      else if (!view && groundAtV(g, view, nx, nz, h)) return true; // a shore tile
    }
  }
  return false;
}

/**
  FitHeight for any ground: on raw (without notches) the static rule; otherwise down to the first
  legal level, never under the seeds' wet level. `l` is the lake's index, for its notches.
*/
export function lakeFitHeight(g: LakeGround | null, lake: TxxLake, h: number, maxh: number, notches: LakeNotches | null = null, l = -1): number {
  const notch = lakeHasNotches(notches, l);
  if (!hasGround(g) || (g.raw && !notch)) return fitHeight8(h, maxh);
  if (h > maxh) h = maxh;
  let lowest = lakeMinHeightFor(g);
  for (const [x, z] of lake.seeds.slice(0, LAKE_MAX_SEEDS)) lowest = Math.max(lowest, wetFromG(g, tileLow(g, x, z)));
  const view = notch ? viewInit(groundCells(g)) : null;
  while (h > lowest && levelTouchesGround(g, lake, h, view, notches, l)) h--;
  return h < lowest ? lowest : h;
}

/** NearestLegalHeight for any ground. */
export function lakeNearestLegalHeight(g: LakeGround | null, lake: TxxLake, h: number, lo: number, hi: number, notches: LakeNotches | null = null, l = -1): number {
  const notch = lakeHasNotches(notches, l);
  if (!hasGround(g) || (g.raw && !notch)) return nearestLegalHeight8(h, lo, hi);
  if (lo > hi) return -1;
  if (h < lo) h = lo;
  if (h > hi) h = hi;
  const view = notch ? viewInit(groundCells(g)) : null;
  for (let d = 0; h - d >= lo || h + d <= hi; d++) {
    if (h - d >= lo && !levelTouchesGround(g, lake, h - d, view, notches, l)) return h - d;
    if (h + d <= hi && !levelTouchesGround(g, lake, h + d, view, notches, l)) return h + d;
  }
  return -1;
}

/** MinHeight: the lowest legal H for the Lake dialog. */
export function lakeMinHeight(g: LakeGround | null, body0: number, lake: TxxLake, notches: LakeNotches | null = null, l = -1): number {
  let lo = body0 !== 0 ? body0 + 1 : 0;
  if (!hasGround(g)) return lo;
  // Version 6: on a ground below 0 ft the lowest lake is the ground's, not 0 (spec 9.1).
  if (body0 === 0) lo = lakeMinHeightFor(g);
  const seeds = lake.seeds.slice(0, LAKE_MAX_SEEDS);
  const notch = lakeHasNotches(notches, l);
  if (!g.raw || notch) {
    for (const [x, z] of seeds) lo = Math.max(lo, wetFromG(g, tileLow(g, x, z)));
    const view = notch ? viewInit(groundCells(g)) : null;
    while (lo <= lakeMaxHeightFor(g) && levelTouchesGround(g, lake, lo, view, notches, l)) lo++;
    return lo;
  }
  for (const [x, z] of seeds) lo = Math.max(lo, minCorner(g.raw, x, z));
  if ((lo & 3) === 0) lo++;
  return lo;
}

/* SpillNotchAt: the lowest spill over lake l's seeds, each flooded in the view built at h. */
function spillNotchAt(g: LakeGround, view: LakeView, tmap: Uint8Array | null, notches: LakeNotches, body0: number, lake: TxxLake, l: number, h: number): number {
  const seeds = lake.seeds.slice(0, LAKE_MAX_SEEDS);
  if (seeds.length < 1) return LAKE_NO_BASIN;
  buildView(view, g, notches, l, h);
  let best = lakeMaxHeightFor(g) + 1;
  for (const [sx, sz] of seeds) {
    const sp = spillSurface(g, view, notches, tmap, body0, sx, sz, l).spill;
    if (sp === LAKE_NO_BASIN) return LAKE_NO_BASIN;
    if (sp < best) best = sp;
  }
  return best;
}

/**
  HoldsUpTo: what the Lake window calls "holds up to" and clamps a typed height to (ruling 11-11).
  A lake without notches: its spill as Recompute derived it. A lake with notches: the highest
  legal H, the largest H' >= its height at which the same seeds and notches give no LEAK, each
  candidate judged in the view built at it (double the step to the first leak, then bisect). If
  its own height already leaks, the spill at that height; LAKE_NO_BASIN when a seed has no basin.
*/
export function lakeHoldsUpTo(g: LakeGround | null, lakes: readonly TxxLake[], st: LakesState, body0: number, l: number): number {
  if (l < 0 || l >= lakes.length || l >= LAKE_MAX_LAKES) return LAKE_NO_BASIN;
  const notches = st.notches ?? null;
  if (!lakeHasNotches(notches, l) || !hasGround(g)) return st.lakes[l]?.spill ?? LAKE_NO_BASIN;
  const view = viewInit(groundCells(g));
  const lake = lakes[l]!;
  const MAXH = lakeMaxHeightFor(g);
  const H = lake.height;
  const s0 = spillNotchAt(g, view, st.tmap, notches!, body0, lake, l, H);
  if (s0 === LAKE_NO_BASIN || H > s0 || s0 >= MAXH) return s0;
  let lo = H, hi = MAXH, step = 1;
  while (lo < hi) {
    let t = lo + step;
    if (t > hi) t = hi;
    const sp = spillNotchAt(g, view, st.tmap, notches!, body0, lake, l, t);
    if (sp !== LAKE_NO_BASIN && sp >= t) { lo = t; step *= 2; }
    else { hi = t - 1; break; }
  }
  while (lo < hi) {
    const mid = Math.trunc((lo + hi + 1) / 2), sp = spillNotchAt(g, view, st.tmap, notches!, body0, lake, l, mid);
    if (sp !== LAKE_NO_BASIN && sp >= mid) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function freshState(errors: number): LakeState {
  return { errors, spill: LAKE_NO_BASIN, escape: -1, atcount: 0, atstep: 1, atx: [], atz: [], tilecount: 0, minx: 0, minz: 0, maxx: 0, maxz: 0 };
}

/**
  Recompute: every derived field from scratch. The whole tile map is filled (steps 1, 2) before
  the spills are measured (3), since a spill stops at another lake. A null ground clears. The
  rule is the notch input's (null: the default, EDGE).
*/
export function recomputeLakes(g: LakeGround | null, lakesIn: readonly TxxLake[], body0: number, notches: LakeNotches | null = null, cells?: number): LakesState {
  const { N, M, SH, T } = dims(g && hasGround(g) ? groundCells(g) : cells ?? 256);
  const rule = lakeRuleOf(notches);
  const tmap = new Uint8Array(T);
  const toomany = lakesIn.length > LAKE_MAX_LAKES;
  const lakes = lakesIn.slice(0, LAKE_MAX_LAKES);
  const nl = lakes.length;
  const st: LakeState[] = lakes.map(() => freshState(toomany ? LAKEERR_TOO_MANY : 0));
  if (nl === 0 || !hasGround(g)) return { lakes: st, tmap, notches, rule };
  // Lakes with notches are filled and checked in their own view of the ground.
  const anyNotch = Boolean(notches && (notches.notchlake || notches.edges.length));
  const view = anyNotch ? viewInit(N) : null;
  const edge = useEdge(notches, g); // the EDGE rule: edges decide the fill, the seed is judged in the lip view
  const mark = new Uint8Array(T);
  const queue = new Int32Array(T);
  const occ = new Uint8Array(nl * 2 * N);

  // 1. Fill each lake; the first lake to reach a tile keeps it.
  for (let j = 0; j < nl; j++) {
    const h = lakes[j]!.height, hl = levelOf(g, h);
    let vw: LakeView | null = null;
    if (view && lakeHasNotches(notches, j)) { buildView(view, g, notches, j, h); vw = view; }
    let qh = 0, qt = 0;
    for (const [sx, sz] of lakes[j]!.seeds.slice(0, LAKE_MAX_SEEDS)) {
      const t = sx + (sz << SH);
      // EDGE: the seed is judged on the lake's own (lip-substituted) lowest point.
      if (edge ? lowV(g, vw, sx, sz) > hl : tileLow(g, sx, sz) > hl) { st[j]!.errors |= LAKEERR_SEED_ABOVE_WATER; continue; }
      // (a seed wet only through a lip point the notch rule lifts is not filled, and no error)
      if (notchTile(vw, sx, sz) || lowV(g, vw, sx, sz) > hl) continue;
      if (mark[t] !== j + 1) { mark[t] = j + 1; queue[qt++] = t; }
    }
    while (qh < qt) {
      const u = queue[qh++]!;
      const ux = u & M, uz = u >> SH;
      if (tmap[u] === 0) tmap[u] = j + 1;
      else if (tmap[u] !== j + 1) {
        const o = tmap[u]! - 1;
        const e = lakes[o]!.height !== h ? LAKEERR_OVERLAP : LAKEERR_MERGE;
        st[o]!.errors |= e;
        st[j]!.errors |= e;
      }
      for (let d = 0; d < 4; d++) {
        const nx = (ux + DX[d]!) & M, nz = (uz + DZ[d]!) & M, ni = nx + (nz << SH);
        if (mark[ni] === j + 1) continue;
        if (edge ? !edgeClosed(vw, ux, uz, d) && edgeMinG(g, vw, ux, uz, d) <= hl : lowV(g, vw, nx, nz) <= hl && !notchTile(vw, nx, nz)) {
          mark[ni] = j + 1; queue[qt++] = ni;
        }
      }
    }
  }

  // 2. Same-height lakes touching edge to edge are one lake split in two.
  for (let t = 0; t < T; t++) {
    const a = tmap[t]!;
    if (a === 0) continue;
    const x = t & M, z = t >> SH;
    for (let d = 1; d <= 2; d++) {
      const b = tmap[((x + DX[d]!) & M) + (((z + DZ[d]!) & M) << SH)]!;
      if (b !== 0 && b !== a && lakes[a - 1]!.height === lakes[b - 1]!.height) { st[a - 1]!.errors |= LAKEERR_MERGE; st[b - 1]!.errors |= LAKEERR_MERGE; }
    }
  }

  // 3. Spill per seed, the lowest wins; a seed with no basin spoils the lot. 4. The per-lake checks.
  for (let j = 0; j < nl; j++) {
    const ns = lakes[j]!.seeds.length;
    let best = lakeMaxHeightFor(g) + 1;
    let nobasin = ns < 1;
    let bestesc = -1, nobasinesc = -1; // the escape tile of the lowest-spill seed / of the first seed with no basin
    for (const [sx, sz] of lakes[j]!.seeds.slice(0, LAKE_MAX_SEEDS)) {
      const r = lakeSpillAt(g, tmap, body0, sx, sz, j, notches, lakes);
      if (r.spill === LAKE_NO_BASIN) {
        if (!nobasin || nobasinesc < 0) nobasinesc = r.escape;
        nobasin = true;
      } else if (r.spill < best) { best = r.spill; bestesc = r.escape; }
    }
    st[j]!.spill = nobasin ? LAKE_NO_BASIN : best;
    if (nobasin || lakes[j]!.height > st[j]!.spill) {
      st[j]!.errors |= LAKEERR_LEAK;
      st[j]!.escape = nobasin ? nobasinesc : bestesc;
    }
    if (body0 !== 0 && lakes[j]!.height <= body0) st[j]!.errors |= LAKEERR_BELOW_BODY0;
    if (toomany || ns > LAKE_MAX_SEEDS || ns < 1) st[j]!.errors |= LAKEERR_TOO_MANY;
  }

  // 4/5. The tile checks, the count and the box columns.
  for (let t = 0; t < T; t++) {
    const a = tmap[t]!;
    if (a === 0) continue;
    const x = t & M, z = t >> SH, j = a - 1, h = lakes[j]!.height;
    st[j]!.tilecount++;
    occ[j * 2 * N + x] = 1;
    occ[j * 2 * N + N + z] = 1;
    if (body0 !== 0 && tileLow(g, x, z) <= levelOf(g, body0)) st[j]!.errors |= LAKEERR_TOUCHES_BODY0;
    if (view && lakeHasNotches(notches, j)) continue; // below, in the lake's own view
    if (groundAtH(g, x, z, h)) st[j]!.errors |= LAKEERR_CORNER_AT_H;
    // ...and (TILE rule) the tiles round the shore; under EDGE the bordering tiles are not checked (handover 4.4).
    for (let d = 0; !edge && d < 4; d++) {
      const nx = (x + DX[d]!) & M, nz = (z + DZ[d]!) & M;
      if (tmap[nx + (nz << SH)] === 0 && groundAtH(g, nx, nz, h)) st[j]!.errors |= LAKEERR_CORNER_AT_H;
    }
  }

  // CORNER_AT_H of a lake with notches: its filled tiles in its view, a point or flat triangle at
  // exactly H touching a lip exempt; its shore tiles are not looked at (wtr_check checks the fill only).
  if (view) {
    for (let j = 0; j < nl; j++) {
      if (!lakeHasNotches(notches, j)) continue;
      buildView(view, g, notches, j, lakes[j]!.height);
      for (let t = 0; t < T; t++) if (tmap[t] === j + 1 && groundAtV(g, view, t & M, t >> SH, lakes[j]!.height)) st[j]!.errors |= LAKEERR_CORNER_AT_H;
    }
  }

  // 4b. Where CORNER_AT_H is: the points the two tests above flagged (derived only; no error bit changes).
  {
    const S0 = pointStep(g);
    const W = N * (S0 > 0 ? S0 : 1);
    let bm: Uint8Array | null = null;
    for (let j = 0; j < nl; j++) {
      if (!(st[j]!.errors & LAKEERR_CORNER_AT_H)) continue;
      if (bm) bm.fill(0);
      else bm = new Uint8Array(W * W);
      const h = lakes[j]!.height;
      const notchview = Boolean(view && lakeHasNotches(notches, j));
      const rec: AtRec = { lk: st[j]!, bm, W };
      st[j]!.atstep = S0 > 0 ? S0 : 1;
      if (notchview) buildView(view!, g, notches, j, h);
      for (let t = 0; t < T; t++) {
        if (tmap[t] !== j + 1) continue;
        const x = t & M, z = t >> SH;
        atCollect(g, notchview ? view : null, x, z, h, rec);
        for (let d = 0; !edge && !notchview && d < 4; d++) {
          const nx = (x + DX[d]!) & M, nz = (z + DZ[d]!) & M;
          if (tmap[nx + (nz << SH)] === 0) atCollect(g, null, nx, nz, h, rec);
        }
      }
    }
  }

  // 5. The wrapping box: the complement of the longest run of empty columns (rows).
  wrapBoxes(st, occ, N);
  return { lakes: st, tmap, notches, rule };
}

/** Step 5 of Recompute: each lake's wrapping box from its occupied columns and rows (`occ`, 2N a lake). */
function wrapBoxes(st: LakeState[], occ: Uint8Array, N: number): void {
  const M = N - 1;
  for (let j = 0; j < st.length; j++) {
    for (let axis = 0; axis < 2; axis++) {
      const base = j * 2 * N + axis * N;
      const o = (i: number) => occ[base + (i & M)];
      let bestlen = 0, bestat = 0;
      for (let i = 0; i < N; i++) {
        if (!o(i) && o(i + M)) {
          let len = 0;
          while (len < N && !o(i + len)) len++;
          if (len > bestlen) { bestlen = len; bestat = i; }
        }
      }
      let lo: number, hi: number;
      if (st[j]!.tilecount === 0) lo = hi = 0;
      else if (bestlen === 0) { lo = 0; hi = M; }
      else { lo = (bestat + bestlen) & M; hi = (bestat + M) & M; }
      if (axis === 0) { st[j]!.minx = lo; st[j]!.maxx = hi; } else { st[j]!.minz = lo; st[j]!.maxz = hi; }
    }
  }
}

/*
  THE STORED LAKE MAP (Traxx origin/main CTrackPODLakes stored / storedshown / storedlakes, TrackPODFile.cpp
  ApplyStoredLakes, TraxxDoc.cpp AskStoredLakes, TrackPODLakes.cpp StoredDiffers, StoredWritable, BuildWTRStored):
  a pod's own .WTR tile map, kept when it differs from Traxx's fill (lakes another tool made by its own rules). The
  track holds it as TxxTrack.storedLakeMap (saved in a V24 .TXX); the view and the falls read it while it is shown
  (ShowStored), and Write POD asks whether to write it or Traxx's fill (AskStoredLakes).

  JSTraxx's lakes state is derived, not kept, so Traxx's "a Recompute un-shows the stored map" is the signature of
  the lakes, their rule and the falls taken when the map was shown (`sig`): an edit of any of them shows the fill,
  and an undo back shows the stored map again. A map for another lake count names other lakes and is never shown.
*/
type StoredLakesTrack = { lakes: readonly TxxLake[]; lakeRule?: number; falls?: readonly TraxxFall[]; storedLakeMap?: StoredLakeMap | null };

/** What the shown stored map depends on: the lakes, their rule and the waterfalls. */
export function lakesSignature(t: Pick<StoredLakesTrack, "lakes" | "lakeRule" | "falls">): string {
  return JSON.stringify([t.lakes, t.lakeRule ?? null, t.falls ?? []]);
}

/** ShowStored: the stored map becomes what the view shows, for the lakes as they are now. */
export function showStoredLakes(t: StoredLakesTrack): void {
  const s = t.storedLakeMap;
  if (s) t.storedLakeMap = { ...s, shown: true, sig: lakesSignature(t) };
}

/** UseComputed: the fill is shown; the stored map is kept. */
export function useComputedLakes(t: StoredLakesTrack): void {
  const s = t.storedLakeMap;
  if (s) t.storedLakeMap = { ...s, shown: false };
}

/** HasStored, for the lakes the track has now (a map stored for another lake count is dropped by Recompute). */
export function storedLakeMapOf(t: StoredLakesTrack): StoredLakeMap | null {
  const s = t.storedLakeMap;
  return s && t.lakes.length > 0 && s.lakes === t.lakes.length ? s : null;
}

/** The stored map while it is what the view shows (StoredShown), else null. */
export function storedLakeMapShown(t: StoredLakesTrack): StoredLakeMap | null {
  const s = storedLakeMapOf(t);
  return s && s.shown && (s.sig === undefined || s.sig === lakesSignature(t)) ? s : null;
}

/** Each lake's tile count and wrapping box over `tmap` (BuildWTRStored's MapOccupancy and WrapBox). */
function overMap(st: LakesState, tmap: Uint8Array): LakesState {
  const N = sideOf(tmap.length), SH = cellShiftOf(N), M = N - 1;
  const lakes = st.lakes.map((l) => ({ ...l, tilecount: 0 }));
  const occ = new Uint8Array(lakes.length * 2 * N);
  for (let t2 = 0; t2 < tmap.length; t2++) {
    const j = tmap[t2]! - 1;
    if (j < 0 || j >= lakes.length) continue;
    lakes[j]!.tilecount++;
    occ[j * 2 * N + (t2 & M)] = 1;
    occ[j * 2 * N + N + (t2 >> SH)] = 1;
  }
  wrapBoxes(lakes, occ, N);
  return { ...st, lakes, tmap };
}

/**
  `st` over the track's stored map while it is shown (storedLakeMapShown): the map, each lake's tile count and
  wrapping box from it, and no flood errors (the map is the file's, judged by the engine's own checks at Write POD:
  storedLakesWritable). The spill (what the Lake window's capacity reads) stays Traxx's. Otherwise `st` itself.
*/
export function withStoredLakes(t: StoredLakesTrack, st: LakesState): LakesState {
  const s = storedLakeMapShown(t);
  if (!s || s.tmap.length !== st.tmap.length) return st;
  const over = overMap(st, s.tmap);
  return { ...over, lakes: over.lakes.map((l) => ({ ...l, errors: 0, escape: -1, atcount: 0, atx: [], atz: [] })) };
}

/** `st` with the stored map in its tile map (ShowStored for Write POD's falls), whatever the view shows. */
export function overStoredLakes(t: StoredLakesTrack, st: LakesState): LakesState {
  const s = storedLakeMapOf(t);
  return s && s.tmap.length === st.tmap.length ? overMap(st, s.tmap) : st;
}

/**
  StoredDiffers: the tiles where the stored map and a fresh fill (`fill`, Recompute under the track's rule) disagree;
  0 when there is no stored map, so there is nothing to ask (AskStoredLakes asks only when it is above 0).
*/
export function storedLakesDiffer(t: StoredLakesTrack, fill: LakesState | null): number {
  const s = storedLakeMapOf(t);
  if (!s || !fill || s.tmap.length !== fill.tmap.length) return 0;
  let d = 0;
  for (let i = 0; i < s.tmap.length; i++) if (s.tmap[i] !== fill.tmap[i]) d++;
  return d;
}

/**
  AskStoredLakes' text (TraxxDoc.cpp), the caption "Write POD" (forPod) or "Save", Yes / No / Cancel with Yes the
  default. `fitsTxx` is StoredLakesFitTXX (a V24 .TXX holds the map), read only for the .TXX question.
*/
export function askStoredLakesText(ndiff: number, forPod: boolean, fitsTxx = true): string {
  let text = `This track's lake map came from another tool and differs from Traxx's own filling by ${ndiff} tiles (for example, tiles kept dry where roads run under the water).\n\n`;
  if (!forPod && !fitsTxx) text += "Yes: keep the stored lake map (what the game shows now). A classic .TXX can't hold it, so it is kept only until Traxx closes, or until you Write POD.\n";
  else text += "Yes: keep the stored lake map (what the game shows now).\n";
  text += "No: recompute the lakes from their seeds (floods those tiles).\nCancel: don't save.";
  return text;
}

/** LakeHeightWindow (Include/TrackPODLakes.h): a height in [lo1, hi1] or [lo2, hi2] passes; an unused range has lo > hi. */
export interface LakeHeightWindow { lo1: number; hi1: number; lo2: number; hi2: number }

/**
  CTrackPOD::LakeHeightWindowFor (Include/TrackPOD.h): classic 1..4096; a 256 .SI3 that OR its own window
  2 * base + 1 .. 2 * (base + 65536 / step); a 512 track only the window.
*/
export function lakeHeightWindowFor(v6: boolean, cells: number, step: number, base: number): LakeHeightWindow {
  const w = { lo1: 1, hi1: 4096, lo2: 1, hi2: 0 };
  if (v6) {
    const lo = 2 * base + 1, hi = 2 * (base + Math.trunc(65536 / (step > 0 ? step : 1)));
    if (cells === 512) { w.lo1 = lo; w.hi1 = hi; } else { w.lo2 = lo; w.hi2 = hi; }
  }
  return w;
}

/**
  StoredWritable: the stored map judged by the ENGINE's per-lake checks (WaterBodies.cpp), not by Traxx's flood
  errors: every lake has 1..8 seeds, at least one tile in the map, a height in the window (1..the ground's ceiling
  without one), above body 0, and no tile of it already wet under body 0. -1 when it passes; the index of the first
  lake that fails; LAKE_MAX_LAKES when there is no stored map or no usable ground.
*/
export function storedLakesWritable(t: StoredLakesTrack, g: LakeGround | null, body0: number, hw: LakeHeightWindow | null = null): number {
  const s = storedLakeMapOf(t);
  const nl = t.lakes.length;
  if (!s || nl <= 0 || nl > LAKE_MAX_LAKES || !hasGround(g) || s.tmap.length !== groundCells(g) ** 2) return LAKE_MAX_LAKES;
  const { M, SH } = dims(groundCells(g));
  const count = new Int32Array(256);
  const touch = new Uint8Array(LAKE_MAX_LAKES + 1);
  for (let tt = 0; tt < s.tmap.length; tt++) {
    const id = s.tmap[tt]!;
    if (id === 0) continue;
    count[id]++;
    if (body0 > 0 && tileLow(g, tt & M, tt >> SH) <= levelOf(g, body0)) touch[id] = 1;
  }
  const cap = lakeMaxHeightFor(g);
  for (let j = 0; j < nl; j++) {
    const k = t.lakes[j]!;
    const h = k.height, ns = k.seeds.length;
    const heightok = hw ? (h >= hw.lo1 && h <= hw.hi1) || (h >= hw.lo2 && h <= hw.hi2) : h >= 1 && h <= cap;
    const bad = ns < 1 || ns > LAKE_MAX_SEEDS || count[j + 1] === 0 || !heightok || (body0 > 0 && h <= body0) || touch[j + 1] !== 0;
    if (bad) return j;
  }
  return -1;
}

/** Write POD's refusal of a stored map that fails StoredWritable (OnFileWritePOD), caption "Lakes need fixing". */
export function storedLakesNotWritableText(badlake: number): string {
  return `The stored lake map can't be written: lake ${badlake + 1} does not pass the game's own checks (a height out of range, no tiles, or water at or below the main water).\n\nRecompute the lakes at the prompt, or fix the lake.\n\nNothing was written.`;
}

/** The same refusal with no ground to judge on. */
export const STORED_LAKES_NO_MEMORY = "There was not enough memory to check the stored lake map against the terrain.\n\nNothing was written.";

/**
  BuildWTRStored: the .WTR with exactly the stored TMAP bytes and each lake's tile count and box derived from that
  map, under the fill's rule (`st.rule`), or null when StoredWritable fails. `heightWindow` as buildWtr.
*/
export function buildWtrStored(t: StoredLakesTrack, st: LakesState, g: LakeGround | null, body0: number, hw: LakeHeightWindow | null, heightWindow?: { step: number; base: number }): Uint8Array | null {
  if (storedLakesWritable(t, g, body0, hw) !== -1) return null;
  const over = overStoredLakes(t, st);
  return writeWtrImage(t.lakes, over, heightWindow);
}

/**
  RecomputeLakes (CTraxxView::RecomputeLakes): the derived state of a track's lakes as the track
  is now, under its rule, with the notches its falls cut (UpdateLakeNotches, right before every Recompute).
*/
export function trackLakes(t: Terrain16 & { lakes: readonly TxxLake[]; waterLevel4: number; falls?: readonly TraxxFall[]; lakeRule?: number; storedLakeMap?: StoredLakeMap | null }): LakesState {
  // Over the stored map while it is shown (ShowStored, withStoredLakes).
  return withStoredLakes(t, recomputeLakes(t.lakes.length ? buildLakeGround(t) : null, t.lakes, t.waterLevel4, trackNotches(t), cellsOf(t)));
}

/** The notch edges a lake set was derived with (CTrackPODLakes::NotchEdges), for the wall picture: none under TILE. */
export function lakeNotchEdgesOf(s: LakesState): LakeNotchEdge[] {
  return s.rule === LAKE_RULE_EDGE && s.notches ? s.notches.edges : [];
}

/**
  BuildWTR: the .WTR image, or null when there are no lakes or one is in error. Written with the
  rule the lakes were filled under (header flags bit 0 and minor 1 for EDGE). `heightWindow`, a 256-cell
  .SI3's step and base, lets a version 1 lake take the track's height window as the engine does.
*/
export function buildWtr(lakes: readonly TxxLake[], s: LakesState, heightWindow?: { step: number; base: number }): Uint8Array | null {
  if (!lakes.length || anyLakeErrors(s) !== 0) return null;
  return writeWtrImage(lakes, s, heightWindow);
}

/** BuildWTRImage: the header, BODY and TMAP of `s` (each lake's tile count and box from it). */
function writeWtrImage(lakes: readonly TxxLake[], s: LakesState, heightWindow?: { step: number; base: number }): Uint8Array | null {
  if (!lakes.length) return null;
  // writeWtr refuses what the file cannot hold (a version 1 height outside 1..4096 or the window): no item then.
  try {
    return writeWtr(lakes.map((l, i) => ({
      flags: l.flags, height: l.height, seeds: l.seeds.map(([x, z]) => ({ x, z })),
      box: { minX: s.lakes[i]!.minx, minZ: s.lakes[i]!.minz, maxX: s.lakes[i]!.maxx, maxZ: s.lakes[i]!.maxz },
      tileCount: s.lakes[i]!.tilecount,
    })), s.tmap, { edgeRule: s.rule === LAKE_RULE_EDGE, ...(heightWindow ? { heightWindow } : {}) });
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/**
  ParseWTR: the authored lakes of a .WTR (ids in order 1..N, 1..8 seeds each), its stored tile
  map and the rule it was built with (header flags bit 0: EDGE, else TILE); null when the file
  cannot be used (Traxx then has no lakes).

  Track format version 6 (track-format-v6.md 9.1): with `cells`, the worldCells of a .SI3 track,
  versions 1 and 2 are both read and the file must be N x N (parseWtr refuses any other size); a
  version 2 height is a signed i32 in half-feet. Without `cells` it is Traxx's reader: version 1,
  256 x 256 only.
*/
export function parseWtrLakes(bytes: Uint8Array, cells?: number): { lakes: TxxLake[]; tmap: Uint8Array | null; rule: number } | null {
  if (!isWtr(bytes)) return null;
  let w;
  try { w = cells === undefined ? parseWtr(bytes) : parseWtr(bytes, { cells }); } catch { return null; }
  if ((cells === undefined ? w.major > 1 : w.major > 2) || w.lakes.length > LAKE_MAX_LAKES) return null;
  const M = (cells ?? 256) - 1;
  const lakes: TxxLake[] = [];
  for (let i = 0; i < w.lakes.length; i++) {
    const k = w.lakes[i]!;
    if (k.id !== i + 1 || k.seeds.length < 1 || k.seeds.length > LAKE_MAX_SEEDS) return null;
    lakes.push({ height: k.height | 0, flags: k.flags & 0xffff, seeds: k.seeds.map((p) => [p.x & M, p.z & M] as [number, number]) });
  }
  return { lakes, tmap: w.tileMap, rule: (w.headerFlags & 1) ? LAKE_RULE_EDGE : LAKE_RULE_TILE };
}

/**
  The .WTR of a track format version 6 (.SI3) track: BuildWTR's lakes and the N x N tile map through OpenPhotex
  writeWtr, whose version is the world's (9.1): version 1 for a 256 x 256 map, version 2 for 512 x 512. A 256-cell
  track's version 1 lakes take the engine's window of its step and base too (LakeHeightWindowFor).
*/
export function buildWtrV6(lakes: readonly TxxLake[], s: LakesState, step: number, base: number): Uint8Array | null {
  return buildWtr(lakes, s, s.tmap.length === 65536 ? { step, base } : undefined);
}

/** Write POD's report when the lakes cannot be packed. */
export const LAKES_NOT_SAVED = "The lakes could not be written into the pod (the name does not fit a pod entry, or a lake is in error).\n\nThe pod was saved WITHOUT its lakes. Fix them and save again.";
