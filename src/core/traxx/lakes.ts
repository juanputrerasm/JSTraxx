/*
  Lakes: extra water bodies above the track's main water (body 0), packed as WORLD\<stem>.WTR
  (TrackPOD/TrackPODLakes.cpp, Traxx/TrackPODLakes.h).

  Only the authored part (height, flags, seeds: TxxLake) is saved in the .TXX. The rest (filled
  tiles, spill, box, errors) is derived by recompute() from the ground and body 0, whenever the
  terrain or a lake changes. Units: H in water units (0.5 ft, the same as waterLevel4). On a
  Classic 8-bit track a corner is 4 * raw; the drive surface compares u = v >> 1 with 32 * H.
  Containment is strict: a tile is wet when its lowest point is at or under the water.

  Traxx 1.7.1 (423373b, 56cd559): SPILLWAY NOTCHES (water-bodies handover 4.1a). A waterfall whose
  source is a lake cuts one opening in that lake's wall; the notch tiles and their lip edges come
  from the falls alone (falls.ts buildNotches) and are an input here (LakeNotches, null for none:
  every result is then exactly what it was). A lake with notches is filled, flooded and checked in
  its own VIEW of the ground (LakeView): its notch tiles are barriers, a lip point exactly at H
  counts as H + 1, every other point of a notch tile's closed square as at least H + 1, and a
  point or flat triangle at H touching a lip is exempt from CORNER_AT_H.
*/
import { writeWtr, parseWtr, isWtr } from "../../vendor/openphotex/mtm/wtr.js";
import type { TxxLake } from "./txx.ts";
import { buildLakeGround, type LakeGround } from "./surface.ts";
import type { Terrain16 } from "./terrain16.ts";
import {
  heightLevel, pointLevel, pointStep, LAKE_MAX_HEIGHT,
  LAKE_LIP_E, LAKE_LIP_N, LAKE_LIP_NE, LAKE_LIP_NW, LAKE_LIP_S, LAKE_LIP_SE, LAKE_LIP_SW, LAKE_LIP_W,
} from "./lake-ground.ts";
import { trackNotches, type TraxxFall } from "./falls.ts";

export { LAKE_MAX_HEIGHT } from "./lake-ground.ts";
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

const TILES = 65536;
const SURFACE_BUCKETS = 32768;
/** N, E, S, W: the order the downhill walk breaks ties. */
const DX = [0, 1, 0, -1];
const DZ = [-1, 0, 1, 0];

/** One lake's derived fields (Lake's part Recompute fills). */
export interface LakeState {
  spill: number;
  tilecount: number;
  minx: number; minz: number; maxx: number; maxz: number;
  errors: number;
}

/**
  The derived state of a track's lakes: one entry per lake, and the tile map (0 dry, else index + 1).
  `notches` is the notch input it was derived with (HoldsUpTo and the Lake window read it).
*/
export interface LakesState {
  lakes: LakeState[];
  tmap: Uint8Array;
  notches?: LakeNotches | null;
}

/**
  SetNotches' copies: notchlake[tile] = the source lake id (index + 1) of a notch tile, lips[tile]
  its LAKE_LIP_* edges, hasnotch[id] = 1 for a lake that owns any notch tile.
*/
export interface LakeNotches {
  notchlake: Uint8Array;
  lips: Uint8Array;
  hasnotch: Uint8Array;
}

/** SetNotches: null for no notches (a null map, or one with no tile in it). */
export function lakeNotches(notchlake: Uint8Array | null, lipedges: Uint8Array | null): LakeNotches | null {
  if (!notchlake) return null;
  const hasnotch = new Uint8Array(LAKE_MAX_LAKES + 1);
  let any = false;
  for (let t = 0; t < TILES; t++) if (notchlake[t] !== 0) { hasnotch[notchlake[t]!] = 1; any = true; }
  if (!any) return null;
  return { notchlake: notchlake.slice(0, TILES), lips: lipedges ? lipedges.slice(0, TILES) : new Uint8Array(TILES), hasnotch };
}

/** HasNotches: does lake index `l` own any notch tile. */
export function lakeHasNotches(n: LakeNotches | null | undefined, l: number): boolean {
  return Boolean(n) && l >= 0 && l < LAKE_MAX_LAKES && n!.hasnotch[l + 1] === 1;
}

/** NOTCH_FAR_HOLDS (wtr_check, the ruling of 11-11): the far points of a notch tile hold at H + 1. Test hook only. */
let notchFarHolds = true;
export function setNotchFarHolds(on: boolean): void {
  notchFarHolds = on;
}

/*
  ONE LAKE'S VIEW OF THE GROUND WITH ITS NOTCHES (LakeView, BuildView; wtr_check notch_view).
  flag[tile]: 1 a notch tile of the lake (a barrier), 2 a tile sharing ground points with one,
  whose lowest point is recomputed under the notch rule (low[tile]). Rebuilt for each H.
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
}

function viewInit(): LakeView {
  return { flag: new Uint8Array(TILES), low: new Int32Array(TILES), touched: new Int32Array(TILES), ntouched: 0, active: false, S: 0, lv: 0, g: null, lip: null };
}

/* ViewPoint: lattice point (px, pz) inside a notch tile's closed square, and on one of its lip edges. */
function viewPoint(v: LakeView, px: number, pz: number): { innotch: boolean; onlip: boolean } {
  const S = v.S, W = 256 * S;
  px &= W - 1;
  pz &= W - 1;
  const ax = [Math.trunc(px / S)], az = [Math.trunc(pz / S)];
  if (px % S === 0) ax.push((Math.trunc(px / S) - 1) & 255);
  if (pz % S === 0) az.push((Math.trunc(pz / S) - 1) & 255);
  let innotch = false, onlip = false;
  for (const a of ax) {
    for (const b of az) {
      const t = (a & 255) + ((b & 255) << 8);
      if (v.flag[t] !== 1) continue;
      innotch = true;
      const lx = (px - S * a) & (W - 1), lz = (pz - S * b) & (W - 1);
      const m = v.lip![t]!;
      if (((m & LAKE_LIP_N) && lz === 0) || ((m & LAKE_LIP_E) && lx === S) || ((m & LAKE_LIP_S) && lz === S) || ((m & LAKE_LIP_W) && lx === 0) ||
        ((m & LAKE_LIP_NW) && lx === 0 && lz === 0) || ((m & LAKE_LIP_NE) && lx === S && lz === 0) ||
        ((m & LAKE_LIP_SE) && lx === S && lz === S) || ((m & LAKE_LIP_SW) && lx === 0 && lz === S)) onlip = true;
    }
  }
  return { innotch, onlip };
}

/* ViewTileLow: the lowest point of tile (x, z) under the notch rule. */
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

const VIEW_OX = [-1, 0, 1, -1, 1, -1, 0, 1];
const VIEW_OZ = [-1, -1, -1, 0, 0, 1, 1, 1];

/* BuildView: lake l's view at h (inactive for a lake without notches). */
function buildView(v: LakeView, g: LakeGround, notches: LakeNotches | null | undefined, l: number, h: number): void {
  for (let i = 0; i < v.ntouched; i++) v.flag[v.touched[i]!] = 0;
  v.ntouched = 0;
  v.active = false;
  if (!lakeHasNotches(notches, l)) return;
  v.g = g;
  v.lip = notches!.lips;
  v.S = pointStep(g);
  v.lv = heightLevel(g, h);
  for (let t = 0; t < TILES; t++) if (notches!.notchlake[t] === l + 1) { v.flag[t] = 1; v.touched[v.ntouched++] = t; }
  v.active = true;
  if (v.S === 0) return; // no ground points to read: the notch tiles are barriers only
  const nn = v.ntouched;
  for (let i = 0; i < nn; i++) {
    const x = v.touched[i]! & 255, z = v.touched[i]! >> 8;
    for (let d = 0; d < 8; d++) {
      const u = ((x + VIEW_OX[d]!) & 255) + (((z + VIEW_OZ[d]!) & 255) << 8);
      if (v.flag[u] === 0) { v.flag[u] = 2; v.touched[v.ntouched++] = u; }
    }
  }
  for (let i = nn; i < v.ntouched; i++) { const t = v.touched[i]!; v.low[t] = viewTileLow(v, t & 255, t >> 8); }
}

/* LowV: the lowest point of a tile for the fill and the flood, the view's or the plain ground's. */
function lowV(g: LakeGround, v: LakeView | null, x: number, z: number): number {
  if (v && v.active) {
    const t = (x & 255) + ((z & 255) << 8);
    if (v.flag[t] === 2) return v.low[t]!;
  }
  return tileLow(g, x, z);
}

function notchTile(v: LakeView | null, x: number, z: number): boolean {
  return Boolean(v && v.active && v.flag[(x & 255) + ((z & 255) << 8)] === 1);
}

/*
  GroundAtV: is the ground of tile (x, z) at level h for CORNER_AT_H in the lake's view? A corner
  (Classic) or a flat triangle (fine) at exactly H touching a lip edge is exempt; a notch tile is
  never asked.
*/
function groundAtV(g: LakeGround, v: LakeView | null, x: number, z: number, h: number): boolean {
  if (!v || !v.active) return groundAtH(g, x, z, h);
  if (notchTile(v, x, z)) return false;
  if (!groundAtH(g, x, z, h)) return false;
  if (v.S === 0) return true;
  const S = v.S;
  const at = (dz: number, dx: number) => pointLevel(g, S * (x & 255) + dx, S * (z & 255) + dz) === v.lv;
  const lp = (dz: number, dx: number) => viewPoint(v, S * (x & 255) + dx, S * (z & 255) + dz).onlip;
  const A: boolean[][] = [], L: boolean[][] = [];
  for (let dz = 0; dz <= S; dz++) { A.push([]); L.push([]); for (let dx = 0; dx <= S; dx++) { A[dz]!.push(at(dz, dx)); L[dz]!.push(lp(dz, dx)); } }
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

function corner(raw: Uint8Array, x: number, z: number): number {
  return 4 * raw[(x & 255) + ((z & 255) << 8)];
}

function minCorner(raw: Uint8Array, x: number, z: number): number {
  return Math.min(corner(raw, x, z), corner(raw, x + 1, z), corner(raw, x + 1, z + 1), corner(raw, x, z + 1));
}

function cornerAt(raw: Uint8Array, x: number, z: number, h: number): boolean {
  return corner(raw, x, z) === h || corner(raw, x + 1, z) === h || corner(raw, x + 1, z + 1) === h || corner(raw, x, z + 1) === h;
}

function tileLow(g: LakeGround, x: number, z: number): number {
  if (g.raw) return minCorner(g.raw, x, z);
  return g.tilemin![(x & 255) + ((z & 255) << 8)];
}

const levelOf = heightLevel;

function groundAtH(g: LakeGround, x: number, z: number, h: number): boolean {
  if (g.raw) return cornerAt(g.raw, x, z, h);
  return g.groundAtLevel!((x & 255) + ((z & 255) << 8), levelOf(g, h));
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
  const v = s.tmap[(x & 255) + ((z & 255) << 8)];
  return v === 0 || v > lakes.length ? -1 : v - 1;
}

/** SeedIndex. */
export function seedIndex(lakes: readonly TxxLake[], l: number, x: number, z: number): number {
  if (l < 0 || l >= lakes.length) return -1;
  const seeds = lakes[l].seeds;
  for (let i = 0; i < seeds.length && i < LAKE_MAX_SEEDS; i++) if (seeds[i][0] === (x & 255) && seeds[i][1] === (z & 255)) return i;
  return -1;
}

/** DistinctHeights: reflection passes the engine needs (body 0 counts one). */
export function distinctHeights(lakes: readonly TxxLake[], body0: number): number {
  return (body0 > 0 ? 1 : 0) + new Set(lakes.map((l) => l.height)).size;
}

/**
  Spill: the highest H the basin around (x, z) holds. `tmap` is the current tile map (other lakes
  stop the flood); `self` is this lake's index or -1. LAKE_MAX_HEIGHT for no spill; LAKE_NO_BASIN
  when the result is at or under body 0 or (x, z) is dry at it. A lake with notches (`notches`,
  its height from `lakes`) floods in its own view at its height, on either kind of ground.
*/
export function lakeSpill(g: LakeGround | null, tmap: Uint8Array | null, body0: number, x: number, z: number, self: number,
  notches: LakeNotches | null = null, lakes: readonly TxxLake[] | null = null): number {
  if (!hasGround(g)) return LAKE_NO_BASIN;
  if (self >= 0 && lakeHasNotches(notches, self) && lakes && lakes[self]) {
    const view = viewInit();
    buildView(view, g, notches, self, lakes[self]!.height);
    return spillSurface(g, view, tmap, body0, x, z, self);
  }
  if (!g.raw) return spillSurface(g, null, tmap, body0, x, z, self);
  // From here on, the Classic 8-bit code as it always was: minCorner / 4 in 256 buckets.
  const raw = g.raw;
  const key = (i: number) => minCorner(raw, i & 255, i >> 8);
  const bucketOf = (m: number) => Math.min(255, m >> 2);
  const nb = 256;

  let tx = x & 255, tz = z & 255;
  for (;;) {
    const here = key(tx + (tz << 8));
    let best = here, bx = tx, bz = tz;
    for (let d = 0; d < 4; d++) {
      const nx = (tx + DX[d]) & 255, nz = (tz + DZ[d]) & 255;
      const m = key(nx + (nz << 8));
      if (m < best) { best = m; bx = nx; bz = nz; }
    }
    if (best >= here) break;
    tx = bx; tz = bz;
  }

  const mark = new Uint8Array(TILES);
  const next = new Int32Array(TILES);
  const head = new Int32Array(nb).fill(-1);
  let i = tx + (tz << 8);
  let level = key(i);
  let curb = bucketOf(level);
  next[i] = -1; head[curb] = i; mark[i] = 1;
  let result = 0, found = false;
  for (;;) {
    while (curb < nb && head[curb] < 0) curb++;
    if (curb >= nb) break;
    i = head[curb];
    head[curb] = next[i];
    const ux = i & 255, uz = i >> 8;
    const mc = key(i);
    if (mc < level) { result = level - 1; found = true; break; }
    if (body0 > 0 && mc <= body0) { result = level - 1; found = true; break; }
    if (tmap && tmap[i] !== 0 && tmap[i] !== self + 1) { result = level - 1; found = true; break; }
    if (mc > level) level = mc;
    for (let d = 0; d < 4; d++) {
      const ni = ((ux + DX[d]) & 255) + (((uz + DZ[d]) & 255) << 8);
      if (!mark[ni]) {
        const b = bucketOf(key(ni));
        mark[ni] = 1; next[ni] = head[b]; head[b] = ni;
        if (b < curb) curb = b;
      }
    }
  }
  if (!found) return LAKE_MAX_HEIGHT;
  if (body0 > 0 && result <= body0) return LAKE_NO_BASIN;
  if (minCorner(raw, x, z) > result) return LAKE_NO_BASIN;
  return result;
}

/*
  SpillSurface: the walk and flood keyed by each tile's lowest point (u on the surface, the view's
  lowest points under notches) in one bucket per value, each bucket LIFO, the lowest first. With a
  view the notch tiles are never entered and the sea is judged on the plain ground.
*/
function spillSurface(g: LakeGround, v: LakeView | null, tmap: Uint8Array | null, body0: number, x: number, z: number, self: number): number {
  const sea = levelOf(g, body0);
  let tx = x & 255, tz = z & 255;
  for (;;) {
    const here = lowV(g, v, tx, tz);
    let best = here, bx = tx, bz = tz;
    for (let d = 0; d < 4; d++) {
      const nx = (tx + DX[d]) & 255, nz = (tz + DZ[d]) & 255;
      if (notchTile(v, nx, nz)) continue;
      const m = lowV(g, v, nx, nz);
      if (m < best) { best = m; bx = nx; bz = nz; }
    }
    if (best >= here) break;
    tx = bx; tz = bz;
  }
  const clampB = (b: number) => (b < 0 ? 0 : b >= SURFACE_BUCKETS ? SURFACE_BUCKETS - 1 : b);
  const mark = new Uint8Array(TILES);
  const next = new Int32Array(TILES);
  const head = new Int32Array(SURFACE_BUCKETS).fill(-1);
  let i = tx + (tz << 8);
  let level = lowV(g, v, tx, tz);
  let curb = clampB(level);
  next[i] = -1; head[curb] = i; mark[i] = 1;
  let result = 0, found = false;
  for (;;) {
    while (curb < SURFACE_BUCKETS && head[curb] < 0) curb++;
    if (curb >= SURFACE_BUCKETS) break; // the basin is the whole map
    i = head[curb];
    head[curb] = next[i];
    const ux = i & 255, uz = i >> 8;
    const mc = lowV(g, v, ux, uz);
    if (mc < level) { result = heldG(g, level); found = true; break; }
    if (body0 > 0 && tileLow(g, ux, uz) <= sea) { result = heldG(g, level); found = true; break; }
    if (tmap && tmap[i] !== 0 && tmap[i] !== self + 1) { result = heldG(g, level); found = true; break; }
    if (mc > level) level = mc;
    for (let d = 0; d < 4; d++) {
      const nx = (ux + DX[d]) & 255, nz = (uz + DZ[d]) & 255, ni = nx + (nz << 8);
      if (!mark[ni] && !notchTile(v, nx, nz)) {
        const b = clampB(lowV(g, v, nx, nz));
        mark[ni] = 1; next[ni] = head[b]; head[b] = ni;
        if (b < curb) curb = b;
      }
    }
  }
  if (!found) return LAKE_MAX_HEIGHT;
  if (body0 > 0 && result <= body0) return LAKE_NO_BASIN;
  if (tileLow(g, x, z) > levelOf(g, result)) return LAKE_NO_BASIN;
  return result;
}

/**
  LevelTouchesGround: lake l filled at h leaves ground of a filled or shore tile at 32 * h. A lake
  with notches is judged in its own view at h (lip points exempt, notch tiles barriers; shore
  tiles not looked at).
*/
function levelTouchesGround(g: LakeGround, lake: TxxLake, h: number, view: LakeView | null, notches: LakeNotches | null | undefined, l: number): boolean {
  const lv = levelOf(g, h);
  if (view) {
    buildView(view, g, notches, l, h);
    if (!view.active) view = null;
  }
  const mark = new Uint8Array(TILES);
  const queue = new Int32Array(TILES);
  let qh = 0, qt = 0;
  for (const [sx, sz] of lake.seeds.slice(0, LAKE_MAX_SEEDS)) {
    const t = sx + (sz << 8);
    if (lowV(g, view, sx, sz) <= lv && !mark[t] && !notchTile(view, t & 255, t >> 8)) { mark[t] = 1; queue[qt++] = t; }
  }
  while (qh < qt) {
    const t = queue[qh++];
    const tx = t & 255, tz = t >> 8;
    if (groundAtV(g, view, tx, tz, h)) return true;
    for (let d = 0; d < 4; d++) {
      const nx = (tx + DX[d]) & 255, nz = (tz + DZ[d]) & 255, ni = nx + (nz << 8);
      if (mark[ni] || notchTile(view, nx, nz)) continue;
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
  let lowest = 0;
  for (const [x, z] of lake.seeds.slice(0, LAKE_MAX_SEEDS)) lowest = Math.max(lowest, wetFromG(g, tileLow(g, x, z)));
  const view = notch ? viewInit() : null;
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
  const view = notch ? viewInit() : null;
  for (let d = 0; h - d >= lo || h + d <= hi; d++) {
    if (h - d >= lo && !levelTouchesGround(g, lake, h - d, view, notches, l)) return h - d;
    if (h + d <= hi && !levelTouchesGround(g, lake, h + d, view, notches, l)) return h + d;
  }
  return -1;
}

/** MinHeight: the lowest legal H for the Lake dialog. */
export function lakeMinHeight(g: LakeGround | null, body0: number, lake: TxxLake, notches: LakeNotches | null = null, l = -1): number {
  let lo = body0 > 0 ? body0 + 1 : 0;
  if (!hasGround(g)) return lo;
  const seeds = lake.seeds.slice(0, LAKE_MAX_SEEDS);
  const notch = lakeHasNotches(notches, l);
  if (!g.raw || notch) {
    for (const [x, z] of seeds) lo = Math.max(lo, wetFromG(g, tileLow(g, x, z)));
    const view = notch ? viewInit() : null;
    while (lo <= LAKE_MAX_HEIGHT && levelTouchesGround(g, lake, lo, view, notches, l)) lo++;
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
  let best = LAKE_MAX_HEIGHT + 1;
  for (const [sx, sz] of seeds) {
    const sp = spillSurface(g, view, tmap, body0, sx, sz, l);
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
  const view = viewInit();
  const lake = lakes[l]!;
  const H = lake.height;
  const s0 = spillNotchAt(g, view, st.tmap, notches!, body0, lake, l, H);
  if (s0 === LAKE_NO_BASIN || H > s0 || s0 >= LAKE_MAX_HEIGHT) return s0;
  let lo = H, hi = LAKE_MAX_HEIGHT, step = 1;
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

/**
  Recompute: every derived field from scratch. The whole tile map is filled (steps 1, 2) before
  the spills are measured (3), since a spill stops at another lake. A null ground clears.
*/
export function recomputeLakes(g: LakeGround | null, lakesIn: readonly TxxLake[], body0: number, notches: LakeNotches | null = null): LakesState {
  const tmap = new Uint8Array(TILES);
  const toomany = lakesIn.length > LAKE_MAX_LAKES;
  const lakes = lakesIn.slice(0, LAKE_MAX_LAKES);
  const nl = lakes.length;
  const st: LakeState[] = lakes.map(() => ({ errors: toomany ? LAKEERR_TOO_MANY : 0, spill: LAKE_NO_BASIN, tilecount: 0, minx: 0, minz: 0, maxx: 0, maxz: 0 }));
  if (nl === 0 || !hasGround(g)) return { lakes: st, tmap, notches };
  // Lakes with notches are filled and checked in their own view of the ground.
  const view = notches ? viewInit() : null;
  const mark = new Uint8Array(TILES);
  const queue = new Int32Array(TILES);
  const occ = new Uint8Array(nl * 512);

  // 1. Fill each lake; the first lake to reach a tile keeps it.
  for (let j = 0; j < nl; j++) {
    const h = lakes[j].height, hl = levelOf(g, h);
    let vw: LakeView | null = null;
    if (view && lakeHasNotches(notches, j)) { buildView(view, g, notches, j, h); vw = view; }
    let qh = 0, qt = 0;
    for (const [sx, sz] of lakes[j].seeds.slice(0, LAKE_MAX_SEEDS)) {
      const t = sx + (sz << 8);
      if (tileLow(g, sx, sz) > hl) { st[j].errors |= LAKEERR_SEED_ABOVE_WATER; continue; }
      // (a seed wet only through a lip point the notch rule lifts is not filled, and no error)
      if (notchTile(vw, sx, sz) || lowV(g, vw, sx, sz) > hl) continue;
      if (mark[t] !== ((j + 1) & 255)) { mark[t] = j + 1; queue[qt++] = t; }
    }
    while (qh < qt) {
      const u = queue[qh++];
      const ux = u & 255, uz = u >> 8;
      if (tmap[u] === 0) tmap[u] = j + 1;
      else if (tmap[u] !== j + 1) {
        const o = tmap[u] - 1;
        const e = lakes[o].height !== h ? LAKEERR_OVERLAP : LAKEERR_MERGE;
        st[o].errors |= e;
        st[j].errors |= e;
      }
      for (let d = 0; d < 4; d++) {
        const nx = (ux + DX[d]) & 255, nz = (uz + DZ[d]) & 255, ni = nx + (nz << 8);
        if (mark[ni] !== j + 1 && lowV(g, vw, nx, nz) <= hl && !notchTile(vw, nx, nz)) { mark[ni] = j + 1; queue[qt++] = ni; }
      }
    }
  }

  // 2. Same-height lakes touching edge to edge are one lake split in two.
  for (let t = 0; t < TILES; t++) {
    const a = tmap[t];
    if (a === 0) continue;
    const x = t & 255, z = t >> 8;
    for (let d = 1; d <= 2; d++) {
      const b = tmap[((x + DX[d]) & 255) + (((z + DZ[d]) & 255) << 8)];
      if (b !== 0 && b !== a && lakes[a - 1].height === lakes[b - 1].height) { st[a - 1].errors |= LAKEERR_MERGE; st[b - 1].errors |= LAKEERR_MERGE; }
    }
  }

  // 3. Spill per seed, the lowest wins; a seed with no basin spoils the lot. 4. The per-lake checks.
  for (let j = 0; j < nl; j++) {
    const ns = lakes[j].seeds.length;
    let best = LAKE_MAX_HEIGHT + 1;
    let nobasin = ns < 1;
    for (const [sx, sz] of lakes[j].seeds.slice(0, LAKE_MAX_SEEDS)) {
      const sp = lakeSpill(g, tmap, body0, sx, sz, j, notches, lakes);
      if (sp === LAKE_NO_BASIN) nobasin = true;
      else if (sp < best) best = sp;
    }
    st[j].spill = nobasin ? LAKE_NO_BASIN : best;
    if (nobasin || lakes[j].height > st[j].spill) st[j].errors |= LAKEERR_LEAK;
    if (body0 > 0 && lakes[j].height <= body0) st[j].errors |= LAKEERR_BELOW_BODY0;
    if (toomany || ns > LAKE_MAX_SEEDS || ns < 1) st[j].errors |= LAKEERR_TOO_MANY;
  }

  // 4/5. The tile checks, the count and the box columns.
  for (let t = 0; t < TILES; t++) {
    const a = tmap[t];
    if (a === 0) continue;
    const x = t & 255, z = t >> 8, j = a - 1, h = lakes[j].height;
    st[j].tilecount++;
    occ[j * 512 + x] = 1;
    occ[j * 512 + 256 + z] = 1;
    if (body0 > 0 && tileLow(g, x, z) <= levelOf(g, body0)) st[j].errors |= LAKEERR_TOUCHES_BODY0;
    if (view && lakeHasNotches(notches, j)) continue; // below, in the lake's own view
    if (groundAtH(g, x, z, h)) st[j].errors |= LAKEERR_CORNER_AT_H;
    for (let d = 0; d < 4; d++) {
      const nx = (x + DX[d]) & 255, nz = (z + DZ[d]) & 255;
      if (tmap[nx + (nz << 8)] === 0 && groundAtH(g, nx, nz, h)) st[j].errors |= LAKEERR_CORNER_AT_H;
    }
  }

  // CORNER_AT_H of a lake with notches: its filled tiles in its view, a point or flat triangle at
  // exactly H touching a lip exempt; its shore tiles are not looked at (wtr_check checks the fill only).
  if (view) {
    for (let j = 0; j < nl; j++) {
      if (!lakeHasNotches(notches, j)) continue;
      buildView(view, g, notches, j, lakes[j].height);
      for (let t = 0; t < TILES; t++) if (tmap[t] === j + 1 && groundAtV(g, view, t & 255, t >> 8, lakes[j].height)) st[j].errors |= LAKEERR_CORNER_AT_H;
    }
  }

  // 5. The wrapping box: the complement of the longest run of empty columns (rows).
  for (let j = 0; j < nl; j++) {
    for (let axis = 0; axis < 2; axis++) {
      const base = j * 512 + axis * 256;
      const o = (i: number) => occ[base + (i & 255)];
      let bestlen = 0, bestat = 0;
      for (let i = 0; i < 256; i++) {
        if (!o(i) && o(i + 255)) {
          let len = 0;
          while (len < 256 && !o(i + len)) len++;
          if (len > bestlen) { bestlen = len; bestat = i; }
        }
      }
      let lo: number, hi: number;
      if (st[j].tilecount === 0) lo = hi = 0;
      else if (bestlen === 0) { lo = 0; hi = 255; }
      else { lo = (bestat + bestlen) & 255; hi = (bestat + 255) & 255; }
      if (axis === 0) { st[j].minx = lo; st[j].maxx = hi; } else { st[j].minz = lo; st[j].maxz = hi; }
    }
  }
  return { lakes: st, tmap, notches };
}

/**
  RecomputeLakes (CTraxxView::RecomputeLakes): the derived state of a track's lakes as the track
  is now, with the notches its falls cut (UpdateLakeNotches, right before every Recompute).
*/
export function trackLakes(t: Terrain16 & { lakes: readonly TxxLake[]; waterLevel4: number; falls?: readonly TraxxFall[] }): LakesState {
  return recomputeLakes(t.lakes.length ? buildLakeGround(t) : null, t.lakes, t.waterLevel4, trackNotches(t));
}

/** BuildWTR: the .WTR image, or null when there are no lakes or one is in error. */
export function buildWtr(lakes: readonly TxxLake[], s: LakesState): Uint8Array | null {
  if (!lakes.length || anyLakeErrors(s) !== 0) return null;
  return writeWtr(lakes.map((l, i) => ({
    flags: l.flags, height: l.height, seeds: l.seeds.map(([x, z]) => ({ x, z })),
    box: { minX: s.lakes[i].minx, minZ: s.lakes[i].minz, maxX: s.lakes[i].maxx, maxZ: s.lakes[i].maxz },
    tileCount: s.lakes[i].tilecount,
  })), s.tmap);
}

/**
  ParseWTR: the authored lakes of a .WTR (ids in order 1..N, 1..8 seeds each) and its stored tile
  map; null when the file cannot be used (Traxx then has no lakes).
*/
export function parseWtrLakes(bytes: Uint8Array): { lakes: TxxLake[]; tmap: Uint8Array | null } | null {
  if (!isWtr(bytes)) return null;
  let w;
  try { w = parseWtr(bytes); } catch { return null; }
  if (w.major > 1 || w.lakes.length > LAKE_MAX_LAKES) return null;
  const lakes: TxxLake[] = [];
  for (let i = 0; i < w.lakes.length; i++) {
    const k = w.lakes[i];
    if (k.id !== i + 1 || k.seeds.length < 1 || k.seeds.length > LAKE_MAX_SEEDS) return null;
    lakes.push({ height: k.height | 0, flags: k.flags & 0xffff, seeds: k.seeds.map((p) => [p.x & 255, p.z & 255] as [number, number]) });
  }
  return { lakes, tmap: w.tileMap };
}

/** The message Traxx shows when a pod's stored tile map differs from the one it computes. */
export const LAKES_MISMATCH = "The lakes in this pod don't match its terrain; showing them as Traxx computes them.";
/** Write POD's report when the lakes cannot be packed. */
export const LAKES_NOT_SAVED = "The lakes could not be written into the pod (the name does not fit a pod entry, or a lake is in error).\n\nThe pod was saved WITHOUT its lakes. Fix them and save again.";
