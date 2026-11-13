/*
  WATERFALLS (Traxx 1.7.1: Include/TrackPODFalls.h, TrackPOD/TrackPODFalls.cpp, and the pod's
  FallGroundFor / FallNameInPod / UpdateLakeNotches in TrackPOD/TrackPOD.cpp): a sheet of water
  that pours over a crest line, written into the pod as WORLD\<stem>.WFL (through OpenPhotex's
  writeWfl) and into the .TXX as the V18 block (txx.ts).

  Ported 1:1, constants and integer rules included. The shape is Traxx's port of the engine's
  reference (wtr_check.py: Crest.at, make_cols, walk_column, _totals, fall_build_stats; the
  Classic ground is ground_raw = groundHeight1). Plain data, no DOM.

  UNITS.
    - Crest points are stored in 1/16 ft, 0..131071 (the world is 8192 ft square and wraps).
    - speed is 1/16 ft/s (6 ft/s = 96); height is a raw water unit (0.5 ft), like a lake's.
    - The shaper works in FEET: the ground callbacks get x / z in [0, 8192), heights are feet, and
      the column points are feet UNWRAPPED from crest point 0.

  THE DERIVED-HEIGHT RULE. A fall with source n (a lake index + 1) has no height of its own: its
  height is the lake's, everywhere (fallEffectiveHeight). `height` is used only for a spring.
*/
import type { LakeGround } from "./surface.ts";
import { surfaceFeet, cornerV } from "./surface.ts";
import { syncFromRaw, TERRAINMODE_CLASSIC8, TERRAINMODE_CLASSIC16, TERRAINMODE_FINE, TERRAINMODE_SPLINE, type Terrain16 } from "./terrain16.ts";
import {
  heightLevel, levelUnit, pointLevel, pointStep,
  LAKE_LIP_E, LAKE_LIP_N, LAKE_LIP_NE, LAKE_LIP_NW, LAKE_LIP_S, LAKE_LIP_SE, LAKE_LIP_SW, LAKE_LIP_W,
} from "./lake-ground.ts";
import { cG } from "./veg.ts";
import { parseWfl, writeWfl, isWfl } from "../../vendor/openphotex/mtm/wfl.js";

export const FALL_MAX_FALLS = 64;
export const FALL_MAX_POINTS = 8;
/** char[16]: at most 15 characters and the NUL. */
export const FALL_NAMELEN = 16;
export const FALL_COORD_MAX = 131071;
export const FALL_WORLD_FT = 8192;

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
export const FALL_NSPACINGS = 5;
/** FALL_MAX_COLS: the engine builds no sheet with more columns at a spacing. */
export const FALL_MAX_COLS = 1100;
export const FALL_VERTS_PER_FALL = 16384;
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
  /** Stems, at most 15 characters. */
  sound: string;
  texture: string;
}

/** The lakes a fall reads: the authored list (heights) and the derived tile map. */
export interface FallLakes {
  lakes: readonly { height: number }[];
  tmap: Uint8Array | null;
}

/** The name check Errors and BuildWFL take: kind 0 a sound stem, 1 a texture stem; null = names are not checked. */
export type FallNameCheck = ((kind: number, stem: string) => boolean) | null;

/**
  The world a fall's shape is computed in (FallGround): heights in feet at world feet x / z in
  [0, 8192), and the water surface the column could land in, excluding `source` (null = none).
*/
export interface FallGround {
  height: (x: number, z: number) => number;
  water: ((x: number, z: number, source: number) => number | null) | null;
}

/** One column of the sheet: n rows of x, y, z feet (unwrapped from crest point 0). */
export interface FallColumn {
  n: number;
  p: Float32Array;
  end: number;
  pathlen: number;
}

/** What Budget needs of a fall at a spacing: each column's row count and end kind (ncols 0 = no sheet). */
export interface FallStat {
  ncols: number;
  rows: Int32Array;
  endk: Uint8Array;
}

export interface FallShape {
  ncols: number;
  col: FallColumn[];
  width: number;
  vertices: number;
  spacing: number;
  warn: number;
  stat: FallStat[];
}

/** The numbers behind the notch warnings. */
export interface FallNotchWarn {
  h: number;
  climb: number;
  hint4: boolean;
  flatdeg: number;
}

const emptyStat = (): FallStat => ({ ncols: 0, rows: new Int32Array(0), endk: new Uint8Array(0) });
export function emptyFallShape(): FallShape {
  return { ncols: 0, col: [], width: 0, vertices: 0, spacing: 2, warn: 0, stat: Array.from({ length: FALL_NSPACINGS }, emptyStat) };
}

// ---- The list ----

/** Defaults: speed 96, opacity 85, mist 100, volume 100, mist depth / height 100, FREEZE | SPLASH | SOUND, height 0. */
export function fallDefaults(): TraxxFall {
  return {
    source: 0, npoints: 0, flags: FALLFLAG_FREEZE | FALLFLAG_SPLASH | FALLFLAG_SOUND, speed: 96, height: 0,
    pt: Array.from({ length: FALL_MAX_POINTS }, () => [0, 0] as [number, number]),
    opacity: 85, mist: 100, volume: 100, mistdepth: 100, mistheight: 100, sound: "", texture: "",
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

/* Red: into 0..131071. */
function red(v: number): number {
  v %= 131072;
  if (v < 0) v += 131072;
  return v;
}

/** WrapDiff: the shortest wrapped difference b - a, in 1/16 ft (-65536..65535). */
export function wrapDiff(b: number, a: number): number {
  return red(red(b) - red(a) + 65536) - 65536;
}

/* WrapFt: into [0, 8192). */
function wrapFt(v: number): number {
  v %= FALL_WORLD_FT;
  if (v < 0) v += FALL_WORLD_FT;
  if (v >= FALL_WORLD_FT) v = 0;
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

function buildCrest(w: TraxxFall): Crest {
  const c: Crest = {
    n: 0, P: Array.from({ length: FALL_MAX_POINTS }, () => [0, 0] as [number, number]), dx: new Array(FALL_MAX_POINTS).fill(0),
    dz: new Array(FALL_MAX_POINTS).fill(0), len: new Array(FALL_MAX_POINTS).fill(0),
    dir: Array.from({ length: FALL_MAX_POINTS }, () => [0, 0] as [number, number]), cum: new Array(FALL_MAX_POINTS).fill(0), L: 0,
  };
  let n = w.npoints;
  if (n > FALL_MAX_POINTS) n = FALL_MAX_POINTS;
  if (n < 2) return c;
  c.n = n;
  c.P[0] = [red(w.pt[0]![0]) / 16.0, red(w.pt[0]![1]) / 16.0];
  for (let k = 0; k + 1 < n; k++) {
    c.dx[k] = wrapDiff(w.pt[k + 1]![0], w.pt[k]![0]);
    c.dz[k] = wrapDiff(w.pt[k + 1]![1], w.pt[k]![1]);
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
export function crestLength(w: TraxxFall): number {
  return Math.fround(buildCrest(w).L);
}

/** PointDirection (4.1): the unit (x, z) flow direction at crest point k. */
export function pointDirection(w: TraxxFall, k: number): [number, number] {
  const pd = crestPointDirs(buildCrest(w));
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

/* NudgeInto: crest point k moved 0.5 ft into segment k (forward) or k - 1 (backward). */
function nudgeInto(c: Crest, k: number, forward: boolean): [number, number] {
  const j = forward ? k : k - 1;
  let px = c.P[k]![0], pz = c.P[k]![1];
  if (j < 0 || j >= c.n - 1) return [px, pz];
  const ex = c.P[j + 1]![0] - c.P[j]![0], ez = c.P[j + 1]![1] - c.P[j]![1];
  const l = Math.sqrt(ex * ex + ez * ez);
  if (l < 1e-12) return [px, pz];
  px += ((forward ? 0.5 : -0.5) * ex) / l;
  pz += ((forward ? 0.5 : -0.5) * ez) / l;
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
  /** Notch tile and lake tile, tx + (tz << 8), wrapped. */
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
function notchCols(w: TraxxFall): NotchCol[] {
  const n = w.npoints;
  if (w.source === 0 || n < 2 || n > FALL_MAX_POINTS) return [];
  for (let k = 0; k < n; k++) {
    if (w.pt[k]![0] < 0 || w.pt[k]![0] > FALL_COORD_MAX || w.pt[k]![1] < 0 || w.pt[k]![1] > FALL_COORD_MAX) return [];
  }
  const c = buildCrest(w);
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
    const q: NotchCol = { n: (nxu & 255) + ((nzu & 255) << 8), k: (kxu & 255) + ((kzu & 255) << 8), corner: 0, lip: 0, edge: false, axis: 0, line: 0, tile: 0, along: 0 };
    // 4-adjacent on the wrapping map?  Which edge of the notch tile faces the lake tile?
    const ddx = ((nxu - kxu + 128) & 255) - 128, ddz = ((nzu - kzu + 128) & 255) - 128;
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
export function buildNotches(falls: readonly TraxxFall[]): { notchlake: Uint8Array; lipedges: Uint8Array; notchfall: Uint8Array; tiles: number } {
  const notchlake = new Uint8Array(65536), lipedges = new Uint8Array(65536), notchfall = new Uint8Array(65536);
  let tiles = 0;
  for (let i = 0; i < falls.length && i < FALL_MAX_FALLS; i++) {
    const f = falls[i]!;
    for (const q of notchCols(f)) {
      if (notchlake[q.n] === 0) { notchlake[q.n] = f.source & 255; tiles++; notchfall[q.n] = i + 1; }
      if (notchlake[q.n] === (f.source & 255)) lipedges[q.n] |= q.lip | q.corner;
    }
  }
  return { notchlake, lipedges, notchfall, tiles };
}

/**
  UpdateLakeNotches: the lakes' notch input from a track's falls (null for none: no falls, or none
  with a lake). Call it right before every lake recompute; a fall edit changes the lakes.
*/
export function trackNotches(t: { falls?: readonly TraxxFall[] }): { notchlake: Uint8Array; lips: Uint8Array; hasnotch: Uint8Array } | null {
  if (!t.falls || !t.falls.length) return null;
  const { notchlake, lipedges, tiles } = buildNotches(t.falls);
  if (tiles <= 0) return null;
  const hasnotch = new Uint8Array(256);
  for (let i = 0; i < 65536; i++) if (notchlake[i]) hasnotch[notchlake[i]!] = 1;
  return { notchlake, lips: lipedges, hasnotch };
}

/* LipRange: the lowest and highest ground point on fall w's lip edges (HeightLevel units), or null. */
function lipRange(w: TraxxFall, lg: LakeGround): { lo: number; hi: number } | null {
  const S = pointStep(lg);
  if (S === 0) return null;
  let lo = 0, hi = 0, any = false;
  const see = (u: number) => { if (!any || u < lo) lo = u; if (!any || u > hi) hi = u; any = true; };
  for (const q of notchCols(w)) {
    const tx = q.n & 255, tz = q.n >> 8;
    if (q.lip === 0) {
      // a diagonal pair: its one shared vertex is the lip (wtr_check)
      if (q.corner !== 0) {
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

/* NotchErrors: FALL_NOTCH and FALL_NOTCH_SHARED of fall i. */
function notchErrors(falls: readonly TraxxFall[], i: number, tmap: Uint8Array | null): number {
  const col = notchCols(falls[i]!);
  if (!col.length) return 0;
  let e = 0;
  // a notch tile in any lake, or one not next to the lake tile 1 ft behind the crest
  for (const q of col) if (q.lip === 0 || (tmap && tmap[q.n] !== 0)) e |= FALLERR_NOTCH;
  // a notch tile another fall (of this lake or another) also cuts
  const mine = new Uint8Array(65536);
  for (const q of col) mine[q.n] = 1;
  for (let j = 0; j < falls.length && j < FALL_MAX_FALLS && !(e & FALLERR_NOTCH_SHARED); j++) {
    if (j === i) continue;
    for (const q of notchCols(falls[j]!)) if (mine[q.n]) { e |= FALLERR_NOTCH_SHARED; break; }
  }
  return e;
}

/* LipLowError: a ground point on a lip edge below the lake's height. */
function lipLowError(falls: readonly TraxxFall[], i: number, lakes: FallLakes, lg: LakeGround): number {
  const h = fallEffectiveHeight(falls, i, lakes.lakes);
  if (h < 1) return 0;
  const r = lipRange(falls[i]!, lg);
  if (!r) return 0;
  return r.lo < heightLevel(lg, h) ? FALLERR_LIP_LOW : 0;
}

/**
  NotchWarnings: LIP_HIGH (lg), NOTCH_FLAT (fg), LIP_UNCOVERED of fall i; 0 when it has any error
  (names judged with the same check as Errors).
*/
export function fallNotchWarnings(falls: readonly TraxxFall[], i: number, lakes: FallLakes, lg: LakeGround | null, fg: FallGround | null,
  namecheck: FallNameCheck = null): { warn: number; info: FallNotchWarn } {
  const info: FallNotchWarn = { h: 0, climb: 0, hint4: false, flatdeg: 0 };
  if (i < 0 || i >= falls.length || i >= FALL_MAX_FALLS || falls[i]!.source === 0) return { warn: 0, info };
  if (fallErrors(falls, i, lakes, namecheck, lg) !== 0) return { warn: 0, info };
  const w = falls[i]!;
  const h = fallEffectiveHeight(falls, i, lakes.lakes);
  info.h = h;
  const col = notchCols(w);
  if (!col.length) return { warn: 0, info };
  let warn = 0;
  if (lg) {
    const r = lipRange(w, lg);
    if (r && r.hi > heightLevel(lg, h)) {
      warn |= FALLWARN_LIP_HIGH;
      info.climb = (r.hi - heightLevel(lg, h)) / levelUnit(lg);
      info.hint4 = Boolean(lg.raw) && h % 4 !== 0;
    }
  }
  if (fg) {
    const c = buildCrest(w);
    const pd = crestPointDirs(c);
    for (let k = 0; k < col.length; k++) {
      const s = k < col.length - 1 ? k * 2.0 : c.L;
      const at = crestAt(c, pd, s);
      const d: [number, number] = [at.dx, at.dz];
      segmentDirAt(c, s, d); // the notch's direction, as the reference's notch_cols
      const h1 = fg.height(wrapFt(at.x + d[0]), wrapFt(at.z + d[1]));
      const h3 = fg.height(wrapFt(at.x + 3.0 * d[0]), wrapFt(at.z + 3.0 * d[1]));
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

/** NotchWarnText: the warning's text with the numbers of info. */
export function fallNotchWarnText(bit: number, info: FallNotchWarn): string {
  if (bit === FALLWARN_LIP_HIGH && info.climb > 0) {
    let t = `A lip corner is above the lake's height: the water climbs ${cG(info.climb)} water units (${cG(info.climb / 2.0)} ft) over the lip`;
    if (info.hint4) t += "; the height is not a multiple of 4, so no corner can sit exactly at it - set it to a multiple of 4";
    return t;
  }
  if (bit === FALLWARN_NOTCH_FLAT && info.flatdeg !== 0) {
    return `The notch tile slopes only ${info.flatdeg.toFixed(1)} degrees along the flow (under 5): the water may come to rest on it - lower the far side by at least two steps`;
  }
  return fallWarnText(bit);
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

function snapLakeSide(tmap: Uint8Array, source: number, carved: Uint8Array, tx: number, tz: number): boolean {
  const t = (tx & 255) + ((tz & 255) << 8);
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
  const c = buildCrest(w);
  if (c.n < 2) return 0;
  const pd = crestPointDirs(c);
  let S = 0, lipmin = 0, checkground = false;
  if (lg && pointStep(lg) > 0) {
    S = pointStep(lg);
    lipmin = heightLevel(lg, lakes.lakes[w.source - 1]!.height);
    checkground = true;
  }
  // This fall's own CARVED notch tiles (n == k with a lake-side edge under water); none without the ground.
  const carved = new Uint8Array(65536);
  if (checkground) {
    for (const q of notchCols(w)) {
      const tx = q.n & 255, tz = q.n >> 8;
      if (q.n !== q.k) continue;
      for (let d = 0; d < 4; d++) {
        const ux = tx + (d === 1 ? 1 : d === 3 ? -1 : 0), uz = tz + (d === 2 ? 1 : d === 0 ? -1 : 0);
        if (tmap[(ux & 255) + ((uz & 255) << 8)] === w.source && snapEdgeLow(lg!, S, lipmin, tx, tz, d)) carved[q.n] = 1;
      }
    }
  }
  const r = Math.ceil(maxft / 32.0) + 1;
  const orig = cloneFall(w); // every point is judged against the crest as it was clicked
  let moved = 0;
  for (let k = 0; k < orig.npoints; k++) {
    const px = (orig.pt[k]![0] & 131071) / 16.0, pz = (orig.pt[k]![1] & 131071) / 16.0;
    const tx0 = Math.floor(px / 32.0), tz0 = Math.floor(pz / 32.0);
    let qx = 0, qz = 0, placed = false;
    // the edges round the point
    const edge: LipEdge[] = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = tx0 + dx, tz = tz0 + dz; // unwrapped; the tile map wraps at 256
        if (!snapLakeSide(tmap, w.source, carved, tx, tz)) continue;
        for (let d = 0; d < 4; d++) {
          const ux = tx + (d === 1 ? 1 : d === 3 ? -1 : 0), uz = tz + (d === 2 ? 1 : d === 0 ? -1 : 0);
          const t = (ux & 255) + ((uz & 255) << 8);
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
      const nx = Math.floor(wrapFt(qx) * 16.0 + 0.5) & 131071, nz = Math.floor(wrapFt(qz) * 16.0 + 0.5) & 131071;
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
*/
export function fallClassicHeightRaw(corner: (tx: number, tz: number) => number, xft: number, zft: number): number {
  const xu = Math.floor(xft * 256.0), zu = Math.floor(zft * 256.0);
  const xf = imulDiv(xu & (32 * 256 - 1), 65536, 32 * 256);
  const zf = imulDiv(zu & (32 * 256 - 1), 65536, 32 * 256);
  const x1 = Math.trunc((xu & (256 * 256 * 32 - 1)) / (32 * 256)) & 255; // computeGridX
  const z1 = Math.trunc((zu & (256 * 256 * 32 - 1)) / (32 * 256)) & 255;
  const x2 = (x1 + 1) & 255, z2 = (z1 + 1) & 255;
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
*/
export function fallGroundFor(t: Terrain16 & { waterLevel4: number; lakes: readonly { height: number }[] }, tmap: Uint8Array | null): FallGround {
  const mode = t.terrainMode;
  if (mode === TERRAINMODE_CLASSIC16 || mode === TERRAINMODE_SPLINE) syncFromRaw(t);
  const raw = t.heights;
  const fine = mode === TERRAINMODE_SPLINE || mode === TERRAINMODE_FINE;
  const corner = (tx: number, tz: number) => {
    tx &= 255; tz &= 255;
    if (mode === TERRAINMODE_CLASSIC8) return 128 * raw[(tz << 8) | tx]!;
    return Math.trunc(cornerV(t, tx, tz) / 2);
  };
  const water4 = t.waterLevel4;
  const nlakes = t.lakes.length;
  return {
    height: fine ? (x, z) => surfaceFeet(t, Math.fround(x), Math.fround(z)) : (x, z) => fallClassicHeightRaw(corner, x, z),
    water: (x, z, source) => {
      const tx = Math.floor(x / 32.0) & 255, tz = Math.floor(z / 32.0) & 255;
      if (tmap) {
        const l = tmap[tx + (tz << 8)]!;
        if (l !== 0 && l !== source && l <= nlakes) return Math.fround(t.lakes[l - 1]!.height * 0.5);
      }
      if (water4 > 0) return Math.fround(water4 * 0.5);
      return null;
    },
  };
}

/** FallNameInPod: kind 0 a pod sound SOUND\<stem>.WAV; kind 1 a pod texture whose base name (no folder, no extension) is the stem, any case. */
export function fallNameInPod(sounds: readonly { name: string }[], textures: readonly ({ name: string } | null)[]): (kind: number, stem: string) => boolean {
  return (kind, stem) => {
    if (!stem) return false;
    if (kind === 0) {
      if (stem.length + 11 > 32) return false; // SOUNDNAMELEN: "SOUND\" + ".WAV" + NUL
      const want = `SOUND\\${stem}.WAV`.toUpperCase();
      return sounds.some((s) => s.name.toUpperCase() === want);
    }
    return textures.some((tex) => {
      if (!tex) return false;
      const nm = tex.name, slash = nm.lastIndexOf("\\");
      const base = slash >= 0 ? nm.slice(slash + 1) : nm;
      const dot = base.lastIndexOf(".");
      return (dot >= 0 ? base.slice(0, dot) : base).toUpperCase() === stem.toUpperCase();
    });
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
export function nearCrest(falls: readonly TraxxFall[], i: number, xft: number, zft: number, ft: number): boolean {
  if (i < 0 || i >= falls.length || i >= FALL_MAX_FALLS) return false;
  const c = buildCrest(falls[i]!);
  if (c.n < 2) return false;
  const qx = c.P[0]![0] + wrapFt(xft - c.P[0]![0] + 4096.0) - 4096.0;
  const qz = c.P[0]![1] + wrapFt(zft - c.P[0]![1] + 4096.0) - 4096.0;
  for (let k = 0; k + 1 < c.n; k++) if (distToSegment(qx, qz, c.P[k]![0], c.P[k]![1], c.P[k + 1]![0], c.P[k + 1]![1]) <= ft) return true;
  return false;
}

/** FallNearestToMenu: the fall whose crest is within 1, 3, 6 or 12 ft of the point (the nearest reach first), or -1. */
export function fallNearestToMenu(falls: readonly TraxxFall[], xft: number, zft: number): number {
  for (const reach of [1.0, 3.0, 6.0, 12.0]) for (let i = 0; i < falls.length; i++) if (nearCrest(falls, i, xft, zft, reach)) return i;
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
  const c = buildCrest(w);
  if (c.n < 2 || !tmap) return 0;
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
      const x = wrapFt(bx - f[0]), z = wrapFt(bz - f[1]);
      const tx = Math.trunc(x / 32.0) & 255, tz = Math.trunc(z / 32.0) & 255;
      if (tmap[tx + (tz << 8)] === w.source) ok = true;
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
    const c = buildCrest(w);
    if (c.n < 2) return;
    const pd = crestPointDirs(c);
    let sum = 0;
    for (let k = 0; k < c.n; k++) {
      for (let s = 2; s <= 48; s += 2) {
        const bx = wrapFt(c.P[k]![0] - s * pd[k]![0]), bz = wrapFt(c.P[k]![1] - s * pd[k]![1]);
        const ax = wrapFt(c.P[k]![0] + s * pd[k]![0]), az = wrapFt(c.P[k]![1] + s * pd[k]![1]);
        const bt = (Math.trunc(bx / 32.0) & 255) + ((Math.trunc(bz / 32.0) & 255) << 8);
        const at = (Math.trunc(ax / 32.0) & 255) + ((Math.trunc(az / 32.0) & 255) << 8);
        sum += (lakes.tmap[bt] === w.source ? 1 : 0) - (lakes.tmap[at] === w.source ? 1 : 0);
      }
    }
    if (sum < 0) fallReverse(w);
    return;
  }
  if (!g) return;
  const c = buildCrest(w);
  if (c.n < 2) return;
  const pd = crestPointDirs(c);
  let sum = 0;
  for (let k = 0; k < c.n; k++) {
    const bx = wrapFt(c.P[k]![0] - 4.0 * pd[k]![0]), bz = wrapFt(c.P[k]![1] - 4.0 * pd[k]![1]);
    const ax = wrapFt(c.P[k]![0] + 4.0 * pd[k]![0]), az = wrapFt(c.P[k]![1] + 4.0 * pd[k]![1]);
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
  for (let k = 0; k < n; k++) {
    if (w.pt[k]![0] < 0 || w.pt[k]![0] > FALL_COORD_MAX || w.pt[k]![1] < 0 || w.pt[k]![1] > FALL_COORD_MAX) e |= FALLERR_COORD;
  }
  const c = buildCrest(w);
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
    if (height < 1 || height > 4096) e |= FALLERR_HEIGHT;
  }
  if (w.speed < 16 || w.speed > 1600) e |= FALLERR_SPEED;
  if (lakeok && c.n >= 2) {
    if (!lakes.tmap || directionFails(w, lakes.tmap) > 0) e |= FALLERR_DIRECTION;
  }
  if (stemBad(w.sound, 0, namecheck) || stemBad(w.texture, 1, namecheck)) e |= FALLERR_NAME;
  // The spillway notch (a lake-fed fall): the tiles it cuts, and, given the ground, the lip.
  if (w.source !== 0 && c.n >= 2) {
    e |= notchErrors(falls, i, lakes.tmap);
    if (lipground && lakeok) e |= lipLowError(falls, i, lakes, lipground);
  }
  return e;
}

/** ErrorText, verbatim. */
export function fallErrorText(bit: number): string {
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
    case FALLERR_LIP_LOW: return "A lip corner is below the lake's height: the water's edge would show as a floating face - raise it to the lake's height";
  }
  return "";
}

/** WarnText, verbatim. */
export function fallWarnText(bit: number): string {
  switch (bit) {
    case FALLWARN_LIP_HIGH: return "A lip corner is above the lake's height: the water climbs over the lip";
    case FALLWARN_LIP_UNCOVERED: return "The crest does not cover the whole lip edge: a thin z-fight band can show - stretch the crest along the lip edge";
    case FALLWARN_NOTCH_FLAT: return "The notch tile slopes under 5 degrees along the flow: the water may come to rest on it - lower the far side by at least two steps";
    case FALLWARN_DRY: return "The water lands on dry ground";
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
  return g.height(wrapFt(x), wrapFt(z));
}

/**
  WalkColumn: one column from (sx, sy, sz) feet along horizontal (dx, dz), walk_column. A row is
  kept whenever the path since the last one is at least `spacing` ft, and always at the end.
  `rowsOut` (null = count only) receives the rows' points.
*/
export function walkColumn(sx: number, sy: number, sz: number, dx: number, dz: number, speed: number, source: number, g: FallGround, spacing: number,
  rowsOut: number[] | null): { rows: number; end: number; pathlen: number } {
  let x = sx, y = sy, z = sz;
  let vx = speed * dx, vy = 0.0, vz = speed * dz;
  let acc = 0, path = 0, rows = 1, ek = FALLEND_LIMIT;
  const push = (px: number, py: number, pz: number) => { if (rowsOut) rowsOut.push(Math.fround(px), Math.fround(py), Math.fround(pz)); };
  push(x, y, z);
  for (let step = 1; step <= FALL_MAX_STEPS; step++) {
    const ox = x, oy = y, oz = z;
    let draped = false, ended = false, gny = 0.0;
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
      if (vn < 0.0) { vx -= vn * nx; vy -= vn * ny; vz -= vn * nz; }
      vx *= FALL_DRAG; vy *= FALL_DRAG; vz *= FALL_DRAG;
      gny = ny;
    }
    const speednow = Math.sqrt(vx * vx + vy * vy + vz * vz);
    // end tests on the position after the drape: water (its last point on the surface), rest, limit
    const surf = g.water ? g.water(wrapFt(x), wrapFt(z), source) : null;
    if (surf !== null && surf > gr && y <= surf) { y = surf; ek = FALLEND_WATER; ended = true; }
    else if (draped && gny > FALL_REST_COSINE && speednow < FALL_REST_SPEED) { ek = FALLEND_GROUND; ended = true; }
    if (!ended && step === FALL_MAX_STEPS) { ek = FALLEND_LIMIT; ended = true; }
    const len = Math.sqrt((x - ox) * (x - ox) + (y - oy) * (y - oy) + (z - oz) * (z - oz));
    acc += len;
    path += len;
    if (ended || acc >= spacing) { push(x, y, z); rows++; acc = 0.0; }
    if (ended) break;
  }
  return { rows, end: ek, pathlen: path };
}

/* _totals: every row (each column cut to R), plus 3 foam vertices per column in a run of 2 or more water-ending columns. */
function totals(st: FallStat, R: number): number {
  let sheet = 0, run = 0, foam = 0;
  for (let c = 0; c < st.ncols; c++) sheet += st.rows[c]! < R ? st.rows[c]! : R;
  for (let c = 0; c <= st.ncols; c++) {
    const wet = c < st.ncols && st.endk[c] === FALLEND_WATER && st.rows[c]! <= R;
    if (wet) run++;
    else { if (run >= 2) foam += 3 * run; run = 0; }
  }
  return sheet + foam;
}

const ALL_ROWS = 0x7fffffff;

/**
  BuildShape (handover 4.3): the shape of a fall at `height` (raw): the 2 ft columns with their
  rows, and each spacing's row counts and ends for Budget. DRY when no 2 ft column ends in water.
*/
export function buildFallShape(w: TraxxFall, height: number, g: FallGround): FallShape {
  const out = emptyFallShape();
  const c = buildCrest(w);
  if (c.n < 2 || c.L < 1e-6) return out;
  const pd = crestPointDirs(c);
  out.width = Math.fround(c.L);
  let anywater = false;
  for (let j = 0; j < FALL_NSPACINGS; j++) {
    const sp = SPACINGS[j]!;
    const nc = columnCount(c.L, sp);
    if (nc === 0) continue;
    const st: FallStat = { ncols: nc, rows: new Int32Array(nc), endk: new Uint8Array(nc) };
    out.stat[j] = st;
    if (j === 0) out.ncols = nc;
    for (let k = 0; k < nc; k++) {
      const s = k < nc - 1 ? k * sp : c.L;
      const at = crestAt(c, pd, s);
      const pts: number[] | null = j === 0 ? [] : null;
      const r = walkColumn(at.x, height * 0.5, at.z, at.dx, at.dz, w.speed / 16.0, w.source, g, sp, pts);
      st.rows[k] = r.rows;
      st.endk[k] = r.end;
      // the sink row (handover 4.4): a water-ending column carries one more mesh row, 4 ft under the surface
      if (r.end === FALLEND_WATER) st.rows[k]++;
      if (j === 0) {
        out.col.push({ n: pts!.length / 3, p: Float32Array.from(pts!), end: r.end, pathlen: Math.fround(r.pathlen) });
        if (r.end === FALLEND_WATER) anywater = true;
      }
    }
  }
  if (out.ncols > 0 && !anywater) out.warn |= FALLWARN_DRY;
  out.vertices = out.ncols > 0 ? Math.trunc(totals(out.stat[0]!, ALL_ROWS)) : 0;
  return out;
}

/**
  FitFall (fall_build_stats): the first spacing 2, 3, 4, 6, 8 ft at which the fall fits `budget`
  vertices; failing that every column cut to the largest common row count that fits (bisection).
  Null when it does not fit at all.
*/
export function fitFall(s: FallShape, budget: number): { verts: number; spacing: number; shortened: boolean } | null {
  let last = -1, found = false;
  for (let j = 0; j < FALL_NSPACINGS; j++) {
    if (s.stat[j]!.ncols === 0) continue;
    last = j;
    if (totals(s.stat[j]!, ALL_ROWS) <= budget) { found = true; break; }
  }
  if (last < 0) return null;
  const st = s.stat[last]!;
  const spacing = SPACINGS[last]!;
  if (found) return { verts: Math.trunc(totals(st, ALL_ROWS)), spacing, shortened: false };
  if (totals(st, 2) > budget) return null;
  let lo = 2, hi = 2;
  for (let j = 0; j < st.ncols; j++) if (st.rows[j]! > hi) hi = st.rows[j]!;
  while (lo < hi) {
    const mid = lo + Math.trunc((hi - lo + 1) / 2);
    if (totals(st, mid) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return { verts: Math.trunc(totals(st, lo)), spacing, shortened: true };
}

/**
  Budget (handover 4.4) over all falls in file order: sets vertices / spacing and COARSE /
  SHORTENED / DROPPED (and DRY at the spacing used). Returns the vertices the kept falls use.
*/
export function fallBudget(shapes: FallShape[]): number {
  let track = 0;
  for (const s of shapes) {
    s.warn &= ~(FALLWARN_COARSE | FALLWARN_SHORTENED | FALLWARN_DROPPED);
    s.spacing = 2.0;
    s.vertices = 0;
    let room = FALL_VERTS_PER_TRACK - track;
    if (room > FALL_VERTS_PER_FALL) room = FALL_VERTS_PER_FALL;
    if (s.stat.every((st) => st.ncols === 0)) continue; // no usable crest: nothing to draw
    const fit = fitFall(s, room);
    if (fit) {
      const jn = SPACINGS.indexOf(fit.spacing as 2);
      let water = 0;
      for (let j = 0; j < s.stat[jn]!.ncols; j++) if (s.stat[jn]!.endk[j] === FALLEND_WATER) water++;
      // DRY is judged at the spacing the engine will use
      s.warn &= ~FALLWARN_DRY;
      if (water === 0) s.warn |= FALLWARN_DRY;
      s.spacing = fit.spacing;
      s.vertices = fit.verts;
      if (fit.spacing > 2.0) s.warn |= FALLWARN_COARSE;
      if (fit.shortened) s.warn |= FALLWARN_SHORTENED;
      track += fit.verts;
    } else {
      s.warn |= FALLWARN_DROPPED;
      // what it would use with the whole per-fall budget (0 if even that is not enough)
      const whole = fitFall(s, FALL_VERTS_PER_FALL);
      if (whole) { s.vertices = whole.verts; s.spacing = whole.spacing; }
    }
  }
  return track;
}

/**
  MistVolume: the engine's mist box (wfRegisterMist, cursh2 d0753e2; landing stats decdd75) for
  the preview: [x, floorY, z, W, L, H, fx, fz] in feet, in the shape's unwrapped frame, or null
  when the mist is 0 or no column ends in water.
*/
export function mistVolume(w: TraxxFall, height: number, s: FallShape): number[] | null {
  if (w.mist === 0) return null;
  const crest = height * 0.5, spacing = FALL_ROW_SPACING, offset = 0.3;
  let sy = 0, sdrop = 0, fx = 0, fz = 0, nwater = 0;
  for (const c of s.col) {
    if (c.end !== FALLEND_WATER || c.n < 1) continue;
    const e = 3 * (c.n - 1);
    sy += c.p[e + 1]!;
    sdrop += crest - c.p[e + 1]!;
    nwater++;
    if (c.n >= 2) {
      const dx = c.p[e]! - c.p[e - 3]!, dz = c.p[e + 2]! - c.p[e - 1]!, l = Math.sqrt(dx * dx + dz * dz);
      if (l > 1e-6) { fx += dx / l; fz += dz / l; }
    }
  }
  if (nwater === 0) return null;
  let len = Math.sqrt(fx * fx + fz * fz);
  if (len < 1e-6) {
    // no landing direction: the crest's mean flow direction
    fx = 0; fz = 0;
    const c = buildCrest(w);
    if (c.n >= 2) { const pd = crestPointDirs(c); for (let k = 0; k < c.n; k++) { fx += pd[k]![0]; fz += pd[k]![1]; } }
    len = Math.sqrt(fx * fx + fz * fz);
  }
  if (len < 1e-6) { fx = 0.0; fz = 1.0; len = 1.0; }
  fx /= len;
  fz /= len;
  let aclo = 1e30, achi = -1e30, alsum = 0;
  for (const c of s.col) {
    if (c.end !== FALLEND_WATER || c.n < 1) continue;
    const e = 3 * (c.n - 1);
    const ac = -fz * c.p[e]! + fx * c.p[e + 2]!, al = fx * c.p[e]! + fz * c.p[e + 2]!;
    if (ac < aclo) aclo = ac;
    if (ac > achi) achi = ac;
    alsum += al;
  }
  const ac = 0.5 * (aclo + achi), al = alsum / nwater;
  const landw = achi - aclo + spacing;
  const sx = al * fx - ac * fz, sz = al * fz + ac * fx;
  sy /= nwater;
  const dropft = sdrop / nwater;
  let H = 0.7 * dropft;
  if (H > 120.0) H = 120.0;
  H = (H * w.mistheight) / 100.0;
  if (H > 240.0) H = 240.0;
  let W = landw + 0.6 * dropft;
  if (W < 20.0) W = 20.0;
  let L = 0.6 * dropft;
  if (L < 20.0) L = 20.0;
  L = (L * w.mistdepth) / 100.0;
  const f = Math.fround;
  return [f(sx + offset * L * fx), f(sy - 2.0), f(sz + offset * L * fz), f(W), f(L), f(H), f(fx), f(fz)];
}

// ---- The view's helpers (Traxx/TraxxViewFalls.cpp) ----

/** FallUnwrap: the crest points in feet unwrapped from point 0, each step the shortest wrapped difference. */
export function fallUnwrap(w: TraxxFall, n: number): { px: number[]; pz: number[] } {
  let x = (w.pt[0]![0] & 131071) / 16.0, z = (w.pt[0]![1] & 131071) / 16.0;
  const px = [Math.fround(x)], pz = [Math.fround(z)];
  for (let k = 1; k < n; k++) {
    let dx = (w.pt[k]![0] - w.pt[k - 1]![0]) / 16.0, dz = (w.pt[k]![1] - w.pt[k - 1]![1]) / 16.0;
    dx -= 8192.0 * Math.floor((dx + 4096.0) / 8192.0);
    dz -= 8192.0 * Math.floor((dz + 4096.0) / 8192.0);
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
  for (let k = 0; k < n; k++) {
    const px = pts[k]![0] / 16.0, pz = pts[k]![1] / 16.0;
    const ptx = Math.floor(px / 32.0), ptz = Math.floor(pz / 32.0);
    for (let dtz = -2; dtz <= 2; dtz++) {
      for (let dtx = -2; dtx <= 2; dtx++) {
        const tx = ptx + dtx, tz = ptz + dtz;
        const lake = tmap[(tx & 255) + ((tz & 255) << 8)]!;
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

/** The spring height of a new crest: on the ground at its first point (ceil(ground * 2) + 1), 1..4096. */
export function fallSpringHeight(g: FallGround | null, x0: number, z0: number): number {
  let height = g ? Math.ceil(g.height(x0, z0) * 2.0) + 1 : 1;
  if (height < 1) height = 1;
  if (height > 4096) height = 4096;
  return height;
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
*/
export function buildWfl(falls: readonly TraxxFall[], lakes: FallLakes, namecheck: FallNameCheck = null): Uint8Array | null {
  if (!falls.length || falls.length > FALL_MAX_FALLS) return null;
  for (let i = 0; i < falls.length; i++) if (fallErrors(falls, i, lakes, namecheck) !== 0) return null;
  return writeWfl(falls.map((w, i) => ({
    source: w.source, flags: w.flags, speed: w.speed, height: fallEffectiveHeight(falls, i, lakes.lakes),
    points: w.pt.slice(0, Math.min(w.npoints, FALL_MAX_POINTS)).map(([x, z]) => ({ x, z })),
    opacity: w.opacity, mist: w.mist, volume: w.volume, mistDepth: w.mistdepth, mistHeight: w.mistheight,
    soundName: w.sound.slice(0, FALL_NAMELEN - 1), textureName: w.texture.slice(0, FALL_NAMELEN - 1),
  })));
}

/** ParseWFL: the falls of a .WFL, or null when the file is refused (Traxx then has no falls). */
export function parseWflFalls(bytes: Uint8Array): TraxxFall[] | null {
  if (!isWfl(bytes)) return null;
  let wfl;
  try { wfl = parseWfl(bytes); } catch { return null; }
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
    w.sound = f.soundName; w.texture = f.textureName;
    return w;
  });
}

/** The pod's report when the waterfalls cannot be packed (CTrackPOD::Save). */
export const FALLS_NOT_SAVED = "The waterfalls could not be written into the pod (the name does not fit a pod entry, a waterfall is in error, or its lake is in error).\n\nThe pod was saved WITHOUT its waterfalls. Fix them and save again.";
