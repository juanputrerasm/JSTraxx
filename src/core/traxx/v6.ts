/*
  MTM2 track format version 6 in JSTraxx: the height step and base Write POD picks, and the version 6
  height, ground box and .TXV writing, as Traxx origin/main does them (Include/TrackPODHeightScale.h and
  TrackPOD/TrackPODHeightScale.cpp: PickHeightStepBase, TrackHeightSpan, V6PickWriteScale, HeightToSample,
  V6EncodeSamples, V6EncodeBoxTop; TrackPOD/TrackPOD.cpp BuildRA01CL0_16; TrackPOD/TrackPODFile.cpp Save and
  EncodeV6SamplesPng).

  Whether a track is a version 6 (.SI3) track is its kind (track-kind.ts, Traxx origin/main IsV6), never its
  content: Standard V6 and Tall Heights V6 are written as a .SI3, Classic exactly as Traxx writes it.

  The step and base are re-picked on every Write POD (never kept from the pod the track was opened from): base the
  whole feet under the lowest point, which may not be below 0 ft (the engine takes no negative base), and the
  largest step of 128..1 samples a foot that holds the span in 16 bits. Every height is written as the floor of
  its sample, clamped to 0..65535; a ground box's top is never written as 0 (the engine's "no box").
*/
import { encodeGreyPng } from "../../vendor/openphotex/texture/png-write.js";
import { emptyGroundBoxGrids } from "../../vendor/openphotex/mtm/write.js";
import type { TxxTrack } from "./txx.ts";
import { TERRAINMODE_CLASSIC16, TERRAINMODE_FINE, TERRAINMODE_SPLINE, syncFromRaw } from "./terrain16.ts";
import { cellsOf, heightRange, type HeightGrid } from "./world.ts";
import { FALL_MAX_FALLS, FALL_WORLD_CLASSIC, fallEffectiveHeight, type FallWorld } from "./falls.ts";
import { fallMaxHeight, isV6, maxBoxes, waterLevelMax4, WATER_MAX4_CLASSIC } from "./track-kind.ts";
import { formatFeet } from "./height-units.ts";

/*
  The track's own water (the .LVL !waterHeight, waterLevel4, in half feet; 0 is no water): 0..WaterLevelMax4 of its
  kind (Traxx origin/main TrackPOD.cpp): 0..1020 on a classic track, 0..1023 Standard V6, 0..16384 Tall Heights V6.
  Never below 0.
*/
/** Traxx's highest classic track water, half feet (510 ft). */
export const TRACK_WATER_MAX4 = WATER_MAX4_CLASSIC;

/** LAKE_MAX_LAKES (Include/TrackPODLakes.h). */
const LAKE_MAX_LAKES = 255;

/** The track water a track may have, half feet: 0..WaterLevelMax4. */
export function trackWaterRange(t: Pick<TxxTrack, "trackKind">): [number, number] {
  return [0, waterLevelMax4(t)];
}

/** V6WaterMax (TrackPODHeightScale.cpp): the highest !waterHeight a .SI3 with this step and base takes, half-feet. */
export function v6WaterMax(step: number, base: number): number {
  return 2 * (base + Math.trunc(65536 / (step > 0 ? step : 128)));
}

/** The track water a version 6 .TXV's step and base allow, half feet: 0 .. V6WaterMax. */
export function v6WaterRange(step: number, base: number): [number, number] {
  return [0, v6WaterMax(step, base)];
}

/** Whether a track is written as a version 6 (.SI3) track: its kind (IsV6). */
export function isV6Track(t: Pick<TxxTrack, "trackKind">): boolean {
  return isV6(t);
}

/** The most placed objects a track may hold: MaxBoxes (16,384 on a v6 track, 4,096 otherwise). */
export function objectLimit(t: Pick<TxxTrack, "trackKind">): number {
  return maxBoxes(t);
}

// ---- TrackPODHeightScale.h ----

/** HeightScaleShift: step 128 -> 0, step 1 -> 7. */
export function heightScaleShift(step: number): number {
  let s = 0;
  while (s < 7 && (128 >> s) !== step) s++;
  return s;
}

/** HeightToSample: (h - base*128) >> (7 - log2 step), the floor (an arithmetic shift of a C int). */
export function heightToSample(h: number, step: number, base: number): number {
  return (h - base * 128) >> heightScaleShift(step);
}

/** SampleToHeight: (sample << (7 - log2 step)) + base*128. */
export function sampleToHeight(sample: number, step: number, base: number): number {
  return (sample << heightScaleShift(step)) + base * 128;
}

/** V6EncodeSamples: out[i] = HeightToSample(v[i]), clamped to 0..65535. */
export function v6EncodeSamples(v: ArrayLike<number>, step: number, base: number, out: Uint16Array = new Uint16Array(v.length)): Uint16Array {
  for (let i = 0; i < v.length; i++) {
    const s = heightToSample(v[i]!, step, base);
    out[i] = s < 0 ? 0 : s > 65535 ? 65535 : s;
  }
  return out;
}

/** V6EncodeBoxTop: 0 when upper is 0 (no box), else at least 1 (the engine reads a top of 0 as "no box"). */
export function v6EncodeBoxTop(upper: number, step: number, base: number): number {
  if (upper === 0) return 0;
  const s = v6EncodeSamples([upper], step, base)[0]!;
  return s < 1 ? 1 : s;
}

/**
  PickHeightStepBase: base = floor(lowest / 128) (whole feet), the largest step in {128, 64, ... 1} with
  (highest - base*128) * step <= 65535*128. Null when base < 0 or no step fits.
*/
export function pickHeightStepBase(lowest: number, highest: number): { step: number; base: number } | null {
  const b = Math.floor(lowest / 128);
  if (b < 0) return null;
  let span = highest - b * 128;
  if (span < 0) span = 0;
  for (let s = 128; s >= 1; s >>= 1) if (span * s <= 65535 * 128) return { step: s, base: b };
  return null;
}

/** The active grid TrackHeightSpan reads: FINE the fine grid, CLASSIC16 and SPLINE h16, CLASSIC8 null (raw << 8). */
function activeGrid(t: Pick<TxxTrack, "terrainMode" | "h16" | "fine">): HeightGrid | null {
  if (t.terrainMode === TERRAINMODE_FINE) return t.fine;
  if (t.terrainMode === TERRAINMODE_CLASSIC16 || t.terrainMode === TERRAINMODE_SPLINE) return t.h16;
  return null;
}

/**
  TrackHeightSpan: the lowest and highest of the active grid's samples (CLASSIC8 raw << 8) and of the ground boxes (a
  box's lower counts for the bottom, its upper for the top; a box whose upper is 0 is "no box" and skipped). On a v6
  track the water (when above 0), every lake and every fall's effective height (when above 0) count too, half-feet x
  64 = 1/128 ft: the engine takes them up to the track's own window.
*/
export function trackHeightSpan(t: TxxTrack): [number, number] {
  let lo = Infinity, hi = -Infinity, n = 0;
  const span = (v: number) => { if (v < lo) lo = v; if (v > hi) hi = v; n++; };
  const g = activeGrid(t);
  if (g) {
    const [a, b] = heightRange(g);
    if (g.length) { lo = a; hi = b; n += g.length; }
  } else {
    for (let i = 0; i < t.heights.length; i++) span(t.heights[i]! << 8);
  }
  for (const b of t.groundBoxes) {
    if (b.upper === 0) continue;
    if (b.lower < lo) lo = b.lower;
    if (b.upper > hi) hi = b.upper;
    n++;
  }
  if (isV6(t)) {
    if (t.waterLevel4 > 0) span(t.waterLevel4 * 64);
    for (let i = 0; i < t.lakes.length && i < LAKE_MAX_LAKES; i++) span(t.lakes[i]!.height * 64);
    const falls = t.falls ?? [];
    for (let i = 0; i < falls.length && i < FALL_MAX_FALLS; i++) {
      const w = fallEffectiveHeight(falls, i, t.lakes);
      if (w > 0) span(w * 64);
    }
  }
  if (n === 0) lo = hi = 0;
  return [lo, hi];
}

/** V6PickWriteScale's verdicts. */
export const V6W_OK = 0;
export const V6W_BELOW_ZERO = 1;
export const V6W_TOO_TALL = 2;

export interface V6WriteScale {
  verdict: typeof V6W_OK | typeof V6W_BELOW_ZERO | typeof V6W_TOO_TALL;
  step: number;
  base: number;
  /** The lowest height, 1/128 ft (how low, for V6W_BELOW_ZERO). */
  lowest: number;
}

/**
  V6PickWriteScale: PickHeightStepBase over TrackHeightSpan, after SyncFromRaw (so the 8-bit edits are in). Traxx
  refreshes its spline scale first; JSTraxx's spline surface has no separate scale.
*/
export function v6PickWriteScale(t: TxxTrack): V6WriteScale {
  syncFromRaw(t);
  const [lo, hi] = trackHeightSpan(t);
  if (lo < 0) return { verdict: V6W_BELOW_ZERO, step: 128, base: 0, lowest: lo };
  const p = pickHeightStepBase(lo, hi);
  if (!p) return { verdict: V6W_TOO_TALL, step: 128, base: 0, lowest: lo };
  return { verdict: V6W_OK, step: p.step, base: p.base, lowest: lo };
}

/** OnFileWritePOD's refusal of a track the scale cannot hold (Traxx/TraxxDoc.cpp), shown with the caption "Write POD". */
export function v6WriteScaleRefusal(s: V6WriteScale): string | null {
  if (s.verdict === V6W_BELOW_ZERO) {
    return `Write POD can't write this track: its lowest point is ${formatFeet(s.lowest)} ft, and version 6 tracks can't go below 0 ft. Raise the terrain or ground boxes below 0 ft (Adjust Heights) and try again.`;
  }
  if (s.verdict !== V6W_OK) return "Write POD can't write this track: from its lowest to its highest point it spans more than 65,535 ft.";
  return null;
}

/**
  The step and base Write POD would pick (V6PickWriteScale). A track the scale refuses (below 0 ft, or a span no 16-bit
  sample holds) gets step 1 and the base at 0 or above, for the callers that only need a world to judge falls in; Write
  POD itself refuses that track (v6WriteScaleRefusal).
*/
export function pickStepAndBase(t: TxxTrack): { step: number; base: number } {
  const s = v6PickWriteScale(t);
  if (s.verdict === V6W_OK) return { step: s.step, base: s.base };
  return { step: 1, base: Math.max(0, Math.floor(s.lowest / 128)) };
}

/**
  The world the waterfalls of a track are judged and written in (spec 9.3): N, the step and base Write POD picks
  (pickStepAndBase) and the kind's crest ceiling (FallMaxHeight) for a version 6 track, else FALL_WORLD_CLASSIC,
  so a classic track keeps Traxx's 256 world and 1..4096 crest heights.
*/
export function fallWorldOf(t: TxxTrack): FallWorld {
  if (!isV6(t)) return FALL_WORLD_CLASSIC;
  return { cells: cellsOf(t), terrain: pickStepAndBase(t), maxHeight: fallMaxHeight(t) };
}

/**
  The samples of the heights at a step and base (V6EncodeSamples of the fine grid, else h16), N or 4N square, row by
  row. A CLASSIC8 grid (never on a v6 track: SetTrackKind widens it) is encoded from raw << 8.
*/
export function v6HeightSamples(t: TxxTrack, step: number, base: number): { samples: Uint16Array; side: number } {
  syncFromRaw(t);
  const n = cellsOf(t);
  if (t.fine) return { samples: v6EncodeSamples(t.fine, step, base), side: 4 * n };
  if (t.h16) return { samples: v6EncodeSamples(t.h16, step, base), side: n };
  const v = new Int32Array(t.heights.length);
  for (let i = 0; i < v.length; i++) v[i] = t.heights[i]! << 8;
  return { samples: v6EncodeSamples(v, step, base), side: n };
}

/** The terrainGrid key of a v6 track: spline or fine; a Classic 16-bit grid writes none (WriteTXVFile). */
export function v6TerrainGrid(t: Pick<TxxTrack, "terrainMode">): "spline" | "fine" | null {
  if (t.terrainMode === TERRAINMODE_FINE) return "fine";
  if (t.terrainMode === TERRAINMODE_SPLINE) return "spline";
  return null;
}

/**
  EncodeV6SamplesPng: the height map of a version 6 track, always DATA\<stem>_H.PNG, 16-bit grey, N x N (CLASSIC16 and
  SPLINE) or 4N x 4N (FINE), the samples at the step and base ("Store heights as PNG" plays no part on a v6 track).
*/
export function v6HeightsEntry(t: TxxTrack, prefix: string, step: number, base: number): { name: string; bytes: Uint8Array } {
  const { samples, side } = v6HeightSamples(t, step, base);
  return { name: `DATA\\${prefix}_H.PNG`, bytes: encodeGreyPng(samples, side, side, 16) };
}

/**
  The classic 8-bit N*N DATA\<stem>.RAW a v6 pod always carries before its map (Save): the raw mirror (MirrorOf of
  every coarse height, the 0..255 grid), which the .LVL names and the engine ignores while a height map is set.
*/
export function v6RawMirror(t: TxxTrack): Uint8Array {
  syncFromRaw(t);
  const n = cellsOf(t);
  return t.heights.slice(0, n * n);
}

/**
  BuildRA01CL0_16 and the other ground box grids of a version 6 track (Save): .RA0 / .RA1 always 16-bit, 2*N*N bytes
  each (a box with upper 0 writes 0 and 0; its bottom V6EncodeSamples, its top V6EncodeBoxTop), .CL0 the six face
  words of every box, 12*N*N, and .RA2..RA5 (N*N), .CL1 (4*N*N) and .CL2 (12*N*N) empty. A box outside 0..N-1 is
  skipped.
*/
export function v6GroundBoxGrids(t: TxxTrack, step: number, base: number): Record<"RA0" | "RA1" | "RA2" | "RA3" | "RA4" | "RA5" | "CL0" | "CL1" | "CL2", Uint8Array> {
  const n = cellsOf(t);
  const grids = emptyGroundBoxGrids(n, 8);
  const ra0 = new Uint8Array(2 * n * n), ra1 = new Uint8Array(2 * n * n);
  const v0 = new DataView(ra0.buffer), v1 = new DataView(ra1.buffer), cv = new DataView(grids.CL0.buffer);
  for (const g of t.groundBoxes) {
    if (g.x < 0 || g.x >= n || g.y < 0 || g.y >= n) continue;
    const at = g.x + g.y * n;
    if (g.upper !== 0) {
      v0.setUint16(2 * at, v6EncodeSamples([g.lower], step, base)[0]!, true);
      v1.setUint16(2 * at, v6EncodeBoxTop(g.upper, step, base), true);
    }
    for (let f = 0; f < 6; f++) cv.setUint16(at * 12 + f * 2, (g.faces[f] ?? 0) & 0xffff, true);
  }
  grids.RA0 = ra0;
  grids.RA1 = ra1;
  return grids;
}

// ---- Reading a v6 pod (.SI3): the engine's refusals, one rule and one sentence for Open POD and Clone ----

/**
  TxvKeyValue (TrackPODHeightScale.cpp): the value of `key` in a .TXV's text, the LAST such line winning as in the
  engine, trimmed; null when there is none. Keys compare without case; blanks around the key and the value go; '#'
  lines are comments.
*/
export function txvKeyValue(txv: string, key: string): string | null {
  let found: string | null = null;
  const k = key.toLowerCase();
  for (const raw of txv.split(/[\r\n]+/)) {
    const s = raw.replace(/^[ \t]+/, "");
    if (!s || s[0] === "#") continue;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    if (s.slice(0, eq).replace(/[ \t]+$/, "").toLowerCase() !== k) continue;
    found = s.slice(eq + 1).replace(/^[ \t]+/, "").replace(/[ \t]+$/, "").slice(0, 255);
  }
  return found;
}

/** TxvWholeInt: an optional sign, digits, nothing else, within +-1,000,000; null otherwise. */
function txvWholeInt(s: string): number | null {
  if (!/^[+-]?[0-9]+$/.test(s)) return null;
  const v = parseInt(s, 10);
  return v < -1000000 || v > 1000000 ? null : v;
}

export interface V6Txv {
  /** The text holds at least one of the four v6 keys. */
  any: boolean;
  cells: number;
  step: number;
  base: number;
  /** terrainHeightMap's value, "" for none. */
  mapName: string;
  /** The first key whose value the engine refuses, "" for none (its value is left at the default). */
  badKey: string;
}

/**
  V6ParseTXV: the four v6 keys of a .TXV as the engine reads them. Defaults: 256 cells, step 128, base 0, no map.
  worldCells must be 256 or 512, the step a power of two in 1..128 and the base 0..32767, else that key is named in
  badKey (the first such one).
*/
export function v6ParseTxv(txv: string | null): V6Txv {
  const out: V6Txv = { any: false, cells: 256, step: 128, base: 0, mapName: "", badKey: "" };
  if (txv === null) return out;
  const bad = (k: string) => { if (!out.badKey) out.badKey = k; };
  let v = txvKeyValue(txv, "worldCells");
  if (v !== null) {
    out.any = true;
    const n = txvWholeInt(v);
    if (n === 256 || n === 512) out.cells = n; else bad("worldCells");
  }
  v = txvKeyValue(txv, "terrainHeightMap");
  if (v !== null) { out.any = true; out.mapName = v; }
  v = txvKeyValue(txv, "terrainHeightStep");
  if (v !== null) {
    out.any = true;
    const n = txvWholeInt(v);
    if (n !== null && n >= 1 && n <= 128 && (n & (n - 1)) === 0) out.step = n; else bad("terrainHeightStep");
  }
  v = txvKeyValue(txv, "terrainHeightBase");
  if (v !== null) {
    out.any = true;
    const n = txvWholeInt(v);
    if (n !== null && n >= 0 && n <= 32767) out.base = n; else bad("terrainHeightBase");
  }
  return out;
}

/** C atoi: leading blanks, a sign, digits; 0 for none. */
function cAtoi(s: string): number {
  const m = /^[ \t\n\v\f\r]*([+-]?[0-9]+)/.exec(s);
  return m ? parseInt(m[1]!, 10) | 0 : 0;
}

/** V6TxvFormatVersion: 0 with no text at all; a text with no usable formatVersion (or one <= 0) reads as 1. */
export function v6TxvFormatVersion(txv: string | null): number {
  if (txv === null) return 0;
  const v = txvKeyValue(txv, "formatVersion");
  const fmt = v !== null ? cAtoi(v) : 0;
  return fmt <= 0 ? 1 : fmt;
}

/**
  V6TxvLevelRefusal: the sentence for a .SI3 whose .TXV says formatVersion under 6, and for a .SIT / .SI2 whose OWN
  .TXV carries a v6-only key (worldCells, terrainHeightMap, terrainHeightStep, terrainHeightBase); null otherwise.
  formatVersion=6 alone is not v6-only (race rules and more than 20 checkpoints write it on classic tracks).
*/
export function v6TxvLevelRefusal(isSi3: boolean, txv: string | null): string | null {
  if (isSi3) {
    const fmt = v6TxvFormatVersion(txv);
    return fmt >= 6 ? null : `This track cannot be opened: a .SI3 needs formatVersion=6 in its .TXV (this one has ${fmt}).`;
  }
  if (txv === null) return null;
  for (const k of ["worldCells", "terrainHeightMap", "terrainHeightStep", "terrainHeightBase"]) {
    if (txvKeyValue(txv, k) !== null) return `This track cannot be opened: this level is a version 6 level (its .TXV has ${k}), but its situation file is not a .SI3.`;
  }
  return null;
}

/** V6MsgMissingFile: `what` is "colour file" or "ground box texture file". */
export function v6MsgMissingFile(what: string, name: string): string {
  return `This track's ${what} ${name} is missing.`;
}
export function v6MsgBoxNoPartner(n0: string, n1: string): string {
  return `This track's ground box file ${n0} has no partner ${n1}.`;
}
/** V6MsgBoxPairSize: the engine's wording (Ground.cpp), the pair the same size, N (8-bit) or 2N (16-bit); `cells` is N*N. */
export function v6MsgBoxPairSize(n0: string, l0: number, n1: string, l1: number, cells: number): string {
  return `This track's ground box files ${n0} (${l0} bytes) and ${n1} (${l1} bytes) must be the same size, ${cells} (8-bit) or ${2 * cells} (16-bit).`;
}
export function v6MsgNoHeights(rawName: string): string {
  return `This track has no height map and its ${rawName} is missing.`;
}
export function v6MsgGridSize(name: string, have: number, want: number, cells: number): string {
  return `The grid file ${name} is ${have} bytes; a ${cells}-cell world needs exactly ${want}.`;
}
/** ReadV6BoxLayers / LoadGroundBoxes: the .CL0 of the wrong size. */
export function v6MsgCl0Size(name: string, have: number, cells: number): string {
  return `The ground box texture file ${name} is ${have} bytes; a ${cells}-cell world needs exactly ${12 * cells * cells}.`;
}
/** V6WaterRefusal: a .SI3's !waterHeight outside 0 .. V6WaterMax, or null. */
export function v6WaterRefusal(level: number, step: number, base: number): string | null {
  const hi = v6WaterMax(step, base);
  if (level >= 0 && level <= hi) return null;
  return `This track's !waterHeight is ${level}; a track with this height range allows 0 to ${hi}.`;
}
/** Load's refusals around the .TXV of a .SI3 ("opened") and Clone's ("cloned"). */
export function v6BadKeyRefusal(key: string, verb: "opened" | "cloned"): string {
  return `This track's .TXV has an invalid ${key} value; it cannot be ${verb}.`;
}
export function v6NoMap512Refusal(verb: "opened" | "cloned"): string {
  return `This 512-cell track's .TXV names no terrainHeightMap; a 512-cell world needs one, so it cannot be ${verb}.`;
}
/** ApplyV6HeightMap's clamp warning (heightswarning), shown with the caption "Terrain heights". */
export const V6_HEIGHTS_CLAMPED = "Some of this track's heights are above 8192 ft, which Traxx cannot hold: they were lowered to it.";

/**
  ApplyV6HeightMap's decode (TrackPODFile.cpp): the samples of a terrainHeightMap entry, by its NAME: a .png name must
  be a PNG by content (len >= 33 and the signature) and decode as HeightImageDecode does at N or 4N (an 8-bit sample b
  is b << 8); any other name is an unsigned 16-bit little-endian RAW of 2*N*N or 2*(4N)*(4N) bytes. `why` is the
  reason when it cannot be used (the sentence goes after "cannot be used: ").
*/
export function v6DecodeHeightMap(name: string, file: Uint8Array | null, cells: number, decodePng: (file: Uint8Array, cells: number) => { ok: true; v: Uint16Array; size: number } | { ok: false; why: string }): { ok: true; samples: Uint16Array; dim: number } | { ok: false; why: string } {
  if (!file || file.length <= 0) return { ok: false, why: "file not found" };
  if (/\.png$/i.test(name)) {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (file.length < 33 || sig.some((b, i) => file[i] !== b)) return { ok: false, why: "not a PNG file" };
    const d = decodePng(file, cells);
    if (!d.ok) return { ok: false, why: d.why || "PNG decode failed" };
    return { ok: true, samples: d.v, dim: d.size };
  }
  const fdim = 4 * cells;
  let dim: number;
  if (file.length === 2 * cells * cells) dim = cells;
  else if (file.length === 2 * fdim * fdim) dim = fdim;
  else return { ok: false, why: `RAW size ${file.length} bytes is not ${2 * cells * cells} (${cells}x${cells}) or ${2 * fdim * fdim} (${fdim}x${fdim}) 16-bit samples` };
  const s = new Uint16Array(dim * dim);
  for (let i = 0; i < s.length; i++) s[i] = file[2 * i]! | (file[2 * i + 1]! << 8);
  return { ok: true, samples: s, dim };
}
