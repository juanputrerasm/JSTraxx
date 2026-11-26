/*
  WATERFALLS (Traxx 1.7.3: Include/TrackPODFalls.h, TrackPOD/TrackPODFalls.cpp, and the pod's
  FallGroundFor / FallNameInPod / UpdateLakeNotches in TrackPOD/TrackPOD.cpp): a sheet of water
  that pours over a crest line, written into the pod as WORLD\<stem>.WFL (through OpenPhotex's
  writeWfl) and into the .TXX as the V18 block (txx.ts).

  Ported 1:1, constants and integer rules included. The shape is Traxx's port of the engine's
  reference (wtr_check.py: Crest.at, make_cols, walk_column, _totals, fall_build_stats; the
  Classic ground is ground_raw = groundHeight1). Plain data, no DOM.

  UNITS.
    - Crest points are stored in 1/16 ft, 0..131071 (the world is 8192 ft square and wraps; a
      track format version 6 world is W = 32 N ft, points 0..16 W - 1, see below).
    - speed is 1/16 ft/s (6 ft/s = 96); height is a raw water unit (0.5 ft), like a lake's.
    - The shaper works in FEET: the ground callbacks get x / z in [0, 8192) ([0, W)), heights are
      feet, and the column points are feet UNWRAPPED from crest point 0.

  THE DERIVED-HEIGHT RULE. A fall with source n (a lake index + 1) has no height of its own: its
  height is the lake's, everywhere (fallEffectiveHeight). `height` is used only for a spring.

  Traxx 1.7.2 / 1.7.3 (8a320a4..4364111): the dry fall's final run-out trim, the slab (the back face
  counted, the preview's front face pushed out by the thickness, capped), one mist box per stream
  (the streams split where the landing breaks), Rough water / Rough from (.WFL byte 130, FALL_ROUGH),
  the final-audit fixes (nudge min(0.5, 0.5 l), errored falls take no budget, flags & 7, model
  textures for the name check), and the lakes' EDGE rule on the falls' side (notch EDGES:
  buildNotchEdges; FALL_NOTCH, FALL_NOTCH_SHARED and the lip codes in their edge meanings).
*/
import type { LakeGround } from "./surface.ts";
import { surfaceFeet, cornerV } from "./surface.ts";
import { syncFromRaw, TERRAINMODE_CLASSIC8, TERRAINMODE_CLASSIC16, TERRAINMODE_FINE, TERRAINMODE_SPLINE, type Terrain16 } from "./terrain16.ts";
import {
  heightLevel, levelUnit, pointLevel, pointStep, makeLakeNotches, lakeDefaultRule, trackLakeRule,
  LAKE_LIP_E, LAKE_LIP_N, LAKE_LIP_NE, LAKE_LIP_NW, LAKE_LIP_S, LAKE_LIP_SE, LAKE_LIP_SW, LAKE_LIP_W,
  LAKE_DIR_E, LAKE_DIR_N, LAKE_DIR_S, LAKE_DIR_W, LAKE_RULE_EDGE, type LakeNotchEdge, type LakeNotches,
} from "./lake-ground.ts";
import { cG } from "./veg.ts";
import { cellsOf, cellShiftOf, sideOf, worldFtOf } from "./world.ts";
import { parseWfl, writeWfl, isWfl } from "../../vendor/openphotex/mtm/wfl.js";
import { fallHeightRange } from "../../vendor/openphotex/sim/cp4/falls.js";

export const FALL_MAX_FALLS = 64;
export const FALL_MAX_POINTS = 8;
/** char[16]: at most 15 characters and the NUL. */
export const FALL_NAMELEN = 16;
/** The highest crest point coordinate of the retail 256-cell world (1/16 ft); fallCoordMax for any N. */
export const FALL_COORD_MAX = 131071;
/** The retail world's side in feet; fallWorldFt for any N. */
export const FALL_WORLD_FT = 8192;

/*
  Track format version 6 (track-format-v6.md 9.3, .WFL version 2): a waterfall lives in the
  track's N world. Every constant Traxx takes from the 256-cell world comes from N here:

    crest points        0 .. 16 W - 1 in 1/16 ft (131071 at N = 256), wrapped at 16 W
    crest segments      the short way across the wrap at W (W / 2 either side)
    tile of a point     floor(p / 32) & (N - 1), index tx + tz * N in the N x N tile map
    the walk's ground   the track's terrain, wrapped at W (the 32-bit h128 store on a version 6 track)
    .WFL version        the world's size picks it: 256 cells version 1, 512 cells version 2
    crest height        1..4096 at 256 cells (version 1, any track), the version 2 range of the
                        terrain's step and base at 512 cells

  At N = 256 on a track that is not version 6 every value and rule is Traxx 1.7.1's, unchanged.
*/

/** A track's world as the falls see it: N, and a version 6 track's height step and base (null: not version 6). */
export interface FallWorld {
  cells: number;
  terrain: { step: number; base: number } | null;
  /**
    The track kind's crest ceiling, half-feet (Traxx origin/main TrackPOD.cpp FallMaxHeight: FALL_MAX_HEIGHT on a
    classic track, the lake cap, the terrain ceiling / 64, on a v6 one); absent: the .WFL version's own range.
  */
  maxHeight?: number;
}
/** The world of every track that is not version 6: 256 cells, Traxx's 1..4096 crest heights. */
export const FALL_WORLD_CLASSIC: FallWorld = { cells: 256, terrain: null };

/** The highest crest point coordinate of an N-cell world, 16 W - 1 (1/16 ft). */
export function fallCoordMax(cells = 256): number {
  return 16 * worldFtOf(cells) - 1;
}

/** W, the side in feet of the world crest points wrap in. */
export function fallWorldFt(cells = 256): number {
  return worldFtOf(cells);
}

/* The world's constants: N, N - 1, log2 N, W (ft) and U = 16 W (1/16 ft). */
interface Wd { N: number; M: number; SH: number; W: number; U: number }
const WD_CLASSIC: Wd = { N: 256, M: 255, SH: 8, W: 8192, U: 131072 };
function wd(cells = 256): Wd {
  if (cells === 256) return WD_CLASSIC;
  return { N: cells, M: cells - 1, SH: cellShiftOf(cells), W: worldFtOf(cells), U: 16 * worldFtOf(cells) };
}

/** N of a tile map (or any N x N byte grid). */
function mapCells(m: { length: number }): number {
  return m.length === 65536 ? 256 : sideOf(m.length);
}

export const FALLFLAG_FREEZE = 0x0001;
export const FALLFLAG_SPLASH = 0x0002;
export const FALLFLAG_SOUND = 0x0004;

/** Error bits (handover section 5): any error refuses the pod build. */
export const FALLERR_POINTS = 0x0001;
export const FALLERR_TURN = 0x0002;
export const FALLERR_WIDTH = 0x0004;
export const FALLERR_COORD = 0x0008;
export const FALLERR_SOURCE = 0x0010;
export const FALLERR_HEIGHT = 0x0020;
export const FALLERR_SPEED = 0x0040;
export const FALLERR_DIRECTION = 0x0080;
export const FALLERR_NAME = 0x0100;
export const FALLERR_COUNT = 0x0200;
export const FALLERR_NOTCH = 0x0400;
export const FALLERR_NOTCH_SHARED = 0x0800;
export const FALLERR_LIP_LOW = 0x1000;
/** roughFrom 251..254 (.WFL v1.1 byte 130; 0, 1..250 and 255 are valid). The last error bit. */
export const FALLERR_ROUGH = 0x2000;

/** Warning bits. */
export const FALLWARN_DRY = 0x0002;
export const FALLWARN_COARSE = 0x0004;
export const FALLWARN_SHORTENED = 0x0008;
export const FALLWARN_DROPPED = 0x0010;
export const FALLWARN_SILENT = 0x0020;
export const FALLWARN_LIP_HIGH = 0x0040;
export const FALLWARN_LIP_UNCOVERED = 0x0080;
export const FALLWARN_NOTCH_FLAT = 0x0100;

export const FALLEND_WATER = 0;
export const FALLEND_GROUND = 1;
export const FALLEND_LIMIT = 2;

/** FALL_ROW_SPACING: a column's rows are 2 ft of path apart. */
export const FALL_ROW_SPACING = 2.0;
/** Dry landings: ground this far above the line between two neighbouring landing points breaks the stream. */
export const FALL_LAND_RISE = 2.0;
/** At most this many mist boxes (streams) per fall. */
export const FALL_MAX_LANDINGS = 4;
export const FALL_NSPACINGS = 5;
/** FALL_MAX_COLS: the engine builds no sheet with more columns at a spacing. */
export const FALL_MAX_COLS = 1100;
/** Sheet + foam + the slab's back face (handover 4.6; 16384 before Traxx 1.7.2). */
export const FALL_VERTS_PER_FALL = 32768;
export const FALL_VERTS_PER_TRACK = 262144;
/** The engine's looping sounds (WaterfallDlg.cpp FALLDLG_LOOPING_SOUNDS). */
export const FALL_LOOPING_SOUNDS = 30;

const FALL_DT = 1.0 / 60.0;
const FALL_GRAVITY = 32.0;
const FALL_DRAPE = 0.3;
const FALL_DRAG = 0.98;
const FALL_MAX_STEPS = 4000;
const FALL_REST_SPEED = 2.0;
const FALL_REST_COSINE = 0.9961946980917455; // cos 5 degrees
/** ft above ground + 0.3 that still counts as draped (the air flag only). */
const FALL_AIRTOL = 0.05;
/*
  The final run-out trim (cursh2 4778a2d, FallShape.h): a column that ends on ground and finishes
  with a flat (normal.y > cos 10), draped (air 0), never-dropping (< FALL_RUNOUT_DROP ft left)
  stretch longer than FALL_RUNOUT_FT of path ends at the first row past FALL_RUNOUT_FT.
*/
const FALL_RUNOUT_FT = 8.0;
const FALL_RUNOUT_DROP = 1.0;
const FALL_COS10 = 0.98480775301220806;
const FALL_MAXROWS = 4000 + 2;
/** The eased vertex speed decays by exp(-step / 8 ft) (FallShape.h). */
const FALL_BRAKE_FT = 8.0;
/** The sink row: this far under the surface. */
const FALL_SINK_FT = 4.0;
const FALL_SINK_MINSLOPE = 0.5;
const FALL_MAX_WIDTH = 1024.0;
const FALL_MIN_SEGMENT = 2.0;
const SPACINGS = [2, 3, 4, 6, 8] as const;
const NOTCH_MAXCOLS = FALL_MAX_COLS;

/** A waterfall (the Waterfall struct). The .WFL id is index + 1. */
export interface TraxxFall {
  /** Lake index + 1, 0 = a spring. */
  source: number;
  /** 2..8. */
  npoints: number;
  /** FALLFLAG_*. */
  flags: number;
  /** 1/16 ft/s (default 96). */
  speed: number;
  /** Raw water units; used only when source is 0. */
  height: number;
  /** Always 8 pairs (x, z) in 1/16 ft, 0..131071; the first npoints are the crest. */
  pt: [number, number][];
  /** % (defaults 85, 100, 100). */
  opacity: number;
  mist: number;
  volume: number;
  /** % 1..250, default 100 (.WFL record v1.1). */
  mistdepth: number;
  mistheight: number;
  /** Rough-water start speed: 0 = the engine default (25 ft/s), 1..250 ft/s, 255 = off (.WFL v1.1 byte 130). */
  roughfrom: number;
  /** Stems, at most 15 characters. */
  sound: string;
  texture: string;
}

/** The lakes a fall reads: the authored list (heights) and the derived tile map. */
export interface FallLakes {
  lakes: readonly { height: number }[];
  tmap: Uint8Array | null;
  /** The track's world (track format version 6); absent: FALL_WORLD_CLASSIC, or N from the tile map. */
  world?: FallWorld;
  /** The lakes' rule (LAKE_RULE_*, Traxx 1.7.3): the notch codes' meaning; absent: the default (EDGE). */
  rule?: number;
}

/* The lakes run the EDGE rule (CTrackPODLakes::rule == LAKE_RULE_EDGE). */
function edgeRule(l: FallLakes): boolean {
  return (l.rule ?? lakeDefaultRule()) === LAKE_RULE_EDGE;
}

/** N of the world a fall's lakes are in: the world's, else the tile map's side, else 256. */
export function fallLakesCells(l: FallLakes): number {
  return l.world?.cells ?? (l.tmap ? mapCells(l.tmap) : 256);
}

/**
  The crest heights (raw water units) a world's .WFL holds (spec 9.3: the world's size picks the
  version). A 256-cell world, any track (.SIT, .SI2, or a .SI3 of 256 cells): version 1, Traxx's
  1..4096; a crest above 2,048 ft is an error there, never a reason for version 2. A 512-cell
  world: version 2, the terrain's range (fallHeightRange with the track's step and base; one
  without them reads 128 and 0).
*/
export function fallHeightBounds(w: FallWorld | undefined): { min: number; max: number } {
  if (w?.maxHeight !== undefined) return { min: 1, max: w.maxHeight };
  if (!w || w.cells === 256) return fallHeightRange(1);
  return fallHeightRange(2, w.terrain ?? { step: 128, base: 0 });
}

/** The crest height range fall errors are judged against: fallHeightBounds of the lakes' world. */
export function fallHeightLimits(_falls: readonly TraxxFall[], lakes: FallLakes): { min: number; max: number } {
  return fallHeightBounds(lakes.world ?? (lakes.tmap && mapCells(lakes.tmap) !== 256 ? { cells: mapCells(lakes.tmap), terrain: null } : undefined));
}

/** The name check Errors and BuildWFL take: kind 0 a sound stem, 1 a texture stem; null = names are not checked. */
export type FallNameCheck = ((kind: number, stem: string) => boolean) | null;

/**
  The world a fall's shape is computed in (FallGround): heights in feet at world feet x / z in
  [0, 8192) ([0, W) in an N world), and the water surface the column could land in, excluding `source` (null = none).
*/
export interface FallGround {
  height: (x: number, z: number) => number;
  water: ((x: number, z: number, source: number) => number | null) | null;
  /** N of the world the callbacks wrap in (x / z in [0, W)); absent: 256. */
  cells?: number;
}

/**
  One column of the sheet: n rows of x, y, z feet (unwrapped from crest point 0). A column that
  ends on ground has its final run-out trimmed (cursh2 4778a2d): n is the trimmed row count (the
  mesh's and the preview's), pathlen stays the whole path.
*/
export interface FallColumn {
  n: number;
  p: Float32Array;
  end: number;
  pathlen: number;
  /** n * 3, the preview's FRONT face (the slab, handover 4.6): p pushed out by the thickness; null on a hand-built column. */
  front?: Float32Array | null;
  /**
    The DRY landing row (cursh2 landPick: a fall's touchdown, a slide's run-out start), valid when
    1 <= land < n; anything else (0 on a hand-built column, -1) = the last row.
  */
  land?: number;
  /** FLOW TUBES (Traxx 1.8.0, handover 4.7): the column merged into a neighbour at the 2 ft grid; it is no landing candidate. */
  merged?: boolean;
  /** RIBBONS: the ribbon width W (ft) when the landing row is a lone row, else 0 (a one-column landing is W wide). */
  ribw?: number;
}

/**
  What Budget needs of a fall at a spacing: each column's row count (the sink row included) and
  end kind (ncols 0 = no sheet). The slab's back face needs each mesh row's PRESENCE air flag: column
  c's row r is air[off[c] + r]; mark is scratch of the same size. All three absent on a hand-built
  stat (no back face then).
*/
export interface FallStat {
  ncols: number;
  rows: Int32Array;
  endk: Uint8Array;
  off?: Int32Array | null;
  air?: Uint8Array | null;
  mark?: Uint8Array | null;
  /**
    FLOW TUBES (Traxx 1.8.0): the written grid's PATH POINTS at this spacing, column c's row r at
    pt[3 * (off[c] + r)] in feet (unwrapped), the path rows then a water column's sink point (the
    layout of air). Absent on a hand-built stat: nothing merges, splits or ribbons.
  */
  pt?: Float64Array | null;
}

export interface FallShape {
  ncols: number;
  col: FallColumn[];
  width: number;
  /** 2 ft, nothing cut, set by BuildShape; Budget sets what the engine uses. Sheet + foam + back face. */
  vertices: number;
  /** Of those, the slab's back-face vertices (Budget sets it with vertices). */
  back: number;
  /** Traxx 1.8.0: the written triangles (Budget sets it with vertices; indices = 3 * tris), flow tubes and ribbons included. */
  tris?: number;
  /** Of the vertices, the ribbon vertices (2 per lone row). */
  ribbon?: number;
  /** Flow tubes: columns merged into a neighbour; triangles dropped for a torn vertex (split v3). */
  merges?: number;
  splitTris?: number;
  /** BuildShape's ground, kept for Budget's flow tubes (the split's ridge test); null on a hand-built shape = flat ground. */
  ground?: FallGround | null;
  spacing: number;
  warn: number;
  /** Set by the caller for a fall with errors: Budget gives it no room and no shape warnings. */
  nobudget: boolean;
  stat: FallStat[];
}

/** The numbers behind the notch warnings. */
export interface FallNotchWarn {
  h: number;
  climb: number;
  hint4: boolean;
  flatdeg: number;
  /** The lakes run the EDGE rule: the text is worded for the notch edge. */
  edge: boolean;
}

const emptyStat = (): FallStat => ({ ncols: 0, rows: new Int32Array(0), endk: new Uint8Array(0) });
export function emptyFallShape(): FallShape {
  return { ncols: 0, col: [], width: 0, vertices: 0, back: 0, spacing: 2, warn: 0, nobudget: false, stat: Array.from({ length: FALL_NSPACINGS }, emptyStat) };
}

// ---- The list ----

/** Defaults: speed 96, opacity 85, mist 100, volume 100, mist depth / height 100, FREEZE | SPLASH | SOUND, height 0. */
export function fallDefaults(): TraxxFall {
  return {
    source: 0, npoints: 0, flags: FALLFLAG_FREEZE | FALLFLAG_SPLASH | FALLFLAG_SOUND, speed: 96, height: 0,
    pt: Array.from({ length: FALL_MAX_POINTS }, () => [0, 0] as [number, number]),
    opacity: 85, mist: 100, volume: 100, mistdepth: 100, mistheight: 100, roughfrom: 0, sound: "", texture: "",
  };
}

export function cloneFall(w: TraxxFall): TraxxFall {
  return { ...w, pt: w.pt.map((p) => [p[0], p[1]] as [number, number]) };
}

/** Add: the new index, or -1 when the list is full. */
export function fallAdd(falls: TraxxFall[], w: TraxxFall): number {
  if (falls.length >= FALL_MAX_FALLS) return -1;
  falls.push(w);
  return falls.length - 1;
}

/** LakeDeleted: the falls on lake `lakeindex` become springs at its height; sources above it shift down one. */
export function fallsLakeDeleted(falls: TraxxFall[], lakeindex: number, lakeheight: number): void {
  for (let i = 0; i < falls.length && i < FALL_MAX_FALLS; i++) {
    const f = falls[i]!;
    if (f.source === lakeindex + 1) { f.source = 0; f.height = lakeheight; }
    else if (f.source > lakeindex + 1) f.source--;
  }
}

/** FallsOnLake. */
export function fallsOnLake(falls: readonly TraxxFall[], lakeindex: number): number {
  let n = 0;
  for (let i = 0; i < falls.length && i < FALL_MAX_FALLS; i++) if (falls[i]!.source === lakeindex + 1) n++;
  return n;
}

/** EffectiveHeight: a spring's own height, a sourced fall's lake's; 0 when the source names no lake. */
export function fallEffectiveHeight(falls: readonly TraxxFall[], i: number, lakes: readonly { height: number }[]): number {
  if (i < 0 || i >= falls.length || i >= FALL_MAX_FALLS) return 0;
  const f = falls[i]!;
  if (f.source === 0) return f.height;
  if (f.source > lakes.length || f.source > 255) return 0;
  return lakes[f.source - 1]!.height;
}

// ---- The crest ----

/* Red: into 0..U - 1 (0..131071 at N = 256). */
function red(v: number, U = 131072): number {
  v %= U;
  if (v < 0) v += U;
  return v;
}

/** WrapDiff: the shortest wrapped difference b - a, in 1/16 ft (-8 W..8 W - 1; -65536..65535 at N = 256). */
export function wrapDiff(b: number, a: number, cells = 256): number {
  const U = wd(cells).U, H = U / 2;
  return red(red(b, U) - red(a, U) + H, U) - H;
}

/* WrapFt: into [0, W) (8192 ft at N = 256). */
function wrapFt(v: number, W = FALL_WORLD_FT): number {
  v %= W;
  if (v < 0) v += W;
  if (v >= W) v = 0;
  return v;
}

/* The crest unwrapped from point 0 (handover 4.1). */
interface Crest {
  n: number;
  P: [number, number][];
  dx: number[];
  dz: number[];
  len: number[];
  dir: [number, number][];
  cum: number[];
  L: number;
}

function buildCrest(w: TraxxFall, cells = 256): Crest {
  const U = wd(cells).U;
  const c: Crest = {
    n: 0, P: Array.from({ length: FALL_MAX_POINTS }, () => [0, 0] as [number, number]), dx: new Array(FALL_MAX_POINTS).fill(0),
    dz: new Array(FALL_MAX_POINTS).fill(0), len: new Array(FALL_MAX_POINTS).fill(0),
    dir: Array.from({ length: FALL_MAX_POINTS }, () => [0, 0] as [number, number]), cum: new Array(FALL_MAX_POINTS).fill(0), L: 0,
  };
  let n = w.npoints;
  if (n > FALL_MAX_POINTS) n = FALL_MAX_POINTS;
  if (n < 2) return c;
  c.n = n;
  c.P[0] = [red(w.pt[0]![0], U) / 16.0, red(w.pt[0]![1], U) / 16.0];
  for (let k = 0; k + 1 < n; k++) {
    c.dx[k] = wrapDiff(w.pt[k + 1]![0], w.pt[k]![0], cells);
    c.dz[k] = wrapDiff(w.pt[k + 1]![1], w.pt[k]![1], cells);
    c.P[k + 1] = [c.P[k]![0] + c.dx[k]! / 16.0, c.P[k]![1] + c.dz[k]! / 16.0];
    const l = Math.sqrt(c.dx[k]! * c.dx[k]! + c.dz[k]! * c.dz[k]!);
    c.len[k] = l / 16.0;
    if (l > 0) c.dir[k] = [c.dz[k]! / l, -c.dx[k]! / l]; // dir = normalize(dz, -dx)
    c.cum[k + 1] = c.cum[k]! + c.len[k]!;
  }
  c.L = c.cum[n - 1]!;
  return c;
}

/* CrestPointDirs (4.1): an end point takes its segment's direction, an inner point normalize(dirIn + dirOut). */
function crestPointDirs(c: Crest): [number, number][] {
  const pd = Array.from({ length: FALL_MAX_POINTS }, () => [1, 0] as [number, number]);
  for (let k = 0; k < c.n; k++) {
    const inn = k > 0 ? c.dir[k - 1]! : null;
    const out = k < c.n - 1 ? c.dir[k]! : null;
    let x = 0, z = 0, l: number;
    if (inn && out) {
      x = inn[0] + out[0]; z = inn[1] + out[1];
      l = Math.sqrt(x * x + z * z);
      if (l < 1e-9) { x = out[0]; z = out[1]; }
    } else if (out) { x = out[0]; z = out[1]; }
    else if (inn) { x = inn[0]; z = inn[1]; }
    l = Math.sqrt(x * x + z * z);
    if (l > 1e-9) pd[k] = [x / l, z / l];
  }
  return pd;
}

/** ColumnCount (make_cols): ceil(L / sp - 1e-9) + 1 columns; 0 for more than FALL_MAX_COLS. */
export function columnCount(L: number, sp: number): number {
  let n = Math.ceil(L / sp - 1e-9);
  if (n < 1) n = 1;
  return n + 1 > FALL_MAX_COLS ? 0 : n + 1;
}

/* CrestAt (Crest.at): the position and the unit direction at arc length s. */
function crestAt(c: Crest, pd: [number, number][], s: number): { x: number; z: number; dx: number; dz: number } {
  let i = 0, t = 0;
  while (i < c.n - 2 && s > c.cum[i + 1]!) i++;
  const l = c.cum[i + 1]! - c.cum[i]!;
  if (l > 1e-12) t = (s - c.cum[i]!) / l;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const x = c.P[i]![0] + (c.P[i + 1]![0] - c.P[i]![0]) * t;
  const z = c.P[i]![1] + (c.P[i + 1]![1] - c.P[i]![1]) * t;
  let ddx = pd[i]![0] + (pd[i + 1]![0] - pd[i]![0]) * t;
  let ddz = pd[i]![1] + (pd[i + 1]![1] - pd[i]![1]) * t;
  const dl = Math.sqrt(ddx * ddx + ddz * ddz);
  if (dl < 1e-12) { ddx = pd[i]![0]; ddz = pd[i]![1]; }
  else { ddx /= dl; ddz /= dl; }
  return { x, z, dx: ddx, dz: ddz };
}

/** CrestLength: the crest's length, wrapped, in feet. */
export function crestLength(w: TraxxFall, cells = 256): number {
  return Math.fround(buildCrest(w, cells).L);
}

/** PointDirection (4.1): the unit (x, z) flow direction at crest point k. */
export function pointDirection(w: TraxxFall, k: number, cells = 256): [number, number] {
  const pd = crestPointDirs(buildCrest(w, cells));
  if (k < 0) k = 0;
  if (k >= FALL_MAX_POINTS) k = FALL_MAX_POINTS - 1;
  return [Math.fround(pd[k]![0]), Math.fround(pd[k]![1])];
}

/*
  THE NOTCH'S DIRECTION (ruling 11-11; wtr_check notch_cols): the notch rules and FALL_DIRECTION
  use the crest SEGMENT's direction; at an inner point the outgoing one, at the end the last.
*/
function segmentDirAtPoint(c: Crest, k: number, d: [number, number]): void {
  const j = k < c.n - 1 ? k : c.n - 2;
  if (j >= 0 && (c.dir[j]![0] !== 0 || c.dir[j]![1] !== 0)) { d[0] = c.dir[j]![0]; d[1] = c.dir[j]![1]; }
}

function segmentDirAt(c: Crest, s: number, d: [number, number]): void {
  let j = 0;
  while (j < c.n - 2 && s >= c.cum[j + 1]! - 1e-9) j++;
  segmentDirAtPoint(c, j, d);
}

/** FallNudgeDistance: how far a probe point is moved along a segment of length l, min(0.5, 0.5 l) (wtr_check _nudged). */
export function fallNudgeDistance(l: number): number {
  return l < 1.0 ? 0.5 * l : 0.5;
}

/* NudgeInto: crest point k moved into segment k (forward) or k - 1 (backward), never past the middle of a short one. */
function nudgeInto(c: Crest, k: number, forward: boolean): [number, number] {
  const j = forward ? k : k - 1;
  let px = c.P[k]![0], pz = c.P[k]![1];
  if (j < 0 || j >= c.n - 1) return [px, pz];
  const ex = c.P[j + 1]![0] - c.P[j]![0], ez = c.P[j + 1]![1] - c.P[j]![1];
  const l = Math.sqrt(ex * ex + ez * ez);
  if (l < 1e-12) return [px, pz];
  const d = fallNudgeDistance(l);
  px += ((forward ? d : -d) * ex) / l;
  pz += ((forward ? d : -d) * ez) / l;
  return [px, pz];
}

/* NotchProbeBase: (x, z), or the nudged crest point when the sample lies exactly on one. */
function notchProbeBase(c: Crest, s: number, x: number, z: number): [number, number] {
  let j = 0;
  while (j < c.n - 2 && s >= c.cum[j + 1]! - 1e-9) j++;
  if (Math.abs(s - c.cum[j]!) < 1e-6) return nudgeInto(c, j, true);
  if (Math.abs(s - c.cum[j + 1]!) < 1e-6) return nudgeInto(c, j + 1, false);
  return [x, z];
}

// ---- Spillway notches (water-bodies handover 4.1a; wtr_check fall_notch, notch_warnings) ----

interface NotchCol {
  /** Notch tile and lake tile, tx + (tz << 8) (tx + tz * N in an N world), wrapped. */
  n: number;
  k: number;
  /** A diagonal pair's shared vertex (LAKE_LIP_NW..), else 0. */
  corner: number;
  /** The LAKE_LIP_* edge of the notch tile facing the lake tile; 0 when not 4-adjacent. */
  lip: number;
  edge: boolean;
  axis: number;
  line: number;
  tile: number;
  along: number;
}

/* NotchCols: the 2 ft columns of fall w that make a notch; none for a spring or an unusable crest. */
function notchCols(w: TraxxFall, cells = 256): NotchCol[] {
  const n = w.npoints;
  if (w.source === 0 || n < 2 || n > FALL_MAX_POINTS) return [];
  const { N, M, SH } = wd(cells), cmax = fallCoordMax(cells);
  for (let k = 0; k < n; k++) {
    if (w.pt[k]![0] < 0 || w.pt[k]![0] > cmax || w.pt[k]![1] < 0 || w.pt[k]![1] > cmax) return [];
  }
  const c = buildCrest(w, cells);
  if (c.n < 2 || c.L < 1e-6) return [];
  const pd = crestPointDirs(c);
  const nc = columnCount(c.L, 2.0);
  if (nc === 0) return [];
  const out: NotchCol[] = [];
  for (let k = 0; k < nc; k++) {
    const s = k < nc - 1 ? k * 2.0 : c.L;
    const at = crestAt(c, pd, s);
    const d: [number, number] = [at.dx, at.dz];
    segmentDirAt(c, s, d);
    const [bx, bz] = notchProbeBase(c, s, at.x, at.z);
    const nxu = Math.floor((bx + d[0]) / 32.0), nzu = Math.floor((bz + d[1]) / 32.0);
    const kxu = Math.floor((bx - d[0]) / 32.0), kzu = Math.floor((bz - d[1]) / 32.0);
    const q: NotchCol = { n: (nxu & M) + ((nzu & M) << SH), k: (kxu & M) + ((kzu & M) << SH), corner: 0, lip: 0, edge: false, axis: 0, line: 0, tile: 0, along: 0 };
    // 4-adjacent on the wrapping map?  Which edge of the notch tile faces the lake tile?
    const ddx = ((nxu - kxu + N / 2) & M) - N / 2, ddz = ((nzu - kzu + N / 2) & M) - N / 2;
    if (ddx === 1 && ddz === 0) q.lip = LAKE_LIP_W;
    else if (ddx === -1 && ddz === 0) q.lip = LAKE_LIP_E;
    else if (ddx === 0 && ddz === 1) q.lip = LAKE_LIP_N;
    else if (ddx === 0 && ddz === -1) q.lip = LAKE_LIP_S;
    else if (ddx === 1 && ddz === 1) q.corner = LAKE_LIP_NW;
    else if (ddx === -1 && ddz === 1) q.corner = LAKE_LIP_NE;
    else if (ddx === 1 && ddz === -1) q.corner = LAKE_LIP_SW;
    else if (ddx === -1 && ddz === -1) q.corner = LAKE_LIP_SE;
    // the reference's edge key, in the unwrapped coordinates of the crest
    if (Math.abs(nxu - kxu) + Math.abs(nzu - kzu) === 1) {
      q.edge = true;
      if (nxu !== kxu) { q.axis = 0; q.line = Math.max(nxu, kxu); q.tile = nzu; q.along = at.z; }
      else { q.axis = 1; q.line = Math.max(nzu, kzu); q.tile = nxu; q.along = at.x; }
    }
    out.push(q);
  }
  return out;
}

/**
  BuildNotches: the notch map of all the falls (SetNotches' input). notchlake[tile] = the source
  lake id of the notch tile, lipedges[tile] its LAKE_LIP_* edges bordering the lake tile behind the
  crest; a tile two falls claim keeps the first. notchfall: the first fall to claim it, index + 1.
*/
export function buildNotches(falls: readonly TraxxFall[], cells = 256): { notchlake: Uint8Array; lipedges: Uint8Array; notchfall: Uint8Array; tiles: number } {
  const T = cells * cells;
  const notchlake = new Uint8Array(T), lipedges = new Uint8Array(T), notchfall = new Uint8Array(T);
  let tiles = 0;
  for (let i = 0; i < falls.length && i < FALL_MAX_FALLS; i++) {
    const f = falls[i]!;
    for (const q of notchCols(f, cells)) {
      if (notchlake[q.n] === 0) { notchlake[q.n] = f.source & 255; tiles++; notchfall[q.n] = i + 1; }
      if (notchlake[q.n] === (f.source & 255)) lipedges[q.n] |= q.lip | q.corner;
    }
  }
  return { notchlake, lipedges, notchfall, tiles };
}

/*
  THE EDGE RULE'S NOTCHES (waterfalls handover 4.5a; wtr_check fall_notch_edge / notches_by_body_edge).
  A column's notch EDGE is the edge between tile A (NotchCol.k, the lake tile at p - 1 ft * f) and
  tile D (NotchCol.n, p + 1 ft * f) when they are 4-adjacent (NotchCol.lip is then the bit of D's
  side that faces A). An edge has one identity whichever side names it: NotchEdgeId = 2 * (the tile
  whose E / S side it is) + (0 = E, 1 = S), the tile index in the N x N map.
*/
function notchEdgeId(c: NotchCol): number {
  switch (c.lip) {
    case LAKE_LIP_W: return 2 * c.k; // A is west of D: A's E side
    case LAKE_LIP_E: return 2 * c.n; // A is east of D: D's E side
    case LAKE_LIP_N: return 2 * c.k + 1; // A is north of D: A's S side
    case LAKE_LIP_S: return 2 * c.n + 1; // A is south of D: D's S side
  }
  return -1; // not 4-adjacent (a diagonal pair, or the same tile)
}

function notchLipToDir(lip: number): number {
  return lip === LAKE_LIP_N ? LAKE_DIR_N : lip === LAKE_LIP_E ? LAKE_DIR_E : lip === LAKE_LIP_S ? LAKE_DIR_S : LAKE_DIR_W;
}

/**
  BuildNotchEdges: the EDGE rule's notches (the input of the lakes' SetNotchEdges): for every crest
  column of a lake-fed fall the edge between its tiles A and D when 4-adjacent, each (lake, edge)
  once, named from D's side. With `tmap` an edge counts only when tile A belongs to the fall's
  source lake (wtr_check's TMAP filter); null = every adjacent pair (what the app feeds the fill
  with, since the tile map is the fill's own result). At most `max` records.
*/
export function buildNotchEdges(falls: readonly TraxxFall[], cells = 256, tmap: Uint8Array | null = null,
  max = FALL_MAX_FALLS * FALL_MAX_COLS): LakeNotchEdge[] {
  const { M, SH } = wd(cells);
  const out: LakeNotchEdge[] = [];
  const ids: number[] = [];
  const seen = new Uint8Array((2 * cells * cells) >> 3);
  for (let i = 0; i < falls.length && i < FALL_MAX_FALLS; i++) {
    const f = falls[i]!;
    for (const c of notchCols(f, cells)) {
      const id = notchEdgeId(c);
      if (id < 0) continue;
      // the TMAP filter: tile A must belong to the source lake
      if (tmap && tmap[c.k] !== f.source) continue;
      // (lake, edge) once: the bit says some lake has it; the scan only runs for a repeat
      let dup = false;
      if (seen[id >> 3]! & (1 << (id & 7))) {
        for (let j = 0; j < out.length; j++) if (ids[j] === id && out[j]!.lake === f.source) { dup = true; break; }
      }
      if (dup || out.length >= max) continue;
      seen[id >> 3]! |= 1 << (id & 7);
      ids.push(id);
      out.push({ lake: f.source, x: c.n & M, z: c.n >> SH, dir: notchLipToDir(c.lip) });
    }
  }
  return out;
}

/**
  UpdateLakeNotches: the lakes' notch input from a track's falls, in the form the track's lake rule
  takes (trackLakeRule): EDGE the notch edges (buildNotchEdges, not filtered by the tile map, which is
  the fill's own result), TILE the notch tiles (buildNotches). Null for none under the default rule.
  Call it right before every lake recompute; a fall edit changes the lakes.
*/
export function trackNotches(t: { falls?: readonly TraxxFall[]; worldCells?: number; lakeRule?: number }): LakeNotches | null {
  const rule = trackLakeRule(t);
  if (!t.falls || !t.falls.length) return makeLakeNotches(null, null, null, rule);
  // The notch map is the track's N x N tile map (spec 9.3).
  const cells = cellsOf(t);
  if (rule === LAKE_RULE_EDGE) return makeLakeNotches(null, null, buildNotchEdges(t.falls, cells), rule);
  const { notchlake, lipedges, tiles } = buildNotches(t.falls, cells);
  return makeLakeNotches(tiles > 0 ? notchlake : null, lipedges, null, rule);
}

/*
  LipRange: the lowest and highest ground point on fall w's lip edges (HeightLevel units), or null.
  edge: the EDGE rule, whose lip is the points of the notch edges only (a diagonal pair names none).
*/
function lipRange(w: TraxxFall, lg: LakeGround, cells = 256, edge = false): { lo: number; hi: number } | null {
  const S = pointStep(lg);
  if (S === 0) return null;
  const { M, SH } = wd(cells);
  let lo = 0, hi = 0, any = false;
  const see = (u: number) => { if (!any || u < lo) lo = u; if (!any || u > hi) hi = u; any = true; };
  for (const q of notchCols(w, cells)) {
    const tx = q.n & M, tz = q.n >> SH;
    if (q.lip === 0) {
      // a diagonal pair: its one shared vertex is the lip (wtr_check, TILE rule; the edge rule has no such lip)
      if (q.corner !== 0 && !edge) {
        const cpx = S * tx + (q.corner === LAKE_LIP_NE || q.corner === LAKE_LIP_SE ? S : 0);
        const cpz = S * tz + (q.corner === LAKE_LIP_SE || q.corner === LAKE_LIP_SW ? S : 0);
        see(pointLevel(lg, cpx, cpz));
      }
      continue;
    }
    for (let i = 0; i <= S; i++) {
      let px: number, pz: number;
      switch (q.lip) {
        case LAKE_LIP_N: px = S * tx + i; pz = S * tz; break;
        case LAKE_LIP_E: px = S * tx + S; pz = S * tz + i; break;
        case LAKE_LIP_S: px = S * tx + i; pz = S * tz + S; break;
        default: px = S * tx; pz = S * tz + i; break;
      }
      see(pointLevel(lg, px, pz));
    }
  }
  return any ? { lo, hi } : null;
}

/*
  NotchErrors: FALL_NOTCH and FALL_NOTCH_SHARED of fall i. TILE: a notch tile in any lake, or not
  next to the lake tile behind the crest; another fall cutting the same notch TILE. EDGE (4.5a): D,
  the tile beyond the notch edge, in any lake (its own too: the tile map keeps every lake tile), or
  A and D not 4-adjacent; another fall (of any lake) cutting the same notch EDGE.
*/
function notchErrors(falls: readonly TraxxFall[], i: number, tmap: Uint8Array | null, cells = 256, edge = false): number {
  const col = notchCols(falls[i]!, cells);
  if (!col.length) return 0;
  let e = 0;
  for (const q of col) if (q.lip === 0 || (tmap && tmap[q.n] !== 0)) e |= FALLERR_NOTCH;
  const mine = new Uint8Array(edge ? 2 * cells * cells : cells * cells);
  const idOf = (q: NotchCol) => (edge ? notchEdgeId(q) : q.n);
  for (const q of col) { const id = idOf(q); if (id >= 0) mine[id] = 1; }
  for (let j = 0; j < falls.length && j < FALL_MAX_FALLS && !(e & FALLERR_NOTCH_SHARED); j++) {
    if (j === i) continue;
    for (const q of notchCols(falls[j]!, cells)) { const id = idOf(q); if (id >= 0 && mine[id]) { e |= FALLERR_NOTCH_SHARED; break; } }
  }
  return e;
}

/* LipLowError: a ground point on a lip edge below the lake's height. */
function lipLowError(falls: readonly TraxxFall[], i: number, lakes: FallLakes, lg: LakeGround): number {
  const h = fallEffectiveHeight(falls, i, lakes.lakes);
  if (h < 1) return 0;
  const r = lipRange(falls[i]!, lg, fallLakesCells(lakes), edgeRule(lakes));
  if (!r) return 0;
  return r.lo < heightLevel(lg, h) ? FALLERR_LIP_LOW : 0;
}

/**
  NotchWarnings: LIP_HIGH (lg), NOTCH_FLAT (fg), LIP_UNCOVERED of fall i; 0 when it has any error
  (names judged with the same check as Errors).
*/
export function fallNotchWarnings(falls: readonly TraxxFall[], i: number, lakes: FallLakes, lg: LakeGround | null, fg: FallGround | null,
  namecheck: FallNameCheck = null): { warn: number; info: FallNotchWarn } {
  const info: FallNotchWarn = { h: 0, climb: 0, hint4: false, flatdeg: 0, edge: edgeRule(lakes) };
  if (i < 0 || i >= falls.length || i >= FALL_MAX_FALLS || falls[i]!.source === 0) return { warn: 0, info };
  if (fallErrors(falls, i, lakes, namecheck, lg) !== 0) return { warn: 0, info };
  const w = falls[i]!;
  const h = fallEffectiveHeight(falls, i, lakes.lakes);
  info.h = h;
  const cells = fallLakesCells(lakes), W = fallWorldFt(cells);
  const col = notchCols(w, cells);
  if (!col.length) return { warn: 0, info };
  let warn = 0;
  if (lg) {
    const r = lipRange(w, lg, cells, info.edge);
    if (r && r.hi > heightLevel(lg, h)) {
      warn |= FALLWARN_LIP_HIGH;
      info.climb = (r.hi - heightLevel(lg, h)) / levelUnit(lg);
      info.hint4 = Boolean(lg.raw) && h % 4 !== 0;
    }
  }
  if (fg) {
    const c = buildCrest(w, cells);
    const pd = crestPointDirs(c);
    for (let k = 0; k < col.length; k++) {
      const s = k < col.length - 1 ? k * 2.0 : c.L;
      const at = crestAt(c, pd, s);
      const d: [number, number] = [at.dx, at.dz];
      segmentDirAt(c, s, d); // the notch's direction, as the reference's notch_cols
      const h1 = fg.height(wrapFt(at.x + d[0], W), wrapFt(at.z + d[1], W));
      const h3 = fg.height(wrapFt(at.x + 3.0 * d[0], W), wrapFt(at.z + 3.0 * d[1], W));
      const ang = (Math.atan2(h1 - h3, 2.0) * 180.0) / 3.14159265358979323846;
      if (ang < 5.0) { warn |= FALLWARN_NOTCH_FLAT; info.flatdeg = ang; break; }
    }
  }
  // Lip edges spanned end to end?  Group the columns by edge (axis, line, tile).
  const grp: { axis: number; line: number; tile: number; mn: number; mx: number }[] = [];
  for (const q of col) {
    if (!q.edge || q.lip === 0) continue;
    const g = grp.find((x) => x.axis === q.axis && x.line === q.line && x.tile === q.tile);
    if (!g) { if (grp.length < 256) grp.push({ axis: q.axis, line: q.line, tile: q.tile, mn: q.along, mx: q.along }); }
    else { if (q.along < g.mn) g.mn = q.along; if (q.along > g.mx) g.mx = q.along; }
  }
  for (const g of grp) {
    const lo = 32.0 * g.tile;
    if (g.mn > lo + 2.0 || g.mx < lo + 32.0 - 2.0) { warn |= FALLWARN_LIP_UNCOVERED; break; }
  }
  return { warn, info };
}

/** NotchWarnText: the warning's text with the numbers of info (worded for the notch edge under the EDGE rule). */
export function fallNotchWarnText(bit: number, info: FallNotchWarn): string {
  const edge = Boolean(info.edge);
  if (bit === FALLWARN_LIP_HIGH && info.climb > 0) {
    let t = `A lip ${edge ? "point" : "corner"} is above the lake's height: the water climbs ${cG(info.climb)} water units (${cG(info.climb / 2.0)} ft) over the lip`;
    if (info.hint4) {
      t += edge
        ? "; the height is not a multiple of 4, so no lip point can sit exactly at it - set it to a multiple of 4"
        : "; the height is not a multiple of 4, so no corner can sit exactly at it - set it to a multiple of 4";
    }
    return t;
  }
  if (bit === FALLWARN_NOTCH_FLAT && info.flatdeg !== 0) {
    if (edge) return `The slope of the ground beyond the notch edge along the flow is only ${info.flatdeg.toFixed(1)} degrees (under 5): the water may come to rest on it - lower the far side by at least two steps`;
    return `The notch tile slopes only ${info.flatdeg.toFixed(1)} degrees along the flow (under 5): the water may come to rest on it - lower the far side by at least two steps`;
  }
  return fallWarnText(bit, edge);
}

// ---- SnapToLip (waterfalls handover 4.5) ----

interface LipEdge { tx: number; tz: number; d: number; ax: number; az: number; bx: number; bz: number; nx: number; nz: number }

/* SnapEdgeLow: edge d of tile (tx, tz) has a ground point below lipmin. */
function snapEdgeLow(lg: LakeGround, S: number, lipmin: number, tx: number, tz: number, d: number): boolean {
  for (let p = 0; p <= S; p++) {
    let gx: number, gz: number;
    switch (d) {
      case 0: gx = S * tx + p; gz = S * tz; break;
      case 1: gx = S * tx + S; gz = S * tz + p; break;
      case 2: gx = S * tx + p; gz = S * tz + S; break;
      default: gx = S * tx; gz = S * tz + p; break;
    }
    if (pointLevel(lg, gx, gz) < lipmin) return true;
  }
  return false;
}

function snapLakeSide(tmap: Uint8Array, source: number, carved: Uint8Array, tx: number, tz: number, d: Wd = WD_CLASSIC): boolean {
  const t = (tx & d.M) + ((tz & d.M) << d.SH);
  return tmap[t] === source || carved[t] !== 0;
}

/* SnapEdgePoint: edge e's candidate point for (px, pz), 1 ft in from the ends; inspan = the projection lies on the edge. */
function snapEdgePoint(e: LipEdge, px: number, pz: number): { qx: number; qz: number; inspan: boolean; dist: number } {
  let qx: number, qz: number, inspan: boolean;
  if (e.d === 0 || e.d === 2) {
    const lo = e.ax < e.bx ? e.ax : e.bx, hi = e.ax < e.bx ? e.bx : e.ax;
    inspan = px >= lo && px <= hi;
    qz = e.az; qx = px;
    if (qx < lo + 1.0) qx = lo + 1.0;
    if (qx > hi - 1.0) qx = hi - 1.0;
  } else {
    const lo = e.az < e.bz ? e.az : e.bz, hi = e.az < e.bz ? e.bz : e.az;
    inspan = pz >= lo && pz <= hi;
    qx = e.ax; qz = pz;
    if (qz < lo + 1.0) qz = lo + 1.0;
    if (qz > hi - 1.0) qz = hi - 1.0;
  }
  const ex = qx - px, ez = qz - pz;
  return { qx, qz, inspan, dist: Math.sqrt(ex * ex + ez * ez) };
}

/* SnapPickEdge: the best edge by the tiers (in span and agreeing, agreeing, any); -1 when none within maxft. */
function snapPickEdge(edge: LipEdge[], px: number, pz: number, fx: number, fz: number, maxft: number): { best: number; qx: number; qz: number } {
  let best = -1, tier = 3, bestd = 0, bestdot = 0, qx = 0, qz = 0;
  for (let k = 0; k < edge.length; k++) {
    const dot = edge[k]!.nx * fx + edge[k]!.nz * fz;
    const r = snapEdgePoint(edge[k]!, px, pz);
    if (r.dist > maxft) continue;
    const t = dot > 0.5 ? (r.inspan ? 1 : 2) : 3;
    if (t < tier || (t === tier && (r.dist < bestd - 1e-9 || (r.dist < bestd + 1e-9 && dot > bestdot + 1e-9)))) {
      tier = t; best = k; bestd = r.dist; bestdot = dot; qx = r.qx; qz = r.qz;
    }
  }
  return { best, qx, qz };
}

/**
  SnapToLip: move each crest point of lake-fed fall i onto the nearest lip edge of its lake within
  maxft (an edge between a source-lake tile and a tile in no lake; with lg, none with a ground
  point below the lake). A sharp turn round a lake corner goes to the corner's vertex. Returns
  how many points moved.
*/
export function snapToLip(falls: TraxxFall[], i: number, lakes: FallLakes, maxft: number, lg: LakeGround | null = null): number {
  if (i < 0 || i >= falls.length) return 0;
  const w = falls[i]!;
  const nlakes = Math.min(lakes.lakes.length, 255);
  const tmap = lakes.tmap;
  if (w.source === 0 || w.source > nlakes || !tmap) return 0;
  if (w.npoints < 2 || w.npoints > FALL_MAX_POINTS) return 0;
  const cells = fallLakesCells(lakes), D = wd(cells), { M, SH, W, U } = D;
  const c = buildCrest(w, cells);
  if (c.n < 2) return 0;
  const pd = crestPointDirs(c);
  let S = 0, lipmin = 0, checkground = false;
  if (lg && pointStep(lg) > 0) {
    S = pointStep(lg);
    lipmin = heightLevel(lg, lakes.lakes[w.source - 1]!.height);
    checkground = true;
  }
  // This fall's own CARVED notch tiles (n == k with a lake-side edge under water); none without the ground.
  // (EDGE rule: no tile is carved - the tile map keeps every lake tile, a notch is an edge.)
  const carved = new Uint8Array(cells * cells);
  if (checkground && !edgeRule(lakes)) {
    for (const q of notchCols(w, cells)) {
      const tx = q.n & M, tz = q.n >> SH;
      if (q.n !== q.k) continue;
      for (let d = 0; d < 4; d++) {
        const ux = tx + (d === 1 ? 1 : d === 3 ? -1 : 0), uz = tz + (d === 2 ? 1 : d === 0 ? -1 : 0);
        if (tmap[(ux & M) + ((uz & M) << SH)] === w.source && snapEdgeLow(lg!, S, lipmin, tx, tz, d)) carved[q.n] = 1;
      }
    }
  }
  const r = Math.ceil(maxft / 32.0) + 1;
  const orig = cloneFall(w); // every point is judged against the crest as it was clicked
  let moved = 0;
  for (let k = 0; k < orig.npoints; k++) {
    const px = (orig.pt[k]![0] & (U - 1)) / 16.0, pz = (orig.pt[k]![1] & (U - 1)) / 16.0;
    const tx0 = Math.floor(px / 32.0), tz0 = Math.floor(pz / 32.0);
    let qx = 0, qz = 0, placed = false;
    // the edges round the point
    const edge: LipEdge[] = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = tx0 + dx, tz = tz0 + dz; // unwrapped; the tile map wraps at 256 (N)
        if (!snapLakeSide(tmap, w.source, carved, tx, tz, D)) continue;
        for (let d = 0; d < 4; d++) {
          const ux = tx + (d === 1 ? 1 : d === 3 ? -1 : 0), uz = tz + (d === 2 ? 1 : d === 0 ? -1 : 0);
          const t = (ux & M) + ((uz & M) << SH);
          if (tmap[t] !== 0 || carved[t] !== 0) continue; // the other side is a lake tile
          if (checkground && snapEdgeLow(lg!, S, lipmin, tx, tz, d)) continue; // a lip point below the lake's height: no lip
          const ax = 32.0 * (tx + (d === 1 ? 1 : 0)), az = 32.0 * (tz + (d === 2 ? 1 : 0));
          edge.push({
            tx, tz, d, ax, az, bx: d === 0 || d === 2 ? ax + 32.0 : ax, bz: d === 0 || d === 2 ? az : az + 32.0,
            nx: d === 1 ? 1.0 : d === 3 ? -1.0 : 0.0, nz: d === 2 ? 1.0 : d === 0 ? -1.0 : 0.0,
          });
        }
      }
    }
    // the flow at the point: the segment direction (outgoing; the last at the end), as FALL_DIRECTION
    const f: [number, number] = [pd[k]![0], pd[k]![1]];
    segmentDirAtPoint(c, k, f);
    // A sharp turn at an inner point: the vertex where the two segments' edges meet.
    if (k > 0 && k < c.n - 1 && c.dir[k - 1]![0] * c.dir[k]![0] + c.dir[k - 1]![1] * c.dir[k]![1] < 0.8) {
      const ea = snapPickEdge(edge, px, pz, c.dir[k - 1]![0], c.dir[k - 1]![1], maxft).best;
      const eb = snapPickEdge(edge, px, pz, c.dir[k]![0], c.dir[k]![1], maxft).best;
      if (ea >= 0 && eb >= 0 && ea !== eb) {
        let vx = 0, vz = 0, share = false;
        for (let ia = 0; ia < 2 && !share; ia++) {
          for (let ib = 0; ib < 2 && !share; ib++) {
            const x1 = ia ? edge[ea]!.bx : edge[ea]!.ax, z1 = ia ? edge[ea]!.bz : edge[ea]!.az;
            const x2 = ib ? edge[eb]!.bx : edge[eb]!.ax, z2 = ib ? edge[eb]!.bz : edge[eb]!.az;
            if (Math.abs(x1 - x2) < 1e-6 && Math.abs(z1 - z2) < 1e-6) { share = true; vx = x1; vz = z1; }
          }
        }
        if (share && Math.sqrt((vx - px) * (vx - px) + (vz - pz) * (vz - pz)) <= maxft) { placed = true; qx = vx; qz = vz; }
      }
    }
    if (!placed) {
      const pick = snapPickEdge(edge, px, pz, f[0], f[1], maxft);
      if (pick.best >= 0) { placed = true; qx = pick.qx; qz = pick.qz; }
    }
    if (placed) {
      const nx = Math.floor(wrapFt(qx, W) * 16.0 + 0.5) & (U - 1), nz = Math.floor(wrapFt(qz, W) * 16.0 + 0.5) & (U - 1);
      if (nx !== w.pt[k]![0] || nz !== w.pt[k]![1]) { w.pt[k] = [nx, nz]; moved++; }
    }
  }
  return moved;
}

// ---- The ground: the engine's integer rule (handover 4.2; wtr_check ground_raw = groundHeight1) ----

/* Fmul (engine 64BIT.H fmul): (a * b) >> 16, an arithmetic shift (floor). */
function fmul(a: number, b: number): number {
  return Math.floor((a * b) / 65536);
}

/* IMulDiv: a * b / c, truncating toward zero. */
function imulDiv(a: number, b: number, c: number): number {
  const p = a * b;
  return p >= 0 ? Math.floor(p / c) : -Math.floor(-p / c);
}

/**
  FallClassicHeightRaw: Classic terrain in feet at (xft, zft), the engine's integer rule.
  corner(tx, tz) is the engine's corner value y0 (128 * raw on Classic 8-bit, CornerV / 2 on 16-bit).
  `cells` is N: the corners wrap at N (spec 9.3), 256 as Traxx.
*/
export function fallClassicHeightRaw(corner: (tx: number, tz: number) => number, xft: number, zft: number, cells = 256): number {
  const M = cells - 1;
  const xu = Math.floor(xft * 256.0), zu = Math.floor(zft * 256.0);
  const xf = imulDiv(xu & (32 * 256 - 1), 65536, 32 * 256);
  const zf = imulDiv(zu & (32 * 256 - 1), 65536, 32 * 256);
  const x1 = Math.trunc((xu & (cells * 256 * 32 - 1)) / (32 * 256)) & M; // computeGridX
  const z1 = Math.trunc((zu & (cells * 256 * 32 - 1)) / (32 * 256)) & M;
  const x2 = (x1 + 1) & M, z2 = (z1 + 1) & M;
  const Y = (tx: number, tz: number) => corner(tx, tz) * 4;
  let r: number;
  if ((x1 & 1) === (z1 & 1)) { // same parity: diagonal c00-c11
    const y0 = Y(x1, z1);
    if (xf > zf) { const y1 = Y(x2, z1), y2 = Y(x2, z2); r = y0 + fmul(y1 - y0, xf) + fmul(y2 - y1, zf); }
    else { const y2 = Y(x2, z2), y3 = Y(x1, z2); r = y0 + fmul(y2 - y3, xf) + fmul(y3 - y0, zf); }
  } else if (0x10000 - xf > zf) { // different parity: diagonal c10-c01
    const y0 = Y(x1, z1), y1 = Y(x2, z1), y3 = Y(x1, z2);
    r = y1 + fmul(y0 - y1, 0x10000 - xf) + fmul(y3 - y0, zf);
  } else {
    const y1 = Y(x2, z1), y2 = Y(x2, z2), y3 = Y(x1, z2);
    r = y1 + fmul(y3 - y2, 0x10000 - xf) + fmul(y2 - y1, zf);
  }
  return Math.fround(r / 256.0);
}

/**
  FallGroundFor: a track's fall ground. Classic 8-bit: the integer triangles on 128 * raw; Classic
  16-bit: on CornerV / 2; Spline and Full Map: the drive surface (VegGroundHeight, at float x / z).
  Water: the lake on the tile unless it is the fall's source, else body 0 when above sea level.
  Any 8-bit edit not yet in h16 is folded first. Heights are floats, as Traxx's callbacks return.

  Track format version 6 (spec 9.3): the corners, the tiles and the tile map are the track's N x N
  (N = worldCells), x / z in [0, W). With `world.terrain` (a version 6 track) the 16-bit Classic
  corner is the 32-bit 1/128 ft store exactly, CornerV / 2 without Traxx's truncation, so the
  walk's 1/256 ft ground is the h128 store times 2; any other track keeps Traxx's integer rule.
*/
export function fallGroundFor(t: Terrain16 & { waterLevel4: number; lakes: readonly { height: number }[]; worldCells?: number }, tmap: Uint8Array | null,
  world: FallWorld | null = null): FallGround {
  const mode = t.terrainMode;
  if (mode === TERRAINMODE_CLASSIC16 || mode === TERRAINMODE_SPLINE) syncFromRaw(t);
  const raw = t.heights;
  const fine = mode === TERRAINMODE_SPLINE || mode === TERRAINMODE_FINE;
  const cells = cellsOf(t), { M, SH } = wd(cells);
  const h128 = Boolean(world?.terrain);
  const corner = (tx: number, tz: number) => {
    tx &= M; tz &= M;
    if (mode === TERRAINMODE_CLASSIC8) return 128 * raw[(tz << SH) | tx]!;
    return h128 ? cornerV(t, tx, tz) / 2 : Math.trunc(cornerV(t, tx, tz) / 2);
  };
  const water4 = t.waterLevel4;
  const nlakes = t.lakes.length;
  return {
    cells,
    height: fine ? (x, z) => surfaceFeet(t, Math.fround(x), Math.fround(z)) : (x, z) => fallClassicHeightRaw(corner, x, z, cells),
    water: (x, z, source) => {
      const tx = Math.floor(x / 32.0) & M, tz = Math.floor(z / 32.0) & M;
      if (tmap) {
        const l = tmap[tx + (tz << SH)]!;
        if (l !== 0 && l !== source && l <= nlakes) return Math.fround(t.lakes[l - 1]!.height * 0.5);
      }
      // 0 is no water; no track's water is below 0 ft, so this is Traxx's "> 0".
      if (water4 !== 0) return Math.fround(water4 * 0.5);
      return null;
    },
  };
}

/**
  FallNameInPod: kind 0 a pod sound SOUND\<stem>.WAV; kind 1 a pod texture, terrain or model (Traxx
  1.7.2: both count, as the engine reads every pod member), whose base name (no folder, no
  extension) is the stem's base name (the stem may carry an extension, EWTF000.RAW), any case.
*/
export function fallNameInPod(sounds: readonly { name: string }[], textures: readonly ({ name: string } | null)[],
  modelTextures: readonly ({ name: string } | null)[] = []): (kind: number, stem: string) => boolean {
  const baseOf = (nm: string) => {
    const slash = nm.lastIndexOf("\\");
    const base = slash >= 0 ? nm.slice(slash + 1) : nm;
    const dot = base.lastIndexOf(".");
    return (dot >= 0 ? base.slice(0, dot) : base).toUpperCase();
  };
  return (kind, stem) => {
    if (!stem) return false;
    if (kind === 0) {
      if (stem.length + 11 > 32) return false; // SOUNDNAMELEN: "SOUND\" + ".WAV" + NUL
      const want = `SOUND\\${stem}.WAV`.toUpperCase();
      return sounds.some((s) => s.name.toUpperCase() === want);
    }
    const sbase = baseOf(stem);
    if (!sbase) return false;
    return [...textures, ...modelTextures].some((tex) => Boolean(tex) && baseOf(tex!.name) === sbase);
  };
}

// ---- Geometry helpers ----

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const sx = bx - ax, sz = bz - az, l2 = sx * sx + sz * sz;
  let t = 0;
  if (l2 > 0) { t = ((px - ax) * sx + (pz - az) * sz) / l2; if (t < 0) t = 0; if (t > 1) t = 1; }
  const qx = ax + t * sx - px, qz = az + t * sz - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

/** NearCrest: is (xft, zft) within `ft` of crest i's polyline (the query taken the short way round from point 0)? */
export function nearCrest(falls: readonly TraxxFall[], i: number, xft: number, zft: number, ft: number, cells = 256): boolean {
  if (i < 0 || i >= falls.length || i >= FALL_MAX_FALLS) return false;
  const c = buildCrest(falls[i]!, cells);
  if (c.n < 2) return false;
  const W = fallWorldFt(cells), H = W / 2;
  const qx = c.P[0]![0] + wrapFt(xft - c.P[0]![0] + H, W) - H;
  const qz = c.P[0]![1] + wrapFt(zft - c.P[0]![1] + H, W) - H;
  for (let k = 0; k + 1 < c.n; k++) if (distToSegment(qx, qz, c.P[k]![0], c.P[k]![1], c.P[k + 1]![0], c.P[k + 1]![1]) <= ft) return true;
  return false;
}

/** FallNearestToMenu: the fall whose crest is within 1, 3, 6 or 12 ft of the point (the nearest reach first), or -1. */
export function fallNearestToMenu(falls: readonly TraxxFall[], xft: number, zft: number, cells = 256): number {
  for (const reach of [1.0, 3.0, 6.0, 12.0]) for (let i = 0; i < falls.length; i++) if (nearCrest(falls, i, xft, zft, reach, cells)) return i;
  return -1;
}

/** Reverse: the point order reversed (the flow side flips). */
export function fallReverse(w: TraxxFall): void {
  const n = Math.min(w.npoints, FALL_MAX_POINTS);
  for (let a = 0, b = n - 1; a < b; a++, b--) { const t = w.pt[a]!; w.pt[a] = w.pt[b]!; w.pt[b] = t; }
}

// ---- Validation (handover section 5) ----

function stemBad(s: string, kind: number, namecheck: FallNameCheck): boolean {
  if (s.length > FALL_NAMELEN - 1) return true; // longer than 15 characters
  if (s !== "" && namecheck && !namecheck(kind, s)) return true;
  return false;
}

/* DirectionMask: bit k set when crest point k's back point (1 ft against the flow) is not on the source lake. */
function directionMask(w: TraxxFall, tmap: Uint8Array | null): number {
  if (!tmap) return 0;
  // The direction check's tile is floor(p / 32) & (N - 1) in the N x N map (spec 9.3).
  const cells = mapCells(tmap), { M, SH, W } = wd(cells);
  const c = buildCrest(w, cells);
  if (c.n < 2) return 0;
  const pd = crestPointDirs(c);
  let mask = 0;
  for (let k = 0; k < c.n; k++) {
    // An inner point passes when EITHER adjacent segment's back point is on the lake.
    let ok = false;
    const j0 = k > 0 ? k - 1 : 0, j1 = k < c.n - 1 ? k : c.n - 2;
    for (let j = j0; j <= j1 && !ok; j += j1 > j0 ? j1 - j0 : 1) {
      const f: [number, number] = [pd[k]![0], pd[k]![1]];
      segmentDirAtPoint(c, j, f);
      const [bx, bz] = nudgeInto(c, k, j === k);
      const x = wrapFt(bx - f[0], W), z = wrapFt(bz - f[1], W);
      const tx = Math.trunc(x / 32.0) & M, tz = Math.trunc(z / 32.0) & M;
      if (tmap[tx + (tz << SH)] === w.source) ok = true;
    }
    if (!ok) mask |= 1 << k;
  }
  return mask >>> 0;
}

function directionFails(w: TraxxFall, tmap: Uint8Array | null): number {
  let m = directionMask(w, tmap), n = 0;
  for (; m !== 0; m >>>= 1) n += m & 1;
  return n;
}

/** BadPoints: bit k set when crest point k fails the FALL_DIRECTION test (0 with no valid source lake). */
export function fallBadPoints(falls: readonly TraxxFall[], i: number, lakes: FallLakes): number {
  if (i < 0 || i >= falls.length) return 0;
  const w = falls[i]!;
  if (w.source === 0 || w.source > lakes.lakes.length || w.source > 255) return 0;
  return directionMask(w, lakes.tmap);
}

/**
  Orient: pick the flow side of fall i. With a source lake: the order with fewer DIRECTION
  failures; a tie is decided by where the lake is (2..48 ft behind and ahead of each point), an
  exact tie keeps the order. A spring: the order that flows downhill (4 ft either side).
*/
export function fallOrient(falls: TraxxFall[], i: number, lakes: FallLakes, g: FallGround | null): void {
  if (i < 0 || i >= falls.length) return;
  const w = falls[i]!;
  if (w.npoints < 2 || w.npoints > FALL_MAX_POINTS) return;
  if (w.source !== 0) {
    if (w.source > lakes.lakes.length || !lakes.tmap) return;
    const r = cloneFall(w);
    fallReverse(r);
    const fw = directionFails(w, lakes.tmap), fr = directionFails(r, lakes.tmap);
    if (fr < fw) { fallReverse(w); return; } // *w = r, in place
    if (fr > fw) return;
    const { M, SH, W } = wd(fallLakesCells(lakes));
    const c = buildCrest(w, fallLakesCells(lakes));
    if (c.n < 2) return;
    const pd = crestPointDirs(c);
    let sum = 0;
    for (let k = 0; k < c.n; k++) {
      for (let s = 2; s <= 48; s += 2) {
        const bx = wrapFt(c.P[k]![0] - s * pd[k]![0], W), bz = wrapFt(c.P[k]![1] - s * pd[k]![1], W);
        const ax = wrapFt(c.P[k]![0] + s * pd[k]![0], W), az = wrapFt(c.P[k]![1] + s * pd[k]![1], W);
        const bt = (Math.trunc(bx / 32.0) & M) + ((Math.trunc(bz / 32.0) & M) << SH);
        const at = (Math.trunc(ax / 32.0) & M) + ((Math.trunc(az / 32.0) & M) << SH);
        sum += (lakes.tmap[bt] === w.source ? 1 : 0) - (lakes.tmap[at] === w.source ? 1 : 0);
      }
    }
    if (sum < 0) fallReverse(w);
    return;
  }
  if (!g) return;
  const gc = g.cells ?? 256, GW = fallWorldFt(gc);
  const c = buildCrest(w, gc);
  if (c.n < 2) return;
  const pd = crestPointDirs(c);
  let sum = 0;
  for (let k = 0; k < c.n; k++) {
    const bx = wrapFt(c.P[k]![0] - 4.0 * pd[k]![0], GW), bz = wrapFt(c.P[k]![1] - 4.0 * pd[k]![1], GW);
    const ax = wrapFt(c.P[k]![0] + 4.0 * pd[k]![0], GW), az = wrapFt(c.P[k]![1] + 4.0 * pd[k]![1], GW);
    sum += g.height(bx, bz) - g.height(ax, az);
  }
  if (sum < -0.01) fallReverse(w);
}

/**
  Errors of fall i (FALLERR_*): FALLERR_COUNT for i past 63. The notch errors need the tile map
  and all the falls; FALLERR_LIP_LOW needs the ground (lipground) and is left out without it.
*/
export function fallErrors(falls: readonly TraxxFall[], i: number, lakes: FallLakes, namecheck: FallNameCheck = null, lipground: LakeGround | null = null): number {
  if (i >= FALL_MAX_FALLS) return FALLERR_COUNT;
  if (i < 0 || i >= falls.length) return 0;
  const w = falls[i]!;
  let e = 0;
  let n = w.npoints;
  if (n < 2 || n > FALL_MAX_POINTS) e |= FALLERR_POINTS;
  if (n > FALL_MAX_POINTS) n = FALL_MAX_POINTS;
  // Crest points below 16 W (spec 9.3; 131072 at N = 256).
  const cells = fallLakesCells(lakes), cmax = fallCoordMax(cells);
  for (let k = 0; k < n; k++) {
    if (w.pt[k]![0] < 0 || w.pt[k]![0] > cmax || w.pt[k]![1] < 0 || w.pt[k]![1] > cmax) e |= FALLERR_COORD;
  }
  const c = buildCrest(w, cells);
  for (let k = 0; k + 1 < c.n; k++) {
    if (c.len[k]! < FALL_MIN_SEGMENT) e |= FALLERR_POINTS;
    // Turn > 90 degrees: the dot of the two segment vectors is negative (exact, in integers).
    if (k > 0 && c.dx[k - 1]! * c.dx[k]! + c.dz[k - 1]! * c.dz[k]! < 0) e |= FALLERR_TURN;
  }
  if (c.L > FALL_MAX_WIDTH) e |= FALLERR_WIDTH;
  const lakeok = w.source !== 0 && w.source <= lakes.lakes.length && w.source <= 255;
  if (w.source !== 0 && !lakeok) e |= FALLERR_SOURCE;
  const height = fallEffectiveHeight(falls, i, lakes.lakes);
  if (w.source === 0 || lakeok) {
    // 1..4096 at 256 cells, the terrain's range at 512 (fallHeightLimits).
    const lim = fallHeightLimits(falls, lakes);
    if (height < lim.min || height > lim.max) e |= FALLERR_HEIGHT;
  }
  if (w.speed < 16 || w.speed > 1600) e |= FALLERR_SPEED;
  if (lakeok && c.n >= 2) {
    if (!lakes.tmap || directionFails(w, lakes.tmap) > 0) e |= FALLERR_DIRECTION;
  }
  if (w.roughfrom >= 251 && w.roughfrom <= 254) e |= FALLERR_ROUGH;
  if (stemBad(w.sound, 0, namecheck) || stemBad(w.texture, 1, namecheck)) e |= FALLERR_NAME;
  // The spillway notch (a lake-fed fall): the tiles (TILE) or edges (EDGE) it cuts, and, given the ground, the lip.
  if (w.source !== 0 && c.n >= 2) {
    e |= notchErrors(falls, i, lakes.tmap, cells, edgeRule(lakes));
    if (lipground && lakeok) e |= lipLowError(falls, i, lakes, lipground);
  }
  return e;
}

/**
  ErrorText, verbatim. With `world` of a version 6 track, FALLERR_HEIGHT says why: a 256-cell
  world's .WFL is version 1 (0.5 to 2,048 ft), a 512-cell world's holds the terrain's range.
  `edge`: the lakes run the EDGE rule, the notch codes are worded for the notch EDGE (4.5a).
*/
export function fallErrorText(bit: number, world: FallWorld | null = null, edge = false): string {
  if (edge) {
    switch (bit) {
      case FALLERR_NOTCH: return "The notch edge is not between the lake tile behind the crest and a tile outside every lake - put the crest on the lake's edge, within 1 ft of it";
      case FALLERR_NOTCH_SHARED: return "Another waterfall cuts the same notch edge";
      case FALLERR_LIP_LOW: return "A lip point is below the lake's height: the water's edge would show as a floating face - raise it to the lake's height";
    }
  }
  // ErrorText(bit, edge, maxheight): the kind's own ceiling (FallMaxHeight).
  if (bit === FALLERR_HEIGHT && world?.maxHeight !== undefined) return `The crest height is outside 1..${world.maxHeight}`;
  if (bit === FALLERR_HEIGHT && world && world.terrain) {
    if (world.cells === 256) return "The crest height is outside 1..4096 (0.5 to 2,048 ft): a 256-cell track's waterfalls (.WFL version 1) hold no other height - lower it, or use a 512-cell world";
    const r = fallHeightBounds(world);
    return `The crest height is outside ${r.min}..${r.max}, the terrain's range on this 512-cell track (.WFL version 2)`;
  }
  switch (bit) {
    case FALLERR_POINTS: return "A waterfall needs 2 to 8 crest points, at least 2 ft apart";
    case FALLERR_TURN: return "The crest turns by more than 90 degrees at a point";
    case FALLERR_WIDTH: return "The crest is longer than 1024 ft";
    case FALLERR_COORD: return "A crest point is outside the map";
    case FALLERR_SOURCE: return "The source lake does not exist";
    case FALLERR_HEIGHT: return "The crest height is outside 1..4096";
    case FALLERR_SPEED: return "The flow speed is outside 1..100 ft/s";
    case FALLERR_DIRECTION: return "A crest point is not on the lake's edge, or the flow side is wrong - the point 1 ft against the flow must be on the lake";
    case FALLERR_NAME: return "The sound or texture name is too long or is not in the pod";
    case FALLERR_COUNT: return "Too many waterfalls (at most 64)";
    case FALLERR_NOTCH: return "The notch is in a lake, or is not next to the lake tile behind the crest - put the crest on the lake's edge, within 1 ft of it";
    case FALLERR_NOTCH_SHARED: return "Another waterfall cuts the same notch tile";
    case FALLERR_ROUGH: return "Rough from is 251..254: use 0 (default), 1..250 ft/s, or switch Rough water off";
    case FALLERR_LIP_LOW: return "A lip corner is below the lake's height: the water's edge would show as a floating face - raise it to the lake's height";
  }
  return "";
}

/** WarnText, verbatim; `edge` words the notch codes for the notch edge (the EDGE rule). */
export function fallWarnText(bit: number, edge = false): string {
  if (edge) {
    switch (bit) {
      case FALLWARN_LIP_HIGH: return "A lip point is above the lake's height: the water climbs over the lip";
      case FALLWARN_NOTCH_FLAT: return "The slope of the ground beyond the notch edge along the flow is under 5 degrees: the water may come to rest on it - lower the far side by at least two steps";
    }
  }
  switch (bit) {
    case FALLWARN_LIP_HIGH: return "A lip corner is above the lake's height: the water climbs over the lip";
    case FALLWARN_LIP_UNCOVERED: return "The crest does not cover the whole lip edge: a thin z-fight band can show - stretch the crest along the lip edge";
    case FALLWARN_NOTCH_FLAT: return "The notch tile slopes under 5 degrees along the flow: the water may come to rest on it - lower the far side by at least two steps";
    case FALLWARN_DRY: return "The water lands on dry ground: no foam strip or landing rings (mist and droplets still appear)";
    case FALLWARN_COARSE: return "Too many vertices: the engine will draw this fall coarser";
    case FALLWARN_SHORTENED: return "Too many vertices: the engine will cut this fall short";
    case FALLWARN_DROPPED: return "The track's waterfall budget is used up: the engine will not draw this fall";
    case FALLWARN_SILENT: return "The track already has 30 looping sounds: this fall will be silent";
  }
  return "";
}

// ---- The shape (handover 4.3): a port of wtr_check walk_column, _totals and fall_build_stats ----

/* GroundAt: the ground at an unwrapped position. */
function groundAt(g: FallGround, x: number, z: number): number {
  const W = fallWorldFt(g.cells ?? 256);
  return g.height(wrapFt(x, W), wrapFt(z, W));
}

/*
  ColBuf: one column's kept rows. p the path rows as float (what the preview draws), dp the same in
  double, vs the braking-eased speed (vertex float 5), s the path distance from the crest (float
  15), air the row's air flag (float 6); a water-ending column's sink row sits at index n of dp, vs,
  s and air (sink = 1), never in p.
*/
interface ColBuf { p: number[]; dp: number[]; vs: number[]; s: number[]; air: number[]; n: number; sink: number }

const newColBuf = (): ColBuf => ({ p: [], dp: [], vs: [], s: [], air: [], n: 0, sink: 0 });

/* ColPush: a kept row; s and the eased speed accumulate as the engine writer does (FallShape.cpp writeEmit). */
function colPush(b: ColBuf, x: number, y: number, z: number, speed: number, air: number): void {
  const n = b.n;
  b.p[n * 3] = Math.fround(x); b.p[n * 3 + 1] = Math.fround(y); b.p[n * 3 + 2] = Math.fround(z);
  b.dp[n * 3] = x; b.dp[n * 3 + 1] = y; b.dp[n * 3 + 2] = z;
  if (n === 0) { b.s[0] = 0.0; b.vs[0] = speed; }
  else {
    const dx = x - b.dp[(n - 1) * 3]!, dy = y - b.dp[(n - 1) * 3 + 1]!, dz = z - b.dp[(n - 1) * 3 + 2]!;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const eased = b.vs[n - 1]! * Math.exp(-len / FALL_BRAKE_FT);
    b.s[n] = b.s[n - 1]! + len;
    b.vs[n] = speed > eased ? speed : eased;
  }
  b.air[n] = air !== 0 ? 1 : 0;
  b.n++;
}

/*
  RunoutStart (FallShape.cpp runoutStart): the row where the column's final flat run-out STARTS, -1
  if none: the trailing run of flat draped rows begins at s, the run-out at the first row j >= s - 1
  from which the column never drops FALL_RUNOUT_DROP again. Over the WHOLE natural column (n rows).
*/
function runoutStart(n: number, endk: number, y: readonly number[], ok: readonly number[]): number {
  if (endk === FALLEND_WATER || n < 2) return -1;
  let s = n;
  while (s > 0 && ok[s - 1]) s--;
  if (s >= n) return -1;
  let j = s > 0 ? s - 1 : 0;
  for (; j < n; j++) if (y[j]! - y[n - 1]! < FALL_RUNOUT_DROP) break;
  return j >= n - 1 ? -1 : j;
}

/* RunoutRows (FallShape.cpp runoutRows): the rows the mesh keeps of a column; water-ending columns are never trimmed. */
function runoutRows(n: number, endk: number, y: readonly number[], p: readonly number[], ok: readonly number[]): number {
  if (endk === FALLEND_WATER || n < 2) return n;
  const j = runoutStart(n, endk, y, ok);
  if (j < 0 || p[n - 1]! - p[j]! <= FALL_RUNOUT_FT) return n;
  for (let q = j + 1; q < n; q++) if (p[q]! - p[j]! > FALL_RUNOUT_FT) return q + 1;
  return n;
}

/*
  LandPick (FallShape.cpp landPick): the DRY landing row of a column over its rt WRITTEN rows (-1 =
  the last one); n = the natural row count the run-out start is found over. A water-ending column,
  or one that ends airborne, has none. FALL: the airborne stretch with the largest vertical drop,
  if that is at least half of (crest - the last written row): its touchdown row. SLIDE: the first
  row of the final flat run-out, if that is row 1 or later.
*/
function landPick(rt: number, n: number, endk: number, y: readonly number[], air: readonly number[], ok: readonly number[], crestY: number): number {
  if (endk === FALLEND_WATER || rt < 2 || air[rt - 1]) return -1;
  let i = 0, best = -1, bestdrop = 0.0;
  while (i < rt) {
    if (air[i]) {
      const a = i;
      while (i < rt && air[i]) i++;
      if (i >= rt) break;
      const d = y[a > 0 ? a - 1 : 0]! - y[i]!;
      if (d > bestdrop) { bestdrop = d; best = i; }
    } else i++;
  }
  if (best >= 0 && bestdrop >= 0.5 * (crestY - y[rt - 1]!)) return best;
  const j = runoutStart(n, endk, y, ok);
  return j >= 1 && j < rt ? j : -1; // row 0 is the crest itself: a nearly level column has no foot
}

/* WalkColumn into a ColBuf: the rows, the run-out trim, the dry landing row and the sink row. */
function walkInto(sx: number, sy: number, sz: number, dx: number, dz: number, speed: number, source: number, g: FallGround, spacing: number,
  b: ColBuf): { rows: number; end: number; pathlen: number; land: number } {
  let x = sx, y = sy, z = sz;
  let vx = speed * dx, vy = 0.0, vz = speed * dz;
  let acc = 0, path = 0, rows = 1, ek = FALLEND_LIMIT;
  const W = fallWorldFt(g.cells ?? 256);
  // per kept row, for the final run-out trim: height, cumulative 3-D path, draped on flat ground, airborne
  const ry = [y], rp = [0.0], rok = [0], rair = [1];
  let lx = x, ly = y, lz = z;
  colPush(b, x, y, z, speed, 1);
  for (let step = 1; step <= FALL_MAX_STEPS; step++) {
    const ox = x, oy = y, oz = z;
    let draped = false, ended = false, gny = 0.0, air = 1;
    // ballistic: p += v dt, then v.y -= g dt
    x += vx * FALL_DT;
    y += vy * FALL_DT;
    z += vz * FALL_DT;
    vy -= FALL_GRAVITY * FALL_DT;
    const gr = groundAt(g, x, z);
    // drape (4.3 step 3): the normal from the ground 0.5 ft either side, the part of v into the ground removed, then the drag
    if (y < gr + FALL_DRAPE) {
      const ax = -(groundAt(g, x + 0.5, z) - groundAt(g, x - 0.5, z));
      const az = -(groundAt(g, x, z + 0.5) - groundAt(g, x, z - 0.5));
      const l = Math.sqrt(ax * ax + 1.0 + az * az);
      const nx = ax / l, ny = 1.0 / l, nz = az / l;
      const vn = vx * nx + vy * ny + vz * nz;
      y = gr + FALL_DRAPE;
      draped = true;
      air = 0;
      if (vn < 0.0) { vx -= vn * nx; vy -= vn * ny; vz -= vn * nz; }
      vx *= FALL_DRAG; vy *= FALL_DRAG; vz *= FALL_DRAG;
      gny = ny;
    } else if (y - (gr + FALL_DRAPE) <= FALL_AIRTOL) air = 0; // hugging the drape height: the flag only
    const speednow = Math.sqrt(vx * vx + vy * vy + vz * vz);
    // end tests on the position after the drape: water (its last point on the surface), rest, limit
    const surf = g.water ? g.water(wrapFt(x, W), wrapFt(z, W), source) : null;
    if (surf !== null && surf > gr && y <= surf) { y = surf; ek = FALLEND_WATER; ended = true; }
    else if (draped && gny > FALL_REST_COSINE && speednow < FALL_REST_SPEED) { ek = FALLEND_GROUND; ended = true; }
    if (!ended && step === FALL_MAX_STEPS) { ek = FALLEND_LIMIT; ended = true; }
    const len = Math.sqrt((x - ox) * (x - ox) + (y - oy) * (y - oy) + (z - oz) * (z - oz));
    acc += len;
    path += len;
    if (ended || acc >= spacing) {
      colPush(b, x, y, z, speednow, air);
      if (rows < FALL_MAXROWS) {
        const ax = -(groundAt(g, x + 0.5, z) - groundAt(g, x - 0.5, z));
        const az = -(groundAt(g, x, z + 0.5) - groundAt(g, x, z - 0.5));
        rp[rows] = rp[rows - 1]! + Math.sqrt((x - lx) * (x - lx) + (y - ly) * (y - ly) + (z - lz) * (z - lz));
        ry[rows] = y;
        rok[rows] = air === 0 && 1.0 / Math.sqrt(ax * ax + 1.0 + az * az) > FALL_COS10 ? 1 : 0;
        rair[rows] = air !== 0 ? 1 : 0;
        lx = x; ly = y; lz = z;
      }
      rows++;
      acc = 0.0;
    }
    if (ended) break;
  }
  let land = -1;
  // the final run-out trim: the mesh column (and the preview's) ends early; the path length stays whole
  if (rows <= FALL_MAXROWS) {
    const keep = runoutRows(rows, ek, ry, rp, rok);
    // the dry landing row over the KEPT rows (the run-out start itself over the natural column, as the engine)
    land = landPick(keep, rows, ek, ry, rair, rok, sy);
    if (keep < rows) {
      rows = keep;
      b.n = keep;
      b.p.length = 3 * keep; b.dp.length = 3 * keep; b.vs.length = keep; b.s.length = keep; b.air.length = keep;
    }
  }
  // the slab's sink row (FallShape.cpp writeEmit): the last direction continued to FALL_SINK_FT under the
  // surface, or straight down when it descends at less than FALL_SINK_MINSLOPE; the foot of the front face, not drawn
  if (ek === FALLEND_WATER && b.n >= 2) {
    const n = b.n;
    const plx = b.dp[(n - 1) * 3]!, ply = b.dp[(n - 1) * 3 + 1]!, plz = b.dp[(n - 1) * 3 + 2]!;
    const ddx = plx - b.dp[(n - 2) * 3]!, ddy = ply - b.dp[(n - 2) * 3 + 1]!, ddz = plz - b.dp[(n - 2) * 3 + 2]!;
    const len = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
    let tx = 0.0, tz = 0.0;
    if (len > 1e-9 && -ddy / len >= FALL_SINK_MINSLOPE) { const kk = FALL_SINK_FT / -ddy; tx = ddx * kk; tz = ddz * kk; }
    const seg = Math.sqrt(tx * tx + FALL_SINK_FT * FALL_SINK_FT + tz * tz);
    b.dp[n * 3] = plx + tx; b.dp[n * 3 + 1] = ply - FALL_SINK_FT; b.dp[n * 3 + 2] = plz + tz;
    b.vs[n] = b.vs[n - 1]! * Math.exp(-seg / FALL_BRAKE_FT);
    b.s[n] = b.s[n - 1]! + seg;
    b.air[n] = b.air[n - 1]!;
    b.sink = 1;
  }
  return { rows, end: ek, pathlen: path, land };
}

/**
  WalkColumn: one column from (sx, sy, sz) feet along horizontal (dx, dz), walk_column. A row is
  kept whenever the path since the last one is at least `spacing` ft, and always at the end; a
  column that ends on ground loses its final flat run-out past 8 ft (the trim; pathlen stays the
  whole path). `rowsOut` (null = count only) receives the kept rows' points; `land` is the dry
  landing row (-1 = the last row).
*/
export function walkColumn(sx: number, sy: number, sz: number, dx: number, dz: number, speed: number, source: number, g: FallGround, spacing: number,
  rowsOut: number[] | null): { rows: number; end: number; pathlen: number; land: number } {
  const b = newColBuf();
  const r = walkInto(sx, sy, sz, dx, dz, speed, source, g, spacing, b);
  if (rowsOut) for (let i = 0; i < 3 * b.n; i++) rowsOut.push(b.p[i]!);
  return r;
}

/*
  THE SLAB (handover 4.6, spec 4.2; FallShape.cpp slabThick / sheetNormals / countBack). The engine
  builds the fall as a front face (the path pushed out along the smooth normal by the thickness) and
  a back face where the water is airborne. The preview draws the front face only; the back face is
  COUNTED. Traxx previews at the engine defaults (wfDepthScale and waterfallBulk 100).
*/
const FALL_MAX_THICK_FT = 8.0;
const FALL_MIN_THICK_FT = 0.05;
const FALL_FOOT_FT = 3.0;
const FALL_CREST_FT = 1.0;
const FALL_BULK_FT = 25.0;
const FALL_MIN_DRAPE_FT = 0.5;
/** engine 44c8067: the crest depth h0 stops growing with speed here (x depthScale). */
const FALL_MAX_CREST_FT = 2.0;
/** Draped water never piles up thicker than this (the drape floor still wins). */
const FALL_MAX_DRAPE_FT = 2.5;

const clampD = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
  FallSlabThick (slabThick): the thickness (ft) at one sheet vertex. vEased / air / drop / s are the
  engine floats 5, 6, 11, 15 of the vertex, Lend the s of the column's last mesh row; column c of C.
*/
export function fallSlabThick(v0: number, vEased: number, air: number, drop: number, c: number, C: number, s: number, Lend: number): number {
  const ds = 1.0, bk = 1.0;
  let h0 = (ds * v0 * v0) / FALL_GRAVITY;
  // engine 44c8067: a faster crest throws the water further, it does not add water
  if (h0 > ds * FALL_MAX_CREST_FT) h0 = ds * FALL_MAX_CREST_FT;
  const num = h0 * v0;
  const pile = 2.0 * h0;
  let hc: number;
  if (vEased > 1e-9) hc = num / vEased;
  else hc = num > 0.0 ? pile : 0.0;
  if (hc > pile) hc = pile;
  if (hc > FALL_MAX_DRAPE_FT) hc = FALL_MAX_DRAPE_FT;
  const floorD = FALL_MIN_DRAPE_FT * bk;
  const hDrape = hc > floorD ? hc : floorD;
  const hAir = h0 * (1.0 + (bk * (drop > 0.0 ? drop : 0.0)) / FALL_BULK_FT);
  let h = hDrape + (hAir - hDrape) * clampD(air, 0.0, 1.0);
  h = clampD(h, FALL_MIN_THICK_FT, FALL_MAX_THICK_FT);
  const t = C > 1 ? (2.0 * c) / (C - 1) - 1.0 : 0.0;
  let lens = 1.0 - t * t;
  lens = lens > 0.0 ? Math.sqrt(lens) : 0.0;
  let along = clampD((Lend - s) / FALL_FOOT_FT, 0.0, 1.0);
  const a = clampD(s / FALL_CREST_FT, 0.0, 1.0);
  if (a < along) along = a;
  if (C <= 2) return 0.0; // a two-column fall is a flat sheet
  return h * lens * along;
}

/* BackMark: a sheet triangle with an airborne corner has a back twin: its three corners are back vertices. 1 = a back triangle. */
function backMark(off: Int32Array, air: Uint8Array, mark: Uint8Array, c0: number, r0: number, c1: number, r1: number, c2: number, r2: number): number {
  const i0 = off[c0]! + r0, i1 = off[c1]! + r1, i2 = off[c2]! + r2;
  if (!air[i0] && !air[i1] && !air[i2]) return 0; // all draped: no back twin
  mark[i0] = 1; mark[i1] = 1; mark[i2] = 1;
  return 1;
}

/*
  CountBack (countBack): the back-face vertices of a sheet whose column c has rc[c] mesh rows: the
  corners of every sheet triangle (the engine writer's: the common rows as quads, then the shorter
  column closes with a fan) that has an airborne corner. Two columns or fewer, or no flags: none.
  Traxx 1.8.0: also the back triangles.
*/
function countBack(C: number, rc: Int32Array, off: Int32Array | null | undefined, air: Uint8Array | null | undefined, mark: Uint8Array | null | undefined): { n: number; tris: number } {
  if (!air || !mark || !off || C <= 2) return { n: 0, tris: 0 };
  for (let c = 0; c < C; c++) for (let r = 0; r < rc[c]!; r++) mark[off[c]! + r] = 0;
  let nt = 0;
  for (let c = 0; c + 1 < C; c++) {
    const ra = rc[c]!, rb = rc[c + 1]!, m = ra < rb ? ra : rb;
    for (let r = 0; r + 1 < m; r++) {
      nt += backMark(off, air, mark, c, r, c + 1, r, c + 1, r + 1);
      nt += backMark(off, air, mark, c, r, c + 1, r + 1, c, r + 1);
    }
    if (ra < rb) { for (let r = m - 1; r + 1 < rb; r++) nt += backMark(off, air, mark, c, m - 1, c + 1, r, c + 1, r + 1); }
    else if (rb < ra) { for (let r = m - 1; r + 1 < ra; r++) nt += backMark(off, air, mark, c, r, c + 1, m - 1, c, r + 1); }
  }
  let n = 0;
  for (let c = 0; c < C; c++) for (let r = 0; r < rc[c]!; r++) if (mark[off[c]! + r]) n++;
  return { n, tris: nt };
}

/*
  SlabFront: the preview's front face (the engine slab steps 1 and 4): per vertex the path point
  pushed out along the smooth normal by the thickness. cb[c] = the 2 ft column c, (fdx, fdz)[c] its
  crest flow direction, (ax, az) the first crest point and crestY the crest height (the engine
  vertex origin). Fills out.col[c].front.
*/
function slabFront(cb: ColBuf[], C: number, fdx: number[], fdz: number[], ax: number, az: number, crestY: number, speed: number, out: FallShape): void {
  if (C < 1 || C > FALL_MAX_COLS) return;
  const f = Math.fround;
  const rc: number[] = [], pos: Float32Array[] = [], nrm: Float32Array[] = [];
  for (let c = 0; c < C; c++) {
    rc[c] = cb[c]!.n + cb[c]!.sink;
    const p = new Float32Array(rc[c]! * 3);
    // the engine sheet vertex: (feet - the crest first point / height) * 256, as float
    for (let r = 0; r < rc[c]!; r++) {
      p[3 * r] = (cb[c]!.dp[3 * r]! - ax) * 256.0;
      p[3 * r + 1] = (cb[c]!.dp[3 * r + 1]! - crestY) * 256.0;
      p[3 * r + 2] = (cb[c]!.dp[3 * r + 2]! - az) * 256.0;
    }
    pos[c] = p;
    nrm[c] = new Float32Array(rc[c]! * 3);
  }
  // sheetNormals: along = next row - previous row of the column (one-sided at the ends), across = right
  // column - left column at the same row (a missing neighbour is the vertex itself); N = normalize(along x
  // across) turned to face up and downstream, dot(N, (fdx, 1, fdz)) >= 0.
  for (let c = 0; c < C; c++) {
    const P = pos[c]!;
    for (let r = 0; r < rc[c]!; r++) {
      const pi = 3 * r, pa = 3 * (r + 1 < rc[c]! ? r + 1 : r), pb = 3 * (r > 0 ? r - 1 : r);
      const R = c + 1 < C && r < rc[c + 1]! ? pos[c + 1]! : P, ri = R === P ? pi : 3 * r;
      const L = c > 0 && r < rc[c - 1]! ? pos[c - 1]! : P, li = L === P ? pi : 3 * r;
      let al0 = P[pa]! - P[pb]!, al1 = P[pa + 1]! - P[pb + 1]!, al2 = P[pa + 2]! - P[pb + 2]!;
      let ac0 = R[ri]! - L[li]!, ac1 = R[ri + 1]! - L[li + 1]!, ac2 = R[ri + 2]! - L[li + 2]!;
      if (al0 * al0 + al1 * al1 + al2 * al2 < 1e-6) { al0 = fdx[c]!; al1 = 0.0; al2 = fdz[c]!; }
      if (ac0 * ac0 + ac1 * ac1 + ac2 * ac2 < 1e-6) { ac0 = -fdz[c]!; ac1 = 0.0; ac2 = fdx[c]!; }
      let n0 = al1 * ac2 - al2 * ac1, n1 = al2 * ac0 - al0 * ac2, n2 = al0 * ac1 - al1 * ac0;
      let l = Math.sqrt(n0 * n0 + n1 * n1 + n2 * n2);
      if (l < 1e-12) { n0 = 0.0; n1 = 1.0; n2 = 0.0; l = 1.0; }
      n0 /= l; n1 /= l; n2 /= l;
      if (n0 * fdx[c]! + n1 + n2 * fdz[c]! < 0.0) { n0 = -n0; n1 = -n1; n2 = -n2; }
      nrm[c]![pi] = n0; nrm[c]![pi + 1] = n1; nrm[c]![pi + 2] = n2;
    }
    // the sunk vertex takes the waterline row normal
    if (cb[c]!.sink) nrm[c]!.copyWithin(3 * (rc[c]! - 1), 3 * (rc[c]! - 2), 3 * (rc[c]! - 1));
  }
  // the thickness of every path row and the push (the sink row is the foot and is not drawn)
  for (let c = 0; c < C; c++) {
    const b = cb[c]!, N = nrm[c]!;
    const Lend = f(b.s[rc[c]! - 1]!);
    const front = new Float32Array(b.n * 3);
    for (let r = 0; r < b.n; r++) {
      const drop = f(crestY - b.dp[3 * r + 1]!);
      const h = f(fallSlabThick(speed, f(b.vs[r]!), b.air[r]!, drop, c, C, f(b.s[r]!), Lend));
      front[3 * r] = b.dp[3 * r]! + N[3 * r]! * h;
      front[3 * r + 1] = b.dp[3 * r + 1]! + N[3 * r + 1]! * h;
      front[3 * r + 2] = b.dp[3 * r + 2]! + N[3 * r + 2]! * h;
    }
    out.col[c]!.front = front;
  }
}

/*
  _totals (FallShape.cpp totals): the vertices of a fall whose columns are cut to R rows - every row,
  plus 3 foam vertices per column in a run of 2 or more water-ending columns, plus the slab's back
  face (CountBack). `back` = the back-face part.

  Totals2 (Traxx 1.8.0, _totals2): the vertices AND the triangles of that grid (quads + fans between
  neighbouring columns, 4 per foam run step, the back face); the budget loop tests both against the
  vertex and the INDEX budgets. This is the FULL grid (the budget loop's upper bound); the written
  mesh after the flow tubes is fallFlowMesh.
*/
function totals2(st: FallStat, R: number): { total: number; back: number; tris: number } {
  let sheet = 0, run = 0, foam = 0, t = 0;
  const rc = new Int32Array(st.ncols);
  for (let c = 0; c < st.ncols; c++) { rc[c] = st.rows[c]! < R ? st.rows[c]! : R; sheet += rc[c]!; }
  for (let c = 1; c < st.ncols; c++) {
    const m = rc[c]! < rc[c - 1]! ? rc[c]! : rc[c - 1]!, M = rc[c]! < rc[c - 1]! ? rc[c - 1]! : rc[c]!;
    t += 2 * (m - 1) + (M - m);
  }
  for (let c = 0; c <= st.ncols; c++) {
    const wet = c < st.ncols && st.endk[c] === FALLEND_WATER && st.rows[c]! <= R;
    if (wet) run++;
    else {
      if (run >= 2) { foam += 3 * run; t += 4 * (run - 1); }
      run = 0;
    }
  }
  const b = countBack(st.ncols, rc, st.off, st.air, st.mark);
  return { total: sheet + foam + b.n, back: b.n, tris: t + b.tris };
}

function totals(st: FallStat, R: number): { total: number; back: number } {
  const t = totals2(st, R);
  return { total: t.total, back: t.back };
}

const ALL_ROWS = 0x7fffffff;

/*
  FLOW TUBES + RIBBONS (Traxx 1.8.0, f7fb1b9, handover 4.7): a port of wtr_check flow_merge,
  flow_rows_ok, flow_tris, ribbon_width and flow_mesh (line-for-line mirrors of cursh2
  core\FallShape.cpp flowMerge / flowTris / fallBuild), as TrackPODFalls.cpp FlowMeshEx has them.
  The decisions are made in double on the PATH points of the written grid (FallStat.pt), after the
  run-out trim and the row cap R. Only the COUNTS (and a column's merged flag / ribbon width, for
  the landing) are produced: the preview keeps its sheet.
*/
const FALL_MERGE = 0.25;
const FALL_MERGE_ROWS = 64;
const FALL_SPLIT = 3.0;
/** FS_AIRCAP: the air store; sheet + ribbon rows beyond this never fit. */
const FALL_AIRCAP = FALL_VERTS_PER_FALL;
export const FALL_IDX_UNLIMITED = 2 ** 60;
/** WF_TRACK_IDX_CAP: each fall gets what is left of it. */
export const FALL_IDX_PER_TRACK = 6 * FALL_VERTS_PER_TRACK;
const FALL_SPLIT_RISE = 8.0;
const FALL_ZIP_TIE = 1.0;

interface FlowStrip { L: number; R: number; sL: number; sR: number; eL: number; eR: number }
interface FlowJunc { l: number; m: number; r: number; rl: number; rm: number; rr: number }

/** The written mesh of a fall after the flow tubes: vertex order sheet | ribbons | foam | back. */
export interface FallFlowInfo {
  sheet: number;
  ribbon: number;
  foam: number;
  back: number;
  frontTris: number;
  ribbonTris: number;
  backTris: number;
  foamTris: number;
  merges: number;
  splitTris: number;
  /** No strip or junction row past its column's last row. */
  rowsOk: boolean;
}

/* fsPS2: horizontal distance^2 from (x, z) to a segment (parameter clamped to [0, 1]). */
function fsPS2(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = 0.0;
  if (l2 > 1e-18) {
    t = ((x - ax) * dx + (z - az) * dz) / l2;
    if (t < 0.0) t = 0.0;
    if (t > 1.0) t = 1.0;
  }
  const ex = ax + dx * t - x, ez = az + dz * t - z;
  return ex * ex + ez * ez;
}

/* fsSS2: horizontal distance^2 between two segments, 0 if they cross strictly. */
function fsSS2(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const o1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const o2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const o3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const o4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  if (((o1 > 0.0 && o2 < 0.0) || (o1 < 0.0 && o2 > 0.0)) && ((o3 > 0.0 && o4 < 0.0) || (o3 < 0.0 && o4 > 0.0))) return 0.0;
  let d = fsPS2(ax, az, cx, cz, dx, dz);
  let e = fsPS2(bx, bz, cx, cz, dx, dz);
  if (e < d) d = e;
  e = fsPS2(cx, cz, ax, az, bx, bz);
  if (e < d) d = e;
  e = fsPS2(dx, dz, ax, az, bx, bz);
  if (e < d) d = e;
  return d;
}

/* fsPathPoly2: column c's path step (row r - 1 -> r) to column n's polyline over rows a..b; oc / on index pt at the columns' row 0. */
function fsPathPoly2(pt: Float64Array, oc: number, on: number, r: number, a: number, b: number): number {
  const px = pt[oc + 3 * (r - 1)]!, pz = pt[oc + 3 * (r - 1) + 2]!, qx = pt[oc + 3 * r]!, qz = pt[oc + 3 * r + 2]!;
  if (a === b) return fsPS2(pt[on + 3 * a]!, pt[on + 3 * a + 2]!, px, pz, qx, qz);
  let best = 1e300;
  for (let k = a; k < b; k++) {
    const d = fsSS2(px, pz, qx, qz, pt[on + 3 * k]!, pt[on + 3 * k + 2]!, pt[on + 3 * k + 3]!, pt[on + 3 * k + 5]!);
    if (d < best) best = d;
  }
  return best;
}

/* fsNearest: the row of n in a..b nearest to (x, y, z) (3D), the first on a tie. */
function fsNearest(pt: Float64Array, on: number, a: number, b: number, x: number, y: number, z: number): number {
  let dx = pt[on + 3 * a]! - x, dy = pt[on + 3 * a + 1]! - y, dz = pt[on + 3 * a + 2]! - z;
  let bd = dx * dx + dy * dy + dz * dz, best = a;
  for (let k = a + 1; k <= b; k++) {
    dx = pt[on + 3 * k]! - x; dy = pt[on + 3 * k + 1]! - y; dz = pt[on + 3 * k + 2]! - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/** ribWidth: W = clamp(0.35 x weight x spacing, 2 ft, weight x spacing). */
export function fallRibbonWidth(wfac: number, spacing: number): number {
  let w = 0.35 * wfac * spacing;
  const hi = wfac * spacing;
  if (w < 2.0) w = 2.0;
  if (w > hi) w = hi;
  return w;
}

interface FlowCtx {
  pt: Float64Array;
  off: Int32Array;
  rc: Int32Array;
  rc2: Int32Array;
  base: Int32Array;
  endR: Int32Array;
  merged: Uint8Array;
  wetEnd: Uint8Array;
  ground: FallGround | null;
  tri: number[];
  ntri: number;
  captri: number;
  bad: boolean;
  s2: number;
}

/*
  fsFar (flowTris, split v3): vertex (c, r) is TORN from column n when its 3D distance to n's
  polyline (nearest segment, rows r +- 64, to n's last row) is over 3 x spacing AND either the
  nearest point is n's last row and n ran DRY (not merged, not ending in water), or the ground
  between stands more than FALL_SPLIT_RISE above both points (sampled every 1 ft).
*/
function flowFar(f: FlowCtx, c: number, r: number, n: number): boolean {
  if (r < 0 || r >= f.rc[c]! || f.endR[n]! < 0 || f.endR[n]! >= f.rc[n]!) { f.bad = true; return true; }
  const pt = f.pt, p = 3 * (f.off[c]! + r), pn = 3 * f.off[n]!;
  const x = pt[p]!, y = pt[p + 1]!, z = pt[p + 2]!;
  let a = r - FALL_MERGE_ROWS > 0 ? r - FALL_MERGE_ROWS : 0;
  const b = r + FALL_MERGE_ROWS < f.endR[n]! ? r + FALL_MERGE_ROWS : f.endR[n]!;
  if (a > b) a = b;
  let qx = pt[pn + 3 * a]!, qy = pt[pn + 3 * a + 1]!, qz = pt[pn + 3 * a + 2]!;
  let atEnd = a === b && b === f.endR[n]!;
  let best: number;
  if (a === b) {
    const dx = qx - x, dy = qy - y, dz = qz - z;
    best = dx * dx + dy * dy + dz * dz;
  } else {
    best = 1e300;
    for (let k = a; k < b; k++) {
      const ax = pt[pn + 3 * k]!, ay = pt[pn + 3 * k + 1]!, az = pt[pn + 3 * k + 2]!;
      const dx = pt[pn + 3 * k + 3]! - ax, dy = pt[pn + 3 * k + 4]! - ay, dz = pt[pn + 3 * k + 5]! - az;
      const l2 = dx * dx + dy * dy + dz * dz;
      let t = 0.0;
      if (l2 > 1e-18) {
        t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / l2;
        if (t < 0.0) t = 0.0;
        if (t > 1.0) t = 1.0;
      }
      const ex = ax + dx * t - x, ey = ay + dy * t - y, ez = az + dz * t - z;
      const d = ex * ex + ey * ey + ez * ez;
      if (d < best) {
        best = d;
        qx = ax + dx * t; qy = ay + dy * t; qz = az + dz * t;
        atEnd = k + 1 === f.endR[n]! && t >= 1.0;
      }
    }
  }
  if (best > f.s2) {
    // past a column that ENDED on the ground (merged / water-ending: fans stay)
    if (atEnd && !f.merged[n] && !f.wetEnd[n]) return true;
    const dx = qx - x, dz = qz - z;
    const N = Math.ceil(Math.sqrt(dx * dx + dz * dz)) | 0;
    const top = (y > qy ? y : qy) + FALL_SPLIT_RISE; // a ridge stands above BOTH waters
    for (let k = 1; k < N; k++) {
      const t = k / N;
      const gh = f.ground ? groundAt(f.ground, x + dx * t, z + dz * t) : 0.0;
      if (gh > top) return true;
    }
  }
  return false;
}

function flowTri(f: FlowCtx, c0: number, r0: number, c1: number, r1: number, c2: number, r2: number): void {
  if (r0 < 0 || r0 >= f.rc2[c0]! || r1 < 0 || r1 >= f.rc2[c1]! || r2 < 0 || r2 >= f.rc2[c2]! || f.ntri >= f.captri) { f.bad = true; return; }
  f.tri.push(f.base[c0]! + r0, f.base[c1]! + r1, f.base[c2]! + r2);
  f.ntri++;
}

/* The anchor of a ribbon stretch's join: the boundary-edge partner of j when within 2 W and the edge is free (then taken), else j. */
function flowAnchor(taken: Set<number>, j: number, partner: number, partd: number, w: number): number {
  if (partner < 0 || !(partd <= 4.0 * w * w)) return j;
  const key = j < partner ? (j + 1) * 4294967296 + (partner + 1) : (partner + 1) * 4294967296 + (j + 1);
  if (taken.has(key)) return j;
  taken.add(key);
  return partner;
}

/**
  FlowMeshEx (flow_mesh / fall_build_stats' written mesh) of stat st at row cap R. `wantRow` (a row
  per column or -1) asks for that row's ribbon width (wOut, 0 when it is not a lone row). Null on a
  stat without path points (or a capacity the engine's buffers would not hold).
*/
function flowMeshEx(st: FallStat, spacing: number, R: number, ground: FallGround | null, wantRow: readonly number[] | null = null):
  { info: FallFlowInfo; endR: Int32Array; merged: Uint8Array; wOut: Float64Array | null } | null {
  const C = st.ncols;
  if (!st.pt || !st.off || C < 1) return null;
  const pt = st.pt, off = st.off;
  const P = (c: number, r: number) => 3 * (off[c]! + r);
  const rc = new Int32Array(C), rc2 = new Int32Array(C), base = new Int32Array(C + 1), ln = new Int32Array(C), rn = new Int32Array(C);
  const osL = new Int32Array(C), osR = new Int32Array(C), need = new Int32Array(C), endR = new Int32Array(C), lastA = new Int32Array(C);
  const surv = new Int32Array(C), target = new Int32Array(C), sunk = new Uint8Array(C), merged = new Uint8Array(C);
  const wt = new Float64Array(C), wtM = new Float64Array(C);
  const strips: FlowStrip[] = [], juncs: FlowJunc[] = [];
  const info: FallFlowInfo = { sheet: 0, ribbon: 0, foam: 0, back: 0, frontTris: 0, ribbonTris: 0, backTris: 0, foamTris: 0, merges: 0, splitTris: 0, rowsOk: false };
  let maxR = 0, merges = 0;

  // the mesh rows of each column at cap R, and whether the sink row was written (a water column with rows <= R)
  for (let c = 0; c < C; c++) {
    rc[c] = st.rows[c]! < R ? st.rows[c]! : R;
    sunk[c] = st.endk[c] === FALLEND_WATER && st.rows[c]! >= 3 && st.rows[c]! <= R ? 1 : 0;
    ln[c] = c - 1;
    rn[c] = c + 1 < C ? c + 1 : -1;
    endR[c] = rc[c]! - 1;
    lastA[c] = sunk[c] ? rc[c]! - 2 : rc[c]! - 1;
    surv[c] = target[c] = -1;
    wt[c] = 1.0;
    if (rc[c]! > maxR) maxR = rc[c]!;
  }

  // ---- flowMerge: rows ascending, columns ascending, the left neighbour before the right
  const thr2 = (FALL_MERGE * spacing) * (FALL_MERGE * spacing);
  for (let r = 1; r < maxR; r++) {
    for (let c = 0; c < C; c++) {
      for (let side = 0; side < 2; side++) {
        if (merged[c] || r > lastA[c]!) break;
        const n = side ? rn[c]! : ln[c]!;
        if (n < 0 || r > lastA[n]!) continue;
        const a = r - FALL_MERGE_ROWS > 0 ? r - FALL_MERGE_ROWS : 0;
        const b = r + FALL_MERGE_ROWS < lastA[n]! ? r + FALL_MERGE_ROWS : lastA[n]!;
        if (!(fsPathPoly2(pt, P(c, 0), P(n, 0), r, a, b) < thr2)) continue;
        const ka = Math.abs(2 * c - (C - 1)), kb = Math.abs(2 * n - (C - 1));
        // the survivor: the column nearer the stream's middle, on a tie the lower index
        let Sv: number, M: number;
        if (ka < kb || (ka === kb && c < n)) { Sv = c; M = n; } else { Sv = n; M = c; }
        let rm = r;
        if (ln[M]! >= 0 && osR[ln[M]!]! > rm) rm = osR[ln[M]!]!;
        if (rn[M]! >= 0 && osL[M]! > rm) rm = osL[M]!;
        if (need[M]! > rm) rm = need[M]!;
        if (rm > rc[M]! - 1) rm = rc[M]! - 1; // (unreachable: the row guard keeps rm inside the column)
        const pm = P(M, rm);
        const x = pt[pm]!, y = pt[pm + 1]!, z = pt[pm + 2]!;
        const Z = Sv === rn[M] ? ln[M]! : rn[M]!;
        const sS = Sv === rn[M] ? osR[M]! : osL[Sv]!;
        const jS = fsNearest(pt, P(Sv, 0), sS, lastA[Sv]!, x, y, z);
        let jZ = 0;
        if (Z >= 0) jZ = fsNearest(pt, P(Z, 0), Z === ln[M] ? osL[Z]! : osR[M]!, lastA[Z]!, x, y, z);
        if (strips.length + 2 > 3 * C + 2 || juncs.length + 1 > C + 1) return null;
        if (Sv === rn[M]) {
          strips.push({ L: M, R: Sv, sL: osL[M]!, sR: osR[M]!, eL: rm, eR: jS });
          if (Z >= 0) {
            strips.push({ L: Z, R: M, sL: osL[Z]!, sR: osR[Z]!, eL: jZ, eR: rm });
            juncs.push({ l: Z, m: M, r: Sv, rl: jZ, rm, rr: jS });
            rn[Z] = Sv; osL[Z] = jZ; osR[Z] = jS;
          }
          ln[Sv] = Z;
        } else {
          strips.push({ L: Sv, R: M, sL: osL[Sv]!, sR: osR[Sv]!, eL: jS, eR: rm });
          if (Z >= 0) {
            strips.push({ L: M, R: Z, sL: osL[M]!, sR: osR[M]!, eL: rm, eR: jZ });
            juncs.push({ l: Sv, m: M, r: Z, rl: jS, rm, rr: jZ });
            ln[Z] = Sv; osL[Sv] = jS; osR[Sv] = jZ;
          }
          rn[Sv] = Z;
        }
        if (jS > need[Sv]!) need[Sv] = jS;
        if (Z >= 0 && jZ > need[Z]!) need[Z] = jZ;
        merged[M] = 1;
        endR[M] = rm;
        lastA[M] = rm;
        surv[M] = Sv;
        target[M] = jS;
        wtM[M] = wt[M]!;
        wt[Sv] = wt[Sv]! + wt[M]!;
        merges++;
        break;
      }
    }
  }
  for (let c = 0; c < C; c++) {
    if (!merged[c] && rn[c]! >= 0) {
      if (strips.length + 1 > 3 * C + 2) return null;
      strips.push({ L: c, R: rn[c]!, sL: osL[c]!, sR: osR[c]!, eL: endR[c]!, eR: endR[rn[c]!]! });
    }
  }
  // stable by the left column (creation order within one left column)
  for (let i = 1; i < strips.length; i++) {
    const q1 = strips[i]!;
    let k = i - 1;
    for (; k >= 0 && strips[k]!.L > q1.L; k--) strips[k + 1] = strips[k]!;
    strips[k + 1] = q1;
  }

  // ---- the written grid: rows after the merges, vertex ids column-major
  let S = 0;
  for (let c = 0; c < C; c++) { rc2[c] = endR[c]! + 1; base[c] = S; S += rc2[c]!; }
  base[C] = S;

  // flow_rows_ok (fallFlowCheck): no strip / junction row past its column's last row
  const stripBad = (q: FlowStrip) => q.sL < 0 || q.sL > q.eL || q.eL > endR[q.L]! || q.sR < 0 || q.sR > q.eR || q.eR > endR[q.R]!;
  let rowsok = true;
  for (const q of strips) if (stripBad(q)) rowsok = false;
  for (const j of juncs) if (!(j.rl <= endR[j.l]! && j.rm <= endR[j.m]! && j.rr <= endR[j.r]!)) rowsok = false;
  info.rowsOk = rowsok;

  // ---- flowTris: the kept sheet triangles, the strips in order, then the junctions; a rung over 3 x spacing drops its triangle
  const ncap = 2 * S + 2 * C + 16;
  const colOf = new Int32Array(Math.max(1, S)), used = new Uint8Array(Math.max(1, S));
  for (let c = 0; c < C; c++) for (let r = 0; r < rc2[c]!; r++) colOf[base[c]! + r] = c;
  const fc: FlowCtx = {
    pt, off, rc, rc2, base, endR, merged, wetEnd: sunk, ground, tri: [], ntri: 0, captri: ncap, bad: false,
    s2: (FALL_SPLIT * spacing) * (FALL_SPLIT * spacing),
  };
  let dropped = 0;
  // the strips are ZIPPED by position along the flow F = normalize(stepL + stepR), in 3D (fsStripTris)
  for (const q1 of strips) {
    let ii = q1.sL, jj = q1.sR, lastR = false;
    if (stripBad(q1)) { fc.bad = true; continue; }
    while (ii < q1.eL || jj < q1.eR) {
      let advR: boolean;
      if (ii >= q1.eL) advR = true;
      else if (jj >= q1.eR) advR = false;
      else {
        const l0 = P(q1.L, ii), l1 = P(q1.L, ii + 1), r0 = P(q1.R, jj), r1 = P(q1.R, jj + 1);
        const lx = pt[l1]! - pt[l0]!, ly = pt[l1 + 1]! - pt[l0 + 1]!, lz = pt[l1 + 2]! - pt[l0 + 2]!;
        const rx = pt[r1]! - pt[r0]!, ry = pt[r1 + 1]! - pt[r0 + 1]!, rz = pt[r1 + 2]! - pt[r0 + 2]!;
        let fx = lx + rx, fy = ly + ry, fz = lz + rz;
        const fl2 = Math.sqrt(fx * fx + fy * fy + fz * fz);
        const sl = Math.sqrt(lx * lx + ly * ly + lz * lz), sr = Math.sqrt(rx * rx + ry * ry + rz * rz);
        let tie = FALL_ZIP_TIE * spacing;
        if (sl > tie) tie = sl;
        if (sr > tie) tie = sr;
        if (fl2 < 1e-12) advR = true;
        else {
          const ox = (pt[l0]! + pt[r0]!) * 0.5, oy = (pt[l0 + 1]! + pt[r0 + 1]!) * 0.5, oz = (pt[l0 + 2]! + pt[r0 + 2]!) * 0.5;
          fx /= fl2; fy /= fl2; fz /= fl2;
          const pa = (pt[l1]! - ox) * fx + (pt[l1 + 1]! - oy) * fy + (pt[l1 + 2]! - oz) * fz;
          const pb = (pt[r1]! - ox) * fx + (pt[r1 + 1]! - oy) * fy + (pt[r1 + 2]! - oz) * fz;
          advR = !lastR;
          if (advR && pb > pa + tie) advR = false;
          if (!advR && pa > pb + tie) advR = true;
        }
      }
      if (advR) {
        if (flowFar(fc, q1.L, ii, q1.R) || flowFar(fc, q1.R, jj, q1.L) || flowFar(fc, q1.R, jj + 1, q1.L)) dropped++;
        else flowTri(fc, q1.L, ii, q1.R, jj, q1.R, jj + 1);
        jj++;
        lastR = true;
      } else {
        if (flowFar(fc, q1.L, ii, q1.R) || flowFar(fc, q1.R, jj, q1.L) || flowFar(fc, q1.L, ii + 1, q1.R)) dropped++;
        else flowTri(fc, q1.L, ii, q1.R, jj, q1.L, ii + 1);
        ii++;
        lastR = false;
      }
    }
  }
  for (const j1 of juncs) {
    if (j1.rl < 0 || j1.rl > endR[j1.l]! || j1.rm < 0 || j1.rm > endR[j1.m]! || j1.rr < 0 || j1.rr > endR[j1.r]!) { fc.bad = true; continue; }
    if (flowFar(fc, j1.l, j1.rl, j1.m) || flowFar(fc, j1.l, j1.rl, j1.r) || flowFar(fc, j1.m, j1.rm, j1.l)
      || flowFar(fc, j1.m, j1.rm, j1.r) || flowFar(fc, j1.r, j1.rr, j1.l) || flowFar(fc, j1.r, j1.rr, j1.m)) { dropped++; continue; }
    flowTri(fc, j1.l, j1.rl, j1.m, j1.rm, j1.r, j1.rr);
  }
  if (fc.bad) info.rowsOk = false; // a broken row range (never seen): the counts are of the triangles that were valid
  const tri = fc.tri;

  // ---- RIBBONS: the flow weight per row (a merged column's weight lands on the survivor's row target + 1, then accumulates down)
  const wf = new Float64Array(Math.max(1, S));
  for (let c = 0; c < C; c++) {
    if (merged[c]) {
      const Sv = surv[c]!, t = target[c]!;
      if (t + 1 < rc2[Sv]!) wf[base[Sv]! + t + 1] = wf[base[Sv]! + t + 1]! + wtM[c]!;
    }
  }
  for (let c = 0; c < C; c++) {
    let acc = 1.0;
    for (let r = 0; r < rc2[c]!; r++) { acc += wf[base[c]! + r]!; wf[base[c]! + r] = acc; }
  }
  for (let i = 0; i < fc.ntri; i++) { used[tri[3 * i]!] = 1; used[tri[3 * i + 1]!] = 1; used[tri[3 * i + 2]!] = 1; }
  const loneIdx = new Int32Array(Math.max(1, S));
  let nlone = 0;
  for (let i = 0; i < S; i++) { loneIdx[i] = -1; if (!used[i]) loneIdx[i] = nlone++; }

  // the boundary edges (one kept triangle) and each vertex's nearest partner across them: the first strictly nearest in triangle order
  const edgeKey = (a: number, b: number) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  const uses = new Map<number, number>();
  for (let i = 0; i < fc.ntri; i++) {
    for (let k = 0; k < 3; k++) {
      const v0 = tri[3 * i + k]!, v1 = tri[3 * i + ((k + 1) % 3)]!;
      if (colOf[v0] === colOf[v1]) continue;
      const key = edgeKey(v0, v1);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const partLd = new Float64Array(Math.max(1, S)), partRd = new Float64Array(Math.max(1, S));
  const partLv = new Int32Array(Math.max(1, S)).fill(-1), partRv = new Int32Array(Math.max(1, S)).fill(-1);
  for (let i = 0; i < fc.ntri; i++) {
    for (let k = 0; k < 3; k++) {
      const v0 = tri[3 * i + k]!, v1 = tri[3 * i + ((k + 1) % 3)]!;
      if (colOf[v0] === colOf[v1]) continue;
      const lo = v0 < v1 ? v0 : v1, hi = v0 < v1 ? v1 : v0;
      if (uses.get(edgeKey(lo, hi)) !== 1) continue;
      const pl = P(colOf[lo]!, lo - base[colOf[lo]!]!), ph = P(colOf[hi]!, hi - base[colOf[hi]!]!);
      const dx = pt[ph]! - pt[pl]!, dz = pt[ph + 2]! - pt[pl + 2]!;
      const d = dx * dx + dz * dz;
      if (partLv[hi]! < 0 || d < partLd[hi]!) { partLd[hi] = d; partLv[hi] = lo; }
      if (partRv[lo]! < 0 || d < partRd[lo]!) { partRd[lo] = d; partRv[lo] = hi; }
    }
  }

  // the ribbon triangles: per column the stretches of lone rows, each a strip of 4 triangles per row pair plus the joins
  const rtri: number[] = [];
  const taken = new Set<number>();
  for (let c = 0; c < C; c++) {
    const RB_C = (q: number) => base[c]! + q;
    const RB_L = (q: number) => S + 2 * loneIdx[base[c]! + q]!;
    const RB_R = (q: number) => S + 2 * loneIdx[base[c]! + q]! + 1;
    const T = (v0: number, v1: number, v2: number) => { rtri.push(v0, v1, v2); };
    let r = 0;
    while (r < rc2[c]!) {
      if (loneIdx[base[c]! + r]! < 0) { r++; continue; }
      let r1 = r;
      while (r1 + 1 < rc2[c]! && loneIdx[base[c]! + r1 + 1]! >= 0) r1++;
      if (r > 0) { // the top join (the row above's nearest kept neighbours within 2 W)
        const j = base[c]! + r - 1;
        const w = fallRibbonWidth(wf[base[c]! + r]!, spacing);
        const tL = flowAnchor(taken, j, partLv[j]!, partLd[j]!, w);
        const tR = flowAnchor(taken, j, partRv[j]!, partRd[j]!, w);
        if (tL !== j) { T(tL, j, RB_C(r)); T(tL, RB_C(r), RB_L(r)); }
        else T(j, RB_C(r), RB_L(r));
        if (tR !== j) { T(j, tR, RB_R(r)); T(j, RB_R(r), RB_C(r)); }
        else T(j, RB_R(r), RB_C(r));
      }
      for (let i = r; i < r1; i++) {
        T(RB_L(i), RB_C(i), RB_C(i + 1));
        T(RB_L(i), RB_C(i + 1), RB_L(i + 1));
        T(RB_C(i), RB_R(i), RB_R(i + 1));
        T(RB_C(i), RB_R(i + 1), RB_C(i + 1));
      }
      if (r1 < rc2[c]! - 1) { // the bottom join
        const j = base[c]! + r1 + 1;
        const w = fallRibbonWidth(wf[base[c]! + r1]!, spacing);
        const bL = flowAnchor(taken, j, partLv[j]!, partLd[j]!, w);
        const bR = flowAnchor(taken, j, partRv[j]!, partRd[j]!, w);
        T(RB_L(r1), RB_C(r1), j);
        if (bL !== j) T(RB_L(r1), j, bL);
        if (bR !== j) { T(RB_C(r1), RB_R(r1), bR); T(RB_C(r1), bR, j); }
        else T(RB_C(r1), RB_R(r1), j);
      }
      r = r1 + 1;
    }
  }
  const nrt = rtri.length / 3;

  // ---- the slab's back face over every front triangle (sheet and ribbons): the corners' presence air
  const ntotal = S + 2 * nlone;
  let nb = 0, nbt = 0;
  if (C > 2 && st.air) {
    const vair = new Uint8Array(Math.max(1, ntotal)), mark = new Uint8Array(Math.max(1, ntotal));
    for (let c = 0; c < C; c++) for (let r = 0; r < rc2[c]!; r++) vair[base[c]! + r] = st.air[off[c]! + r]!;
    for (let i = 0; i < S; i++) if (loneIdx[i]! >= 0) vair[S + 2 * loneIdx[i]!] = vair[S + 2 * loneIdx[i]! + 1] = vair[i]!;
    for (let i = 0; i < fc.ntri + nrt; i++) {
      const t = i < fc.ntri ? tri : rtri, o = i < fc.ntri ? 3 * i : 3 * (i - fc.ntri);
      if (vair[t[o]!] || vair[t[o + 1]!] || vair[t[o + 2]!]) { mark[t[o]!] = mark[t[o + 1]!] = mark[t[o + 2]!] = 1; nbt++; }
    }
    for (let i = 0; i < ntotal; i++) if (mark[i]) nb++;
  }

  // ---- the foam columns: the live water columns in column order; a run breaks at a live non-foam column or > FALL_SPLIT x spacing (3D) apart
  let runlen = 0, last = -1, foam = 0, ftris = 0, brk = true;
  for (let c = 0; c <= C; c++) {
    if (c < C && merged[c]) continue;
    const water = c < C && st.endk[c] === FALLEND_WATER && st.rows[c]! <= R;
    if (!water) {
      if (runlen >= 2) { foam += 3 * runlen; ftris += 4 * (runlen - 1); }
      runlen = 0; brk = true; last = -1;
      continue;
    }
    if (runlen > 0 && !brk) {
      const a = P(last, sunk[last] ? rc[last]! - 2 : rc[last]! - 1), b = P(c, sunk[c] ? rc[c]! - 2 : rc[c]! - 1);
      const dx = pt[b]! - pt[a]!, dy = pt[b + 1]! - pt[a + 1]!, dz = pt[b + 2]! - pt[a + 2]!;
      if (dx * dx + dy * dy + dz * dz > fc.s2) brk = true;
    }
    if (brk) {
      if (runlen >= 2) { foam += 3 * runlen; ftris += 4 * (runlen - 1); }
      runlen = 1;
    } else runlen++;
    last = c;
    brk = false;
  }
  info.sheet = S; info.ribbon = 2 * nlone; info.foam = foam; info.back = nb;
  info.frontTris = fc.ntri; info.ribbonTris = nrt; info.backTris = nbt; info.foamTris = ftris;
  info.merges = merges; info.splitTris = dropped;

  let wOut: Float64Array | null = null;
  if (wantRow) {
    wOut = new Float64Array(C);
    for (let c = 0; c < C; c++) {
      const wr = wantRow[c]!;
      if (wr >= 0 && wr < rc2[c]! && loneIdx[base[c]! + wr]! >= 0) wOut[c] = fallRibbonWidth(wf[base[c]! + wr]!, spacing);
    }
  }
  return { info, endR, merged, wOut };
}

/** FallFlowMesh: the flow tubes + ribbons of a stat at row cap R (ALL_ROWS uncut); null without path points. `endR` = each column's last row after the merges. */
export function fallFlowMesh(st: FallStat, spacing: number, R: number, ground: FallGround | null): { info: FallFlowInfo; endR: Int32Array } | null {
  const m = flowMeshEx(st, spacing, R, ground);
  return m ? { info: m.info, endR: m.endR } : null;
}

/*
  AirStore: column k's mesh rows' air flags (path rows, then the sink row) at the end of the stat's
  store. The back face goes by the PRESENCE air: the crest row (always 1) takes row 1's flag.
  Traxx 1.8.0: the path points too (FLOW TUBES), at the same index.
*/
function airStore(off: Int32Array, air: number[], pt: number[], k: number, b: ColBuf): void {
  const n = b.n + b.sink, at = air.length;
  for (let r = 0; r < n; r++) air.push(b.air[r]!);
  for (let i = 0; i < 3 * n; i++) pt.push(b.dp[i]!);
  if (n >= 2) air[at] = air[at + 1]!;
  off[k] = at;
}

/*
  FlowPreview: the flow tubes of the 2 ft shape (nothing cut), for the preview: each column's
  merged flag and the ribbon width of its LANDING row (MistVolumes), and the written counts as the
  shape's vertices / back / tris. A fall whose 2 ft grid has more rows than the per-fall vertex
  budget can never be written at 2 ft: it keeps the full-grid counts and no flags.
*/
function flowPreview(out: FallShape): void {
  const st = out.stat[0]!;
  if (!st.pt || st.ncols !== out.ncols || !out.col.length) return;
  let total = 0;
  for (let c = 0; c < st.ncols; c++) total += st.rows[c]!;
  if (total > FALL_AIRCAP) return;
  const want = out.col.map((fc) => ((fc.land ?? -1) >= 1 && (fc.land ?? -1) < fc.n && fc.end !== FALLEND_WATER ? fc.land! : fc.n - 1));
  const m = flowMeshEx(st, 2.0, ALL_ROWS, out.ground ?? null, want);
  if (!m) return;
  for (let c = 0; c < st.ncols; c++) {
    out.col[c]!.merged = m.merged[c] !== 0;
    out.col[c]!.ribw = Math.fround(m.wOut![c]!);
  }
  const fi = m.info;
  out.vertices = fi.sheet + fi.ribbon + fi.foam + fi.back;
  out.back = fi.back;
  out.ribbon = fi.ribbon;
  out.tris = fi.frontTris + fi.ribbonTris + fi.backTris + fi.foamTris;
  out.merges = fi.merges;
  out.splitTris = fi.splitTris;
}

/**
  BuildShape (handover 4.3): the shape of a fall at `height` (raw): the 2 ft columns with their
  rows and the preview's front face, and each spacing's row counts, ends, air flags and path points
  for Budget. DRY when no 2 ft column ends in water. Traxx 1.8.0: the 2 ft counts are the written
  mesh's after the flow tubes (FlowPreview), and the columns carry merged / ribw.
*/
export function buildFallShape(w: TraxxFall, height: number, g: FallGround): FallShape {
  const out = emptyFallShape();
  out.ground = g;
  const c = buildCrest(w, g.cells ?? 256);
  if (c.n < 2 || c.L < 1e-6) return out;
  const pd = crestPointDirs(c);
  out.width = Math.fround(c.L);
  let anywater = false;
  for (let j = 0; j < FALL_NSPACINGS; j++) {
    const sp = SPACINGS[j]!;
    const nc = columnCount(c.L, sp);
    if (nc === 0) continue;
    const st: FallStat = { ncols: nc, rows: new Int32Array(nc), endk: new Uint8Array(nc), off: new Int32Array(nc), air: null, mark: null, pt: null };
    const air: number[] = [], pts: number[] = [];
    out.stat[j] = st;
    const keep: ColBuf[] = [], kdx: number[] = [], kdz: number[] = [];
    if (j === 0) out.ncols = nc;
    for (let k = 0; k < nc; k++) {
      const s = k < nc - 1 ? k * sp : c.L;
      const at = crestAt(c, pd, s);
      const b = newColBuf();
      const r = walkInto(at.x, height * 0.5, at.z, at.dx, at.dz, w.speed / 16.0, w.source, g, sp, b);
      st.rows[k] = r.rows + b.sink; // the sink row (handover 4.4): a water-ending column carries one more mesh row
      st.endk[k] = r.end;
      airStore(st.off!, air, pts, k, b);
      if (j === 0) {
        out.col.push({ n: b.n, p: Float32Array.from(b.p.slice(0, 3 * b.n)), end: r.end, pathlen: Math.fround(r.pathlen), land: r.land, front: null });
        keep[k] = b; kdx[k] = at.dx; kdz[k] = at.dz;
        if (r.end === FALLEND_WATER) anywater = true;
      }
    }
    st.air = Uint8Array.from(air);
    st.pt = Float64Array.from(pts);
    st.mark = new Uint8Array(air.length > 0 ? air.length : 1);
    // the preview's front face (handover 4.6): the path pushed out by the slab thickness
    if (j === 0) slabFront(keep, nc, kdx, kdz, c.P[0]![0], c.P[0]![1], height * 0.5, w.speed / 16.0, out);
  }
  if (out.ncols > 0 && !anywater) out.warn |= FALLWARN_DRY;
  // the vertex count at 2 ft with nothing cut (Budget replaces it), the back face included
  if (out.ncols > 0) {
    const t = totals2(out.stat[0]!, ALL_ROWS);
    out.vertices = Math.trunc(t.total); out.back = t.back; out.tris = t.tris;
    flowPreview(out); // the written mesh of the flow tubes at 2 ft, and the landing flags
  }
  return out;
}

/** What FitFall settles on: the WRITTEN mesh's counts (sheet | ribbons | foam | back) and the spacing. */
export interface FallFit {
  verts: number;
  back: number;
  tris: number;
  ribbon: number;
  merges: number;
  splitTris: number;
  spacing: number;
  shortened: boolean;
}

/**
  FitFall (fall_build_stats, Traxx 1.8.0): the first spacing 2, 3, 4, 6, 8 ft at which the fall's
  FULL GRID fits `budget` vertices and `idxBudget` indices; failing that every column cut to a
  common row count (the largest that fits, by bisection). Then the WRITTEN mesh (the flow tubes) is
  built; if it exceeds the vertex or index budget (or the air store) every column is cut to
  R' = min(R - 1, floor(R x vcap / verts), floor(R x (idx / 3) / tris)) and it is built again; at
  R = 2 it is refused. Null when it does not fit at all. A hand-built stat (no path points) has no
  flow tubes: its written mesh is the full grid.
*/
export function fitFall(s: FallShape, budget: number, idxBudget = FALL_IDX_UNLIMITED): FallFit | null {
  let last = -1, found = false, R = ALL_ROWS;
  for (let j = 0; j < FALL_NSPACINGS; j++) {
    const sj = s.stat[j]!;
    if (sj.ncols === 0) continue;
    last = j;
    let sumrows = 0;
    for (let c = 0; c < sj.ncols; c++) sumrows += sj.rows[c]!;
    if (sumrows <= FALL_AIRCAP) {
      const t = totals2(sj, ALL_ROWS);
      if (t.total <= budget && t.tris * 3 <= idxBudget) { found = true; break; }
    }
  }
  if (last < 0) return null;
  const st = s.stat[last]!;
  const spacing = SPACINGS[last]!;
  let shortened = false;
  if (!found) {
    let sumrows = 0;
    for (let c = 0; c < st.ncols; c++) sumrows += st.rows[c]! < 2 ? st.rows[c]! : 2;
    if (sumrows > FALL_AIRCAP) return null;
    // the largest cap whose sheet rows fit the air store
    let a = 2, b = 2;
    for (let c = 0; c < st.ncols; c++) if (st.rows[c]! > b) b = st.rows[c]!;
    while (a < b) {
      const mid = a + Math.trunc((b - a + 1) / 2);
      let sum = 0;
      for (let c = 0; c < st.ncols; c++) sum += st.rows[c]! < mid ? st.rows[c]! : mid;
      if (sum <= FALL_AIRCAP) a = mid;
      else b = mid - 1;
    }
    const t2 = totals2(st, 2);
    if (t2.total > budget || t2.tris * 3 > idxBudget) return null;
    let lo = 2, hi = a;
    while (lo < hi) {
      const mid = lo + Math.trunc((hi - lo + 1) / 2);
      const t = totals2(st, mid);
      if (t.total <= budget && t.tris * 3 <= idxBudget) lo = mid;
      else hi = mid - 1;
    }
    R = lo;
    shortened = true;
  }
  if (!st.pt) {
    // no path points (a hand-built stat): nothing flows, the written mesh is the full grid at R
    const t = totals2(st, R);
    return { verts: Math.trunc(t.total), back: t.back, tris: t.tris, ribbon: 0, merges: 0, splitTris: 0, spacing, shortened };
  }
  // THE WRITTEN BUDGET: re-cut until the written mesh fits.
  for (;;) {
    const m = flowMeshEx(st, spacing, R, s.ground ?? null);
    if (!m) return null;
    const fi = m.info;
    const nv = fi.sheet + fi.ribbon + fi.foam + fi.back;
    const nt = fi.frontTris + fi.ribbonTris + fi.backTris + fi.foamTris;
    const over = fi.sheet + fi.ribbon > FALL_AIRCAP;
    if (!over && nv <= budget && nt * 3 <= idxBudget) {
      return { verts: nv, back: fi.back, tris: nt, ribbon: fi.ribbon, merges: fi.merges, splitTris: fi.splitTris, spacing, shortened };
    }
    let rcur: number;
    if (R < ALL_ROWS) rcur = R;
    else { rcur = 0; for (let c = 0; c < st.ncols; c++) if (st.rows[c]! > rcur) rcur = st.rows[c]!; }
    let nr = rcur - 1;
    const aa = Math.floor((rcur * budget) / (over ? FALL_AIRCAP + 1.0 : nv));
    if (aa < nr) nr = aa;
    if (idxBudget < FALL_IDX_UNLIMITED) {
      const b2 = Math.floor((rcur * Math.trunc(idxBudget / 3)) / (nt > 0 ? nt : 1));
      if (b2 < nr) nr = b2;
    }
    if (rcur <= 2) return null;
    R = nr > 2 ? nr : 2;
    shortened = true;
  }
}

/**
  Budget (handover 4.4) over all falls in file order: sets vertices / spacing and COARSE /
  SHORTENED / DROPPED (and DRY at the spacing used). A fall with errors (nobudget, set by the
  caller) is refused by the engine: it keeps its shape and its own 2 ft count but takes no room and
  shows none of the shape warnings. Traxx 1.8.0: the written mesh (flow tubes) and the track's
  INDEX budget (6 x 262 144, each fall what is left). Returns the vertices the kept falls use.
*/
export function fallBudget(shapes: FallShape[]): number {
  let track = 0, trackIdx = 0;
  for (const s of shapes) {
    if (s.nobudget) {
      s.warn &= ~(FALLWARN_DRY | FALLWARN_COARSE | FALLWARN_SHORTENED | FALLWARN_DROPPED);
      s.spacing = 2.0;
      continue;
    }
    s.warn &= ~(FALLWARN_COARSE | FALLWARN_SHORTENED | FALLWARN_DROPPED);
    s.spacing = 2.0;
    s.vertices = 0; s.back = 0; s.tris = 0; s.ribbon = 0; s.merges = 0; s.splitTris = 0;
    let room = FALL_VERTS_PER_TRACK - track;
    if (room > FALL_VERTS_PER_FALL) room = FALL_VERTS_PER_FALL;
    if (s.stat.every((st) => st.ncols === 0)) continue; // no usable crest: nothing to draw
    const fit = fitFall(s, room, FALL_IDX_PER_TRACK - trackIdx);
    if (fit) {
      const jn = SPACINGS.indexOf(fit.spacing as 2);
      let water = 0;
      for (let j = 0; j < s.stat[jn]!.ncols; j++) if (s.stat[jn]!.endk[j] === FALLEND_WATER) water++;
      // DRY is judged at the spacing the engine will use
      s.warn &= ~FALLWARN_DRY;
      if (water === 0) s.warn |= FALLWARN_DRY;
      s.spacing = fit.spacing;
      s.vertices = fit.verts; s.back = fit.back; s.tris = fit.tris; s.ribbon = fit.ribbon; s.merges = fit.merges; s.splitTris = fit.splitTris;
      if (fit.spacing > 2.0) s.warn |= FALLWARN_COARSE;
      if (fit.shortened) s.warn |= FALLWARN_SHORTENED;
      track += fit.verts;
      trackIdx += 3 * fit.tris;
    } else {
      s.warn |= FALLWARN_DROPPED;
      s.warn &= ~FALLWARN_DRY; // check_wfl: a dropped fall has no DRY
      // what it would use with the whole per-fall budget (0 if even that is not enough)
      const whole = fitFall(s, FALL_VERTS_PER_FALL, FALL_IDX_PER_TRACK);
      if (whole) {
        s.vertices = whole.verts; s.back = whole.back; s.tris = whole.tris; s.ribbon = whole.ribbon; s.merges = whole.merges; s.splitTris = whole.splitTris;
        s.spacing = whole.spacing;
      }
    }
  }
  return track;
}

/**
  LandContinuous (cursh2 FallShape.cpp landContinuous): true when the landing is continuous along
  the straight horizontal segment between landing points a and b (x, y, z feet, unwrapped; the
  callbacks get wrapped coordinates). N = ceil(length / 1 ft) samples at t = k / N, k = 1..N - 1.
  wet: every sample has a water surface (any body, the fall's own source passed as the stepper
  does) above the ground; dry: every sample's ground is <= lerp(y_a, y_b, t) + FALL_LAND_RISE.
*/
export function landContinuous(a: ArrayLike<number>, b: ArrayLike<number>, wet: boolean, source: number, g: FallGround): boolean {
  const W = fallWorldFt(g.cells ?? 256);
  const dx = b[0]! - a[0]!, dz = b[2]! - a[2]!;
  const n = Math.ceil(Math.sqrt(dx * dx + dz * dz));
  for (let k = 1; k < n; k++) {
    const t = k / n, x = a[0]! + dx * t, z = a[2]! + dz * t;
    const gr = groundAt(g, x, z);
    if (wet) {
      const surf = g.water ? g.water(wrapFt(x, W), wrapFt(z, W), source) : null;
      if (surf === null || !(surf > gr)) return false;
    } else if (gr > a[1]! + (b[1]! - a[1]!) * t + FALL_LAND_RISE) return false;
  }
  return true;
}

/**
  MistVolumes: the engine's mist boxes (wfRegisterMist) for the preview, ONE PER STREAM (handover
  4.3; cursh2 2772d09 / d93677c / 3298507 / e27a06a / f953888), in column order, at most
  FALL_MAX_LANDINGS; none when the mist is 0. Each box is [x, floorY, z, W, L, H, fx, fz] in feet,
  in the shape's unwrapped frame, then (Traxx 1.8.0) [8] the stream's mean drop in feet and [9]
  its live column count, which MistFog (wfRegisterMist's density) needs. Traxx 1.8.0: over the
  LIVE columns only (a merged column is no landing candidate), and a one-column landing on a lone
  row is the ribbon's W wide.

    - A column's landing point: a water column's last written row; a dry column's landing row
      (FallColumn.land: the touchdown of a FALL, the run-out start of a SLIDE), else its last row.
    - Candidates: the water-ending columns if any column ends in water, else every column.
    - Groups in column order; a new group starts at a non-candidate column between two candidates,
      or where the landing between two neighbouring candidates is not continuous (landContinuous).
    - Each group from its OWN columns: dir = the normalised mean of the columns' last horizontal
      steps INTO the landing row (else the crest's mean flow direction, else (0, 1)); width = the
      extent of its landing points across dir + one column spacing; the point the middle of that
      extent at the mean along position; y and drop the means.
    - At most 4 groups: the most columns first (a tie to the lower first column), then column order.
    - The box: H = 0.7 drop (<= 120) x the mist height %, <= 240; W = width + 2 clamp(0.05 drop + 2,
      2, 6), at least 6; L = 0.6 drop, at least 20, x the mist depth %; the centre 0.3 L along dir.

  The engine measures at its budget spacing; this uses the 2 ft columns (Traxx's tolerance).
*/
export function mistVolumes(w: TraxxFall, height: number, s: FallShape, g: FallGround): number[][] {
  if (w.mist === 0 || s.ncols < 1 || !s.col.length) return [];
  // FLOW TUBES (Traxx 1.8.0, handover 4.7): a column that merged into a neighbour is no landing candidate, and not
  // "between" two candidates either. Everything below runs over the LIVE columns in column order: lv[k] = the k-th one.
  const lv: number[] = [];
  for (let k = 0; k < s.ncols; k++) if (!s.col[k]?.merged) lv.push(k);
  const C = lv.length;
  if (C < 1) return [];
  const crest = height * 0.5, spacing = FALL_ROW_SPACING;
  const rowOf = (c: FallColumn) => ((c.land ?? -1) >= 1 && (c.land ?? -1) < c.n && c.end !== FALLEND_WATER ? c.land! : c.n - 1);
  const landOf = (k: number): Float32Array | null => {
    const c = s.col[lv[k]!];
    if (!c || c.n < 1 || !c.p) return null;
    const r = rowOf(c);
    return c.p.subarray(3 * r, 3 * r + 3);
  };
  let nvalid = 0, anywater = false;
  for (let k = 0; k < C; k++) { if (!landOf(k)) continue; nvalid++; if (s.col[lv[k]!]!.end === FALLEND_WATER) anywater = true; }
  if (nvalid === 0) return [];
  // the candidates: the water columns if any column ends in water, else every column (no drop filter)
  const cand = new Uint8Array(C);
  for (let k = 0; k < C; k++) if (landOf(k)) cand[k] = anywater ? (s.col[lv[k]!]!.end === FALLEND_WATER ? 1 : 0) : 1;
  // the groups, in column order
  const g0: number[] = [], g1: number[] = [];
  for (let k = 0; k < C;) {
    if (!cand[k]) { k++; continue; }
    let e = k;
    while (e + 1 < C) {
      if (!cand[e + 1]) break; // a non-candidate between
      if (!landContinuous(landOf(e)!, landOf(e + 1)!, anywater, w.source, g)) break; // the landing between them breaks
      e++;
    }
    g0.push(k); g1.push(e);
    k = e + 1;
  }
  // keep the FALL_MAX_LANDINGS largest (a tie: the lower first column), then back into column order
  let keep: number[];
  if (g0.length <= FALL_MAX_LANDINGS) keep = g0.map((_, q) => q);
  else {
    const used = new Uint8Array(g0.length);
    keep = [];
    for (let nk = 0; nk < FALL_MAX_LANDINGS; nk++) {
      let b = -1;
      for (let q = 0; q < g0.length; q++) if (!used[q] && (b < 0 || g1[q]! - g0[q]! > g1[b]! - g0[b]!)) b = q;
      used[b] = 1;
      keep.push(b);
    }
    keep.sort((a, b) => a - b);
  }
  let cfx = 0, cfz = 0, crestdone = false;
  const out: number[][] = [];
  const f = Math.fround;
  for (const q of keep) {
    const a = g0[q]!, b = g1[q]!, n = b - a + 1;
    let sy = 0, sdrop = 0, fx = 0, fz = 0;
    for (let j = a; j <= b; j++) {
      const c = s.col[lv[j]!]!, r = rowOf(c), pe = 3 * r;
      sy += c.p[pe + 1]!;
      sdrop += crest - c.p[pe + 1]!;
      if (r >= 1) { // the horizontal step INTO the landing row, normalised (row 0 has none)
        const dx = c.p[pe]! - c.p[pe - 3]!, dz = c.p[pe + 2]! - c.p[pe - 1]!, l = Math.sqrt(dx * dx + dz * dz);
        if (l > 1e-6) { fx += dx / l; fz += dz / l; }
      }
    }
    let len = Math.sqrt(fx * fx + fz * fz);
    if (len < 1e-6) {
      // no landing direction: the crest's mean flow direction (the points' directions, as FallShape's cr.dx)
      if (!crestdone) {
        const cr = buildCrest(w, g.cells ?? 256);
        if (cr.n >= 2) { const pd = crestPointDirs(cr); for (let k = 0; k < cr.n; k++) { cfx += pd[k]![0]; cfz += pd[k]![1]; } }
        crestdone = true;
      }
      fx = cfx; fz = cfz;
      len = Math.sqrt(fx * fx + fz * fz);
    }
    if (len < 1e-6) { fx = 0.0; fz = 1.0; len = 1.0; } // the last fallback, (0, 1)
    fx /= len;
    fz /= len;
    let aclo = 1e30, achi = -1e30, alsum = 0;
    for (let j = a; j <= b; j++) {
      const pe = landOf(j)!;
      const ac = -fz * pe[0]! + fx * pe[2]!, al = fx * pe[0]! + fz * pe[2]!;
      if (ac < aclo) aclo = ac;
      if (ac > achi) achi = ac;
      alsum += al;
    }
    const ac = 0.5 * (aclo + achi), al = alsum / n;
    let landw = achi - aclo + spacing;
    // RIBBONS (handover 4.7): a one-column landing on a lone row is the ribbon's W wide, not one spacing
    if (a === b && (s.col[lv[a]!]!.ribw ?? 0) > 0.0) landw = s.col[lv[a]!]!.ribw!;
    const sx = al * fx - ac * fz, sz = al * fz + ac * fx;
    sy /= n;
    const dropft = sdrop / n;
    let H = 0.7 * dropft;
    if (H > 120.0) H = 120.0;
    H = (H * w.mistheight) / 100.0;
    if (H > 240.0) H = 240.0;
    // the mist reaches a few feet past the stream on each side (cursh2 d702f82), 2..6 ft growing with the drop
    let m = 0.05 * dropft + 2.0;
    if (m < 2.0) m = 2.0;
    if (m > 6.0) m = 6.0;
    let W = landw + 2.0 * m;
    if (W < 6.0) W = 6.0;
    let L = 0.6 * dropft;
    if (L < 20.0) L = 20.0;
    L = (L * w.mistdepth) / 100.0;
    // [8] the stream's mean drop (dropftOut) and [9] its live columns (columnsOut, the engine's ln->columns), Traxx 1.8.0
    out.push([f(sx + 0.3 * L * fx), f(sy - 2.0), f(sz + 0.3 * L * fz), f(W), f(L), f(H), f(fx), f(fz), f(dropft), n]);
  }
  return out;
}


// ---- The view's helpers (Traxx/TraxxViewFalls.cpp) ----

/** FallUnwrap: the crest points in feet unwrapped from point 0, each step the shortest wrapped difference (at W). */
export function fallUnwrap(w: TraxxFall, n: number, cells = 256): { px: number[]; pz: number[] } {
  const { W, U } = wd(cells), H = W / 2;
  let x = (w.pt[0]![0] & (U - 1)) / 16.0, z = (w.pt[0]![1] & (U - 1)) / 16.0;
  const px = [Math.fround(x)], pz = [Math.fround(z)];
  for (let k = 1; k < n; k++) {
    let dx = (w.pt[k]![0] - w.pt[k - 1]![0]) / 16.0, dz = (w.pt[k]![1] - w.pt[k - 1]![1]) / 16.0;
    dx -= W * Math.floor((dx + H) / W);
    dz -= W * Math.floor((dz + H) / W);
    x += dx; z += dz;
    px.push(Math.fround(x)); pz.push(Math.fround(z));
  }
  return { px, pz };
}

/**
  FallPickSource: the source of a new crest, the HIGHEST lake within 48 ft of any crest point (a
  point on a lake tile is distance 0), the nearer on equal heights; 0 for none (a spring). Also
  the height, the lake's.
*/
export function fallPickSource(lakes: FallLakes, pts: readonly [number, number][], n: number): { source: number; height: number } {
  let source = 0, best = 48.0 + 1e-6;
  const tmap = lakes.tmap, nl = lakes.lakes.length;
  if (!tmap) return { source: 0, height: 0 };
  const { M, SH } = wd(mapCells(tmap));
  for (let k = 0; k < n; k++) {
    const px = pts[k]![0] / 16.0, pz = pts[k]![1] / 16.0;
    const ptx = Math.floor(px / 32.0), ptz = Math.floor(pz / 32.0);
    for (let dtz = -2; dtz <= 2; dtz++) {
      for (let dtx = -2; dtx <= 2; dtx++) {
        const tx = ptx + dtx, tz = ptz + dtz;
        const lake = tmap[(tx & M) + ((tz & M) << SH)]!;
        if (lake < 1 || lake > nl) continue;
        const cx = px < 32.0 * tx ? 32.0 * tx - px : px > 32.0 * tx + 32.0 ? px - (32.0 * tx + 32.0) : 0.0;
        const cz = pz < 32.0 * tz ? 32.0 * tz - pz : pz > 32.0 * tz + 32.0 ? pz - (32.0 * tz + 32.0) : 0.0;
        const d = Math.sqrt(cx * cx + cz * cz);
        if (d > 48.0) continue;
        const lh = lakes.lakes[lake - 1]!.height;
        if (source === 0 || lh > lakes.lakes[source - 1]!.height || (lh === lakes.lakes[source - 1]!.height && d < best)) { best = d; source = lake; }
      }
    }
  }
  return { source, height: source ? lakes.lakes[source - 1]!.height : 0 };
}

/**
  The spring height of a new crest: on the ground at its first point (ceil(ground * 2) + 1), 1..4096
  (`bounds`: a version 6 track's, fallHeightBounds).
*/
export function fallSpringHeight(g: FallGround | null, x0: number, z0: number, bounds: { min: number; max: number } = { min: 1, max: 4096 }): number {
  let height = g ? Math.ceil(g.height(x0, z0) * 2.0) + 1 : bounds.min;
  if (height < bounds.min) height = bounds.min;
  if (height > bounds.max) height = bounds.max;
  return height;
}

/**
  MistRegistered (Traxx 1.8.0, 35b087b): the engine registers mist for a fall with no errors, mist
  not 0, 2 columns or more, and not DROPPED for the track's vertex budget.
*/
export function fallMistRegistered(w: TraxxFall, err: number, s: FallShape): boolean {
  return err === 0 && w.mist !== 0 && s.ncols >= 2 && (s.warn & FALLWARN_DROPPED) === 0;
}

/**
  MistLandings (Traxx 1.8.0, 13507dc): the mist volumes each fall registers (the input of the 64
  shared fog slots, preflight.ts engineFogSlotOverflow): mistVolumes for a fall the engine
  registers, 0 otherwise and for all when there is no ground. `err` and `shapes` are per fall in
  file order, the shapes already through fallBudget. Shared by the Waterfall window's Problems
  list and the Write POD pre-flight, so they cannot drift.
*/
export function fallMistLandings(falls: readonly TraxxFall[], lakes: readonly { height: number }[], err: readonly number[], shapes: readonly FallShape[], g: FallGround | null): number[] {
  const n = Math.min(falls.length, FALL_MAX_FALLS, err.length, shapes.length);
  const out = new Array<number>(Math.min(falls.length, FALL_MAX_FALLS)).fill(0);
  if (!g) return out;
  for (let f = 0; f < n; f++) {
    if (!fallMistRegistered(falls[f]!, err[f]!, shapes[f]!)) continue;
    out[f] = mistVolumes(falls[f]!, fallEffectiveHeight(falls, f, lakes), shapes[f]!, g).length;
  }
  return out;
}

/** The objects with a continuous sound (the '@' blocks): first in the engine's 30 looping sounds. */
export function fallLoopingObjects(boxes: readonly { soundCont: string }[]): number {
  return boxes.filter((b) => b.soundCont !== "" && b.soundCont.toUpperCase() !== "NULL.WAV").length;
}

/** The errors that make a shape meaningless: no shape is built for such a fall (TraxxViewFalls.cpp FALL_SHAPE_ERRORS). */
export const FALL_SHAPE_ERRORS = FALLERR_POINTS | FALLERR_TURN | FALLERR_WIDTH | FALLERR_COORD | FALLERR_SOURCE | FALLERR_HEIGHT | FALLERR_SPEED | FALLERR_COUNT;

// ---- .WFL (handover section 6), through OpenPhotex ----

/**
  BuildWFL: the .WFL image, heights from EffectiveHeight; null when there are no falls or any has
  an error (names judged with namecheck; null = not looked up).

  Track format version 6 (spec 9.3): the world's size picks the version. A 512-cell world gets
  writeWfl(..., { cells: 512 }), version 2 (a 512 x 512 header, i32 heights, points below 16 W);
  every 256-cell track's file is version 1, Traxx's, byte for byte.
*/
export function buildWfl(falls: readonly TraxxFall[], lakes: FallLakes, namecheck: FallNameCheck = null): Uint8Array | null {
  if (!falls.length || falls.length > FALL_MAX_FALLS) return null;
  for (let i = 0; i < falls.length; i++) if (fallErrors(falls, i, lakes, namecheck) !== 0) return null;
  // A 512 world writes version 2; a 256 v6 world version 1, its falls in the engine's window of its step and base too
  // (OpenPhotex heightWindow, Traxx origin/main LakeHeightWindowFor).
  const w6 = lakes.world && lakes.world.cells === 512 ? { cells: 512 } : lakes.world?.terrain ? { cells: 256, heightWindow: lakes.world.terrain } : undefined;
  try {
    return writeWflOf(falls, lakes, w6);
  } catch (e) {
    // writeWfl refuses what the file cannot hold (a version 1 height outside 0..4096): no item then.
    if (e instanceof RangeError) return null;
    throw e;
  }
}

function writeWflOf(falls: readonly TraxxFall[], lakes: FallLakes, w6: { cells: number; heightWindow?: { step: number; base: number } } | undefined): Uint8Array {
  return writeWfl(falls.map((w, i) => ({
    // flags: bits 0..2 only, the rest 0 (handover 6.1); roughFrom makes the record v1.1 when not 0.
    source: w.source, flags: w.flags & 7, speed: w.speed, height: fallEffectiveHeight(falls, i, lakes.lakes),
    points: w.pt.slice(0, Math.min(w.npoints, FALL_MAX_POINTS)).map(([x, z]) => ({ x, z })),
    opacity: w.opacity, mist: w.mist, volume: w.volume, mistDepth: w.mistdepth, mistHeight: w.mistheight, roughFrom: w.roughfrom & 255,
    soundName: w.sound.slice(0, FALL_NAMELEN - 1), textureName: w.texture.slice(0, FALL_NAMELEN - 1),
  })), w6);
}

/**
  ParseWFL: the falls of a .WFL, or null when the file is refused (Traxx then has no falls).

  Track format version 6 (spec 9.3): with `cells`, the worldCells of a .SI3 track, versions 1 and
  2 are read and the header must be N x N (a version 1 file is 256 x 256; parseWfl refuses one
  authored for another terrain size). Without `cells` it is Traxx's reader: version 1, 256 x 256.
*/
export function parseWflFalls(bytes: Uint8Array, cells?: number): TraxxFall[] | null {
  if (!isWfl(bytes)) return null;
  let wfl;
  try { wfl = cells === undefined ? parseWfl(bytes) : parseWfl(bytes, { cells }); } catch { return null; }
  if (cells === undefined && (wfl.major !== 1 || wfl.cells !== 256)) return null;
  return wfl.falls.map((f) => {
    const w = fallDefaults();
    w.source = f.source;
    w.npoints = f.points.length;
    w.flags = f.flags;
    w.speed = f.speed;
    w.height = f.height | 0;
    f.points.forEach((p, k) => { w.pt[k] = [p.x | 0, p.z | 0]; });
    w.opacity = f.opacity; w.mist = f.mist; w.volume = f.volume;
    w.mistdepth = f.mistDepth; w.mistheight = f.mistHeight;
    // kept raw: 251..254 is reported by Errors (FALL_ROUGH)
    w.roughfrom = f.roughFrom & 255;
    w.sound = f.soundName; w.texture = f.textureName;
    return w;
  });
}

/** Said on opening a .SI3 track whose .WFL is refused (spec 9.3); the track then has no falls, as Traxx. */
export const FALLS_WFL_REFUSED = "The waterfalls (.WFL) of this track could not be read: the file is damaged, needs a newer build, or was authored for a different terrain size. The track has no waterfalls.";

/** The pod's report when the waterfalls cannot be packed (CTrackPOD::Save). */
export const FALLS_NOT_SAVED = "The waterfalls could not be written into the pod (the name does not fit a pod entry, a waterfall is in error, or its lake is in error).\n\nThe pod was saved WITHOUT its waterfalls. Fix them and save again.";
