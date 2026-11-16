/*
  The ground points the spillway notches and the waterfalls' lip checks read (Traxx 1.7.1,
  TrackPOD/TrackPODLakes.cpp: PointStep, PointLevel, HeightLevel, LevelUnit; Include/TrackPODLakes.h
  LAKE_LIP_*). Kept apart from lakes.ts so falls.ts can use them without importing the lakes.

  A lattice of the ground's points: tile (tx, tz) owns points S*tx .. S*tx + S on each axis, S =
  PointStep: 1 on Classic 8 / 16-bit (the 4 corners), 4 on Spline and Full Map (the 25 fine
  points). Neighbouring tiles share the points on their common edge.
*/
import type { LakeGround } from "./surface.ts";
import { sideOf } from "./world.ts";

/** LAKE_MAX_HEIGHT (water units). */
export const LAKE_MAX_HEIGHT = 4 * 255 + 3;
/*
  Track format version 6 (track-format-v6.md 7.3, 9.1): heights may be negative or far above
  512 ft, and a version 2 .WTR holds an i32 height in half-feet (water units) anywhere in the
  terrain's range. The widest range the 32-bit height store holds (world.ts V6_V_MIN..V6_V_MAX,
  -32768 to 98302 ft) in water units. A ground whose points all fit 0..512 ft keeps Traxx's
  LAKE_MAX_HEIGHT, so nothing changes for a track CP4 can hold.
*/
export const LAKE_V6_MIN_HEIGHT = -2 * 32768;
export const LAKE_V6_MAX_HEIGHT = 2 * (32767 + 65535);
/** u (1/64 ft) a 16-bit 0..512 ft ground spans: Traxx's 32768 surface buckets. */
const CLASSIC_U_SPAN = 32768;

/** N, the cells a side of a lake ground (the side of its grid; spec 8.2). */
export function groundCells(g: LakeGround): number {
  const a = g.raw ?? g.tilemin;
  if (!a || a.length === 65536) return 256;
  return sideOf(a.length);
}

const ranges = new WeakMap<LakeGround, { base: number; count: number; wide: boolean }>();

/**
  The bucket range of the surface flood (SpillSurface): u 0..32767 as Traxx has it when every
  tile's lowest point fits 0..512 ft; otherwise (a version 6 ground below 0 or at 512 ft or more)
  the tiles' own range, so the flood still keys one bucket per u.
*/
export function groundSurfaceRange(g: LakeGround): { base: number; count: number; wide: boolean } {
  const hit = ranges.get(g);
  if (hit) return hit;
  let r = { base: 0, count: CLASSIC_U_SPAN, wide: false };
  if (!g.raw && g.tilemin) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < g.tilemin.length; i++) { const u = g.tilemin[i]!; if (u < lo) lo = u; if (u > hi) hi = u; }
    if (lo < 0 || hi >= CLASSIC_U_SPAN) r = { base: lo, count: hi - lo + 2, wide: true };
  }
  ranges.set(g, r);
  return r;
}

/** The highest lake height (water units) on this ground: Traxx's LAKE_MAX_HEIGHT, or the version 6 range. */
export function lakeMaxHeightFor(g: LakeGround | null | undefined): number {
  return g && groundSurfaceRange(g).wide ? LAKE_V6_MAX_HEIGHT : LAKE_MAX_HEIGHT;
}

/** The lowest lake height (water units) a dialog offers on this ground: 0, or the version 6 range. */
export function lakeMinHeightFor(g: LakeGround | null | undefined): number {
  return g && groundSurfaceRange(g).wide ? LAKE_V6_MIN_HEIGHT : 0;
}

/** Lip edges of a notch tile, one bit per tile edge (SetNotches' lipedges). */
export const LAKE_LIP_N = 0x01; // the edge on the tile's z = tz side
export const LAKE_LIP_E = 0x02; // x = tx + 1
export const LAKE_LIP_S = 0x04; // z = tz + 1
export const LAKE_LIP_W = 0x08; // x = tx
/** A diagonal notch / lake pair's one shared vertex, the corner of the notch tile facing the lake tile. */
export const LAKE_LIP_NW = 0x10; // the corner (tx, tz)
export const LAKE_LIP_NE = 0x20; // (tx + 1, tz)
export const LAKE_LIP_SE = 0x40; // (tx + 1, tz + 1)
export const LAKE_LIP_SW = 0x80; // (tx, tz + 1)

/** PointStep: 1 on Classic 8 / 16-bit, 4 on the fine modes, 0 when the ground cannot give points. */
export function pointStep(g: LakeGround): number {
  if (g.raw) return 1;
  if (g.pointU && (g.step ?? 0) >= 1) return g.step!;
  return 0;
}

/** PointLevel: lattice point (px, pz) in HeightLevel units (4 * raw on Classic 8-bit, u on the surface). */
export function pointLevel(g: LakeGround, px: number, pz: number): number {
  if (g.raw) {
    if (g.raw.length === 65536) return 4 * g.raw[(px & 255) + ((pz & 255) << 8)]!;
    const n = groundCells(g);
    return 4 * g.raw[(px & (n - 1)) + (pz & (n - 1)) * n]!;
  }
  if (!g.pointU) return 0;
  return g.pointU(px, pz);
}

/** LevelOf / HeightLevel: H in the ground's units (h on Classic 8-bit; 32 * h, clamped to -1..1024 first, on the surface; the version 6 range on a wide ground). */
export function heightLevel(g: LakeGround, h: number): number {
  if (g.raw) return h;
  const wide = groundSurfaceRange(g).wide;
  const lo = wide ? LAKE_V6_MIN_HEIGHT - 1 : -1, hi = (wide ? LAKE_V6_MAX_HEIGHT : LAKE_MAX_HEIGHT) + 1;
  if (h < lo) h = lo;
  if (h > hi) h = hi;
  return 32 * h;
}

/** LevelUnit: the HeightLevel of one water unit. */
export function levelUnit(g: LakeGround): number {
  return g.raw ? 1 : 32;
}

/*
  THE CONTAINMENT RULE (Traxx 1.7.3, e175d20; Include/TrackPODLakes.h LAKE_RULE_*; water-bodies
  handover 4.1-4.3 = EDGE, 4.5 = TILE). EDGE is what the author gets for everything new: water
  crosses between 4-neighbours only through an edge whose lowest point is <= H. TILE is the rule of
  .WTR files built before 2026-11-14 (header flags bit 0 = 0); a pod opened with one is filled as
  it was built. A .TXX does not store the rule: opening one gives the default.
*/
export const LAKE_RULE_TILE = 0;
export const LAKE_RULE_EDGE = 1;

let defaultRule = LAKE_RULE_EDGE;

/** SetDefaultRule: what a lake set without a stated rule runs (EDGE; the tests flip it). */
export function setLakeDefaultRule(r: number): void {
  defaultRule = r === LAKE_RULE_TILE ? LAKE_RULE_TILE : LAKE_RULE_EDGE;
}

export function lakeDefaultRule(): number {
  return defaultRule;
}

/** The rule a track's lakes run: what its .WTR said (a viewed pod), else the default. */
export function trackLakeRule(t: { lakeRule?: number }): number {
  return t.lakeRule === LAKE_RULE_TILE || t.lakeRule === LAKE_RULE_EDGE ? t.lakeRule : defaultRule;
}

/** A tile's side, the order of the spill's walk (LAKE_DIR_*). */
export const LAKE_DIR_N = 0; // z = tz side
export const LAKE_DIR_E = 1; // x = tx + 1
export const LAKE_DIR_S = 2; // z = tz + 1
export const LAKE_DIR_W = 3; // x = tx

/**
  A NOTCH EDGE, the input of the EDGE rule (handover 4.1a): the edge between the lake tile A (the
  one containing p - 1 ft * f) and the tile D (p + 1 ft * f) of one crest column, for a fall whose
  source is the lake. `lake` is the lake id (index + 1); (x, z) is either of the two tiles and
  `dir` the side of THAT tile the edge is on: the core closes it from both sides.
*/
export interface LakeNotchEdge {
  lake: number;
  x: number;
  z: number;
  dir: number;
}

/** LAKE_MAX_AT: Lake.atx / atz keep the first this many CORNER_AT_H points. */
export const LAKE_MAX_AT = 32;

/**
  The lakes' notch input and rule (CTrackPODLakes' notches, lips, nedges and rule): the tile form
  (SetNotches: notchlake[tile] = the source lake id of a notch tile, lips[tile] its LAKE_LIP_* edges)
  and the edge form (SetNotchEdges). hasnotch[id] = the lake owns a notch TILE, hasedge[id] = it
  owns a notch EDGE (an explicit one, or the N / E / S / W lip bit of one of its notch tiles).
*/
export interface LakeNotches {
  notchlake: Uint8Array | null;
  lips: Uint8Array | null;
  hasnotch: Uint8Array;
  edges: LakeNotchEdge[];
  hasedge: Uint8Array;
  rule: number;
}

/**
  SetNotches + SetNotchEdges + rule (both copied; ids and directions out of range dropped). Null
  when there is no notch tile and no edge and the rule is the default: every result is then
  exactly what it is without notches.
*/
export function makeLakeNotches(notchlake: Uint8Array | null, lipedges: Uint8Array | null, edges: readonly LakeNotchEdge[] | null = null,
  rule = defaultRule): LakeNotches | null {
  const hasnotch = new Uint8Array(256), hasedge = new Uint8Array(256);
  let tiles: Uint8Array | null = null, lips: Uint8Array | null = null;
  if (notchlake) {
    let any = false;
    for (let t = 0; t < notchlake.length; t++) if (notchlake[t] !== 0) { hasnotch[notchlake[t]!] = 1; any = true; }
    if (any) {
      tiles = notchlake.slice();
      lips = lipedges ? lipedges.slice(0, notchlake.length) : new Uint8Array(notchlake.length);
    }
  }
  const list: LakeNotchEdge[] = [];
  for (const e of edges ?? []) if (e.lake >= 1 && e.lake <= 255 && e.dir >= 0 && e.dir < 4) list.push({ lake: e.lake, x: e.x, z: e.z, dir: e.dir });
  // RecalcEdgeFlags: an explicit edge, or the edge a lip bit of a notch tile names.
  for (const e of list) hasedge[e.lake] = 1;
  if (tiles && lips) {
    for (let t = 0; t < tiles.length; t++) if (tiles[t] !== 0 && (lips[t]! & (LAKE_LIP_N | LAKE_LIP_E | LAKE_LIP_S | LAKE_LIP_W))) hasedge[tiles[t]!] = 1;
  }
  const r = rule === LAKE_RULE_TILE ? LAKE_RULE_TILE : LAKE_RULE_EDGE;
  if (!tiles && !list.length && r === defaultRule) return null;
  return { notchlake: tiles, lips, hasnotch, edges: list, hasedge, rule: r };
}

/** The rule of a notch input (null: the default). */
export function lakeRuleOf(n: LakeNotches | null | undefined): number {
  return n ? n.rule : defaultRule;
}
