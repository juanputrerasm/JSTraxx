/*
  Lakes: extra water bodies above the track's main water (body 0), packed as WORLD\<stem>.WTR
  (TrackPOD/TrackPODLakes.cpp, Traxx/TrackPODLakes.h).

  Only the authored part (height, flags, seeds: TxxLake) is saved in the .TXX. The rest (filled
  tiles, spill, box, errors) is derived by recompute() from the ground and body 0, whenever the
  terrain or a lake changes. Units: H in water units (0.5 ft, the same as waterLevel4). On a
  Classic 8-bit track a corner is 4 * raw; the drive surface compares u = v >> 1 with 32 * H.
  Containment is strict: a tile is wet when its lowest point is at or under the water.
*/
import { writeWtr, parseWtr, isWtr } from "../../vendor/openphotex/mtm/wtr.js";
import type { TxxLake } from "./txx.ts";
import { buildLakeGround, type LakeGround } from "./surface.ts";
import type { Terrain16 } from "./terrain16.ts";

export const LAKE_MAX_LAKES = 255;
export const LAKE_MAX_SEEDS = 8;
export const LAKE_MAX_HEIGHT = 4 * 255 + 3;
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

/** The derived state of a track's lakes: one entry per lake, and the tile map (0 dry, else index + 1). */
export interface LakesState {
  lakes: LakeState[];
  tmap: Uint8Array;
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

function levelOf(g: LakeGround, h: number): number {
  if (g.raw) return h;
  if (h < -1) h = -1;
  if (h > LAKE_MAX_HEIGHT + 1) h = LAKE_MAX_HEIGHT + 1;
  return 32 * h;
}

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
  when the result is at or under body 0 or (x, z) is dry at it.
*/
export function lakeSpill(g: LakeGround | null, tmap: Uint8Array | null, body0: number, x: number, z: number, self: number): number {
  if (!hasGround(g)) return LAKE_NO_BASIN;
  const raw = g.raw;
  // The 8-bit path keys on minCorner / 4 (256 buckets); the surface on u (32768 buckets).
  const key = raw ? (i: number) => minCorner(raw, i & 255, i >> 8) : (i: number) => g.tilemin![i];
  const bucketOf = raw ? (m: number) => Math.min(255, m >> 2) : (m: number) => (m < 0 ? 0 : m >= SURFACE_BUCKETS ? SURFACE_BUCKETS - 1 : m);
  const nb = raw ? 256 : SURFACE_BUCKETS;
  const sea = raw ? body0 : levelOf(g, body0);
  const held = raw ? (level: number) => level - 1 : heldBelow;

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
    if (mc < level) { result = held(level); found = true; break; }
    if (body0 > 0 && mc <= sea) { result = held(level); found = true; break; }
    if (tmap && tmap[i] !== 0 && tmap[i] !== self + 1) { result = held(level); found = true; break; }
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
  if (raw) { if (minCorner(raw, x, z) > result) return LAKE_NO_BASIN; }
  else if (g.tilemin![(x & 255) + ((z & 255) << 8)] > levelOf(g, result)) return LAKE_NO_BASIN;
  return result;
}

/** LevelTouchesGround: lake l filled at h leaves ground of a filled or shore tile at 32 * h (surface only). */
function levelTouchesGround(g: LakeGround, lake: TxxLake, h: number): boolean {
  const lv = levelOf(g, h);
  const tm = g.tilemin!, at = g.groundAtLevel!;
  const mark = new Uint8Array(TILES);
  const queue = new Int32Array(TILES);
  let qh = 0, qt = 0;
  for (const [sx, sz] of lake.seeds.slice(0, LAKE_MAX_SEEDS)) {
    const t = sx + (sz << 8);
    if (tm[t] <= lv && !mark[t]) { mark[t] = 1; queue[qt++] = t; }
  }
  while (qh < qt) {
    const t = queue[qh++];
    const tx = t & 255, tz = t >> 8;
    if (at(t, lv)) return true;
    for (let d = 0; d < 4; d++) {
      const ni = ((tx + DX[d]) & 255) + (((tz + DZ[d]) & 255) << 8);
      if (mark[ni]) continue;
      if (tm[ni] <= lv) { mark[ni] = 1; queue[qt++] = ni; }
      else if (at(ni, lv)) return true;
    }
  }
  return false;
}

/** FitHeight for any ground: on raw the static rule; on the surface, down to the first legal level, never under the seeds' wet level. */
export function lakeFitHeight(g: LakeGround | null, lake: TxxLake, h: number, maxh: number): number {
  if (!g || g.raw || !hasGround(g)) return fitHeight8(h, maxh);
  if (h > maxh) h = maxh;
  let lowest = 0;
  for (const [x, z] of lake.seeds.slice(0, LAKE_MAX_SEEDS)) lowest = Math.max(lowest, wetFrom(g.tilemin![x + (z << 8)]));
  while (h > lowest && levelTouchesGround(g, lake, h)) h--;
  return h < lowest ? lowest : h;
}

/** NearestLegalHeight for any ground. */
export function lakeNearestLegalHeight(g: LakeGround | null, lake: TxxLake, h: number, lo: number, hi: number): number {
  if (!g || g.raw || !hasGround(g)) return nearestLegalHeight8(h, lo, hi);
  if (lo > hi) return -1;
  if (h < lo) h = lo;
  if (h > hi) h = hi;
  for (let d = 0; h - d >= lo || h + d <= hi; d++) {
    if (h - d >= lo && !levelTouchesGround(g, lake, h - d)) return h - d;
    if (h + d <= hi && !levelTouchesGround(g, lake, h + d)) return h + d;
  }
  return -1;
}

/** MinHeight: the lowest legal H for the Lake dialog. */
export function lakeMinHeight(g: LakeGround | null, body0: number, lake: TxxLake): number {
  let lo = body0 > 0 ? body0 + 1 : 0;
  if (!hasGround(g)) return lo;
  const seeds = lake.seeds.slice(0, LAKE_MAX_SEEDS);
  if (!g.raw) {
    for (const [x, z] of seeds) lo = Math.max(lo, wetFrom(g.tilemin![x + (z << 8)]));
    while (lo <= LAKE_MAX_HEIGHT && levelTouchesGround(g, lake, lo)) lo++;
    return lo;
  }
  for (const [x, z] of seeds) lo = Math.max(lo, minCorner(g.raw, x, z));
  if ((lo & 3) === 0) lo++;
  return lo;
}

/**
  Recompute: every derived field from scratch. The whole tile map is filled (steps 1, 2) before
  the spills are measured (3), since a spill stops at another lake. A null ground clears.
*/
export function recomputeLakes(g: LakeGround | null, lakesIn: readonly TxxLake[], body0: number): LakesState {
  const tmap = new Uint8Array(TILES);
  const toomany = lakesIn.length > LAKE_MAX_LAKES;
  const lakes = lakesIn.slice(0, LAKE_MAX_LAKES);
  const nl = lakes.length;
  const st: LakeState[] = lakes.map(() => ({ errors: toomany ? LAKEERR_TOO_MANY : 0, spill: LAKE_NO_BASIN, tilecount: 0, minx: 0, minz: 0, maxx: 0, maxz: 0 }));
  if (nl === 0 || !hasGround(g)) return { lakes: st, tmap };
  const mark = new Uint8Array(TILES);
  const queue = new Int32Array(TILES);
  const occ = new Uint8Array(nl * 512);

  // 1. Fill each lake; the first lake to reach a tile keeps it.
  for (let j = 0; j < nl; j++) {
    const h = lakes[j].height, hl = levelOf(g, h);
    let qh = 0, qt = 0;
    for (const [sx, sz] of lakes[j].seeds.slice(0, LAKE_MAX_SEEDS)) {
      const t = sx + (sz << 8);
      if (tileLow(g, sx, sz) > hl) { st[j].errors |= LAKEERR_SEED_ABOVE_WATER; continue; }
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
        if (mark[ni] !== j + 1 && tileLow(g, nx, nz) <= hl) { mark[ni] = j + 1; queue[qt++] = ni; }
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
      const sp = lakeSpill(g, tmap, body0, sx, sz, j);
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
    if (groundAtH(g, x, z, h)) st[j].errors |= LAKEERR_CORNER_AT_H;
    for (let d = 0; d < 4; d++) {
      const nx = (x + DX[d]) & 255, nz = (z + DZ[d]) & 255;
      if (tmap[nx + (nz << 8)] === 0 && groundAtH(g, nx, nz, h)) st[j].errors |= LAKEERR_CORNER_AT_H;
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
  return { lakes: st, tmap };
}

/** RecomputeLakes (CTraxxView::RecomputeLakes): the derived state of a track's lakes as the track is now. */
export function trackLakes(t: Terrain16 & { lakes: readonly TxxLake[]; waterLevel4: number }): LakesState {
  return recomputeLakes(t.lakes.length ? buildLakeGround(t) : null, t.lakes, t.waterLevel4);
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
