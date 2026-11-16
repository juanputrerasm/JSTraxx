/*
  MTM2 track format version 6 in JSTraxx: what makes a track a version 6 (.SI3) track, the height
  step and base Write POD picks, and the version 6 height, ground box and .TXV writing
  (openmtm2.github.io/proposals/track-format-v6.md; Traxx 1.7.1 has none of this).

  The formats are OpenPhotex's (readTxvV6, setTxvValues, writeTxv, decodeMtm2V6Heights,
  mtm2V6StepAndBase, mtm2V6SamplesFromFt, encodeMtm2HeightRaw16, encodeGreyPng, checkMtm2GridSize,
  mtm2GroundBoxDepth, mtm2GroundBoxHeightFt, emptyGroundBoxGrids). What is decided here is the
  editor's side: when a document must be written as a .SI3, which store it keeps, and which step
  and base go into its .TXV.

  The rule (spec 5.1): a track that uses any key of section 6 other than formatVersion is a .SI3.
  A document is written as one when it has a 512-cell world, heights below 0 ft or at or above
  512 ft (outside what CP4's 16-bit 1/128 ft file holds, so the step or base would not be 128 / 0),
  ground boxes that need 16-bit heights, its own water below 0 ft or above 510 ft, or when it was opened from a
  .SI3 (a .SIT or .SI2 is a different track, spec 5.1, so JSTraxx never turns one into the other).
  Any other document is written exactly as Traxx 1.7.1 writes it.
*/
import { parseTxv, setTxvValues, writeTxv } from "../../vendor/openphotex/mtm/txv.js";
import { encodeMtm2HeightRaw16, mtm2V6SamplesFromFt, mtm2V6StepAndBase } from "../../vendor/openphotex/mtm/heights.js";
import { encodeGreyPng } from "../../vendor/openphotex/texture/png-write.js";
import { emptyGroundBoxGrids } from "../../vendor/openphotex/mtm/write.js";
import type { TxxGroundBox, TxxTrack } from "./txx.ts";
import { TERRAINMODE_CLASSIC8, TERRAINMODE_FINE, TERRAINMODE_SPLINE, syncFromRaw } from "./terrain16.ts";
import { V6_V_MAX, V6_V_MIN, cellsOf, heightRange, isWideGrid, type HeightGrid } from "./world.ts";
import { FALL_WORLD_CLASSIC, type FallWorld } from "./falls.ts";
import { TRAXX_MAX_BOXES, V6_MAX_BOXES } from "./sit.ts";

/** The v range CP4 holds: 0 to 65535 (0 to just under 512 ft at 1/128 ft). */
const CP4_V_MAX = 65535;

/*
  The track's own water (the .LVL !waterHeight, waterLevel4, in half feet; 0 is no water). Traxx keeps it in 0..1020
  (0 to 510 ft, its 2 ft steps 0..255 in quarters). A version 6 track has no 510 ft cap (spec section 10, item 7): its
  water spans the terrain's range, 2 * terrainHeightBase to 2 * (terrainHeightBase + 65536 / terrainHeightStep). The
  step and base are picked at Write POD from the heights and a water above them (pickStepAndBase), so the editor
  offers the widest range the 32-bit height store holds, as it does a version 6 lake (lake-ground.ts
  LAKE_V6_MIN_HEIGHT).
*/
/** Traxx's highest track water, half feet (510 ft). */
export const TRACK_WATER_MAX4 = 4 * 255;
/** A version 6 document's lowest and highest track water, half feet: the 32-bit height store's range. */
export const TRACK_WATER_V6_MIN4 = V6_V_MIN / 64;
export const TRACK_WATER_V6_MAX4 = V6_V_MAX / 64;

/** The track water a document may have, half feet: Traxx's 0..1020, or a version 6 document's own range. */
export function trackWaterRange(t: TxxTrack, fromSi3: boolean): [number, number] {
  return isV6Document(t, fromSi3) ? [TRACK_WATER_V6_MIN4, TRACK_WATER_V6_MAX4] : [0, TRACK_WATER_MAX4];
}

/** The track water a version 6 .TXV's step and base allow, half feet (spec section 10, item 7). */
export function v6WaterRange(step: number, base: number): [number, number] {
  return [2 * base, 2 * (base + 65536 / step)];
}

/** The grid Write POD takes the heights from: the Full Map, else h16, else null (Classic 8-bit's raw). */
function heightSource(t: Pick<TxxTrack, "terrainMode" | "h16" | "fine">): HeightGrid | null {
  if (t.terrainMode === TERRAINMODE_CLASSIC8) return null;
  return t.fine ?? t.h16;
}

/** The lowest and highest height of a track, in v (1/128 ft). Classic 8-bit: raw << 8. */
export function trackHeightRangeV(t: Pick<TxxTrack, "terrainMode" | "h16" | "fine" | "heights">): [number, number] {
  const g = heightSource(t);
  if (g) return heightRange(g);
  const [lo, hi] = heightRange(t.heights);
  return [lo * 256, hi * 256];
}

/** Whether a ground box's heights (2 ft units, Traxx's lower / upper) fit Traxx's bytes. */
function boxFitsByte(g: TxxGroundBox): boolean {
  return Number.isInteger(g.lower) && Number.isInteger(g.upper) && g.lower >= 0 && g.lower <= 255 && g.upper >= 1 && g.upper <= 255;
}

/** What a version 6 document needs, for the author and for the tests. */
export interface V6Features {
  /** worldCells is 512. */
  world512: boolean;
  /** A height is below 0 ft or at or above 512 ft, or the heights are in the 32-bit store. */
  tallHeights: boolean;
  /** A ground box needs 16-bit heights. */
  wideBoxes: boolean;
  /** The track's own water is outside Traxx's 0..510 ft (spec section 10, item 7). */
  tallWater: boolean;
  /** The document was opened from a .SI3. */
  fromSi3: boolean;
}

/*
  The version 6 features a document uses (spec 5.1, 8.3). A lake or waterfall never makes a track
  version 6: the world's size picks the .WTR and .WFL version (9.1, 9.3), so on a 256-cell track
  one above 2,048 ft is an error (lakes.ts LAKEERR_HEIGHT, falls.ts FALLERR_HEIGHT).
*/
export function v6Features(t: TxxTrack, fromSi3: boolean): V6Features {
  const [lo, hi] = trackHeightRangeV(t);
  return {
    world512: cellsOf(t) !== 256,
    tallHeights: lo < 0 || hi > CP4_V_MAX || isWideGrid(t.h16) || isWideGrid(t.fine),
    wideBoxes: t.groundBoxes.some((g) => !boxFitsByte(g)),
    tallWater: t.waterLevel4 < 0 || t.waterLevel4 > TRACK_WATER_MAX4,
    fromSi3,
  };
}

/** Whether a document must be written as a .SI3 with formatVersion 6. */
export function isV6Document(t: TxxTrack, fromSi3: boolean): boolean {
  const f = v6Features(t, fromSi3);
  return f.world512 || f.tallHeights || f.wideBoxes || f.tallWater || f.fromSi3;
}

/**
  The most placed objects a document may hold: V6_MAX_BOXES (16,384, spec 14) for a version 6
  document, else Traxx's MAXNPODBOXES (4096).
*/
export function objectLimit(t: TxxTrack, fromSi3: boolean): number {
  return isV6Document(t, fromSi3) ? V6_MAX_BOXES : TRAXX_MAX_BOXES;
}

/**
  The world the waterfalls of a document are judged and written in (spec 9.3): N and the step and
  base Write POD picks (pickStepAndBase) for a version 6 document, else FALL_WORLD_CLASSIC, so a
  track that is not version 6 keeps Traxx's 256 world and 1..4096 crest heights.
*/
export function fallWorldOf(t: TxxTrack, fromSi3: boolean): FallWorld {
  if (!isV6Document(t, fromSi3)) return FALL_WORLD_CLASSIC;
  return { cells: cellsOf(t), terrain: pickStepAndBase(t) };
}

/*
  The step and base (spec section 11): base = floor(lowest ft), step the largest power of two up
  to 128 with (highest - base) * step <= 65535. The ones the track was opened or imported with are
  kept when they still hold every height exactly (nothing would change), else new ones are picked.
*/
export function pickStepAndBase(t: TxxTrack): { step: number; base: number } {
  let [lo, hi] = trackHeightRangeV(t);
  // The ground boxes are heights by the same rule (spec 8.3), so they count as points of the track.
  for (const g of t.groundBoxes) {
    lo = Math.min(lo, g.lower * 256, g.upper * 256);
    hi = Math.max(hi, g.lower * 256, g.upper * 256);
  }
  /*
    The track's own water (64 v a half foot) counts too when it stands above every point, so the .TXV's range reaches
    it (spec section 10, item 7: a version 6 track's water has no 510 ft cap). Water under the lowest point covers
    nothing and does not move the base (CRAZY4X's 95 ft water under its 150 ft ground keeps its step and base).
  */
  const water = t.waterLevel4 !== 0 && t.waterLevel4 * 64 > hi ? t.waterLevel4 : 0;
  if (water !== 0) hi = water * 64;
  const step0 = t.heightStep, base0 = t.heightBase;
  const boxesFit = (step: number, base: number) => t.groundBoxes.every((g) => 2 * Math.min(g.lower, g.upper) >= base && (2 * Math.max(g.lower, g.upper) - base) * step <= 65535);
  const waterFits = (step: number, base: number) => water === 0 || water <= v6WaterRange(step, base)[1];
  if (step0 !== null && base0 !== null && fitsExactly(t, step0, base0) && boxesFit(step0, base0) && waterFits(step0, base0)) return { step: step0, base: base0 };
  return mtm2V6StepAndBase(lo / 128, hi / 128);
}

/** Every height of the track is a whole sample at this step and base, in 0..65535. */
function fitsExactly(t: TxxTrack, step: number, base: number): boolean {
  const g = heightSource(t);
  const per = 128 / step;
  const check = (v: number) => {
    const s = (v - base * 128) / per;
    return Number.isInteger(s) && s >= 0 && s <= 65535;
  };
  if (g) { for (let i = 0; i < g.length; i++) if (!check(g[i]!)) return false; return true; }
  for (let i = 0; i < t.heights.length; i++) if (!check(t.heights[i]! * 256)) return false;
  return true;
}

/** The samples of the heights at a step and base, N or 4N square, row by row. */
export function v6HeightSamples(t: TxxTrack, step: number, base: number): { samples: Uint16Array; side: number } {
  syncFromRaw(t);
  const n = cellsOf(t);
  const g = heightSource(t);
  const feet = new Float64Array(g ? g.length : t.heights.length);
  if (g) for (let i = 0; i < g.length; i++) feet[i] = g[i]! / 128;
  else for (let i = 0; i < t.heights.length; i++) feet[i] = t.heights[i]! * 2;
  const side = g && t.terrainMode === TERRAINMODE_FINE ? 4 * n : n;
  return { samples: mtm2V6SamplesFromFt(feet, step, base), side };
}

/** terrainGrid for a version 6 track: classic (Classic 8-bit and 16-bit), spline or fine (spec 7.2). */
export function v6TerrainGrid(t: Pick<TxxTrack, "terrainMode">): "classic" | "spline" | "fine" {
  if (t.terrainMode === TERRAINMODE_FINE) return "fine";
  if (t.terrainMode === TERRAINMODE_SPLINE) return "spline";
  return "classic";
}

/**
  The height file of a version 6 track (terrainHeightMap): with "Store heights as PNG" a greyscale
  PNG DATA\<stem>_H.PNG (8-bit for Classic 8-bit at step 128 and base 0, where the 8-bit sample b
  means b << 8 exactly as the raw byte does; 16-bit otherwise), else a u16 DATA\<stem>.RAW, which is
  the name the .LVL gives.
*/
export function v6HeightsEntry(t: TxxTrack, prefix: string, step: number, base: number): { name: string; bytes: Uint8Array } {
  const { samples, side } = v6HeightSamples(t, step, base);
  if (!t.pngHeights) return { name: `DATA\\${prefix}.RAW`, bytes: encodeMtm2HeightRaw16(samples) };
  const eight = t.terrainMode === TERRAINMODE_CLASSIC8 && step === 128 && base === 0;
  if (eight) {
    const bytes = new Uint8Array(samples.length);
    for (let i = 0; i < samples.length; i++) bytes[i] = samples[i]! >> 8;
    return { name: `DATA\\${prefix}_H.PNG`, bytes: encodeGreyPng(bytes, side, side, 8) };
  }
  return { name: `DATA\\${prefix}_H.PNG`, bytes: encodeGreyPng(samples, side, side, 16) };
}

/**
  The ground box grids of a version 6 track (spec 8.3): BuildRA01CL0 at N x N, 8-bit when every box
  is a whole number of 2 ft steps above the base in 1..255 (height = base + 2 * byte), else 16-bit
  (height = base + value / step). RA2..RA5, CL1 and CL2 are written empty at N x N, as Traxx does.
*/
export function v6GroundBoxGrids(t: TxxTrack, step: number, base: number): { depth: 8 | 16; grids: Record<"RA0" | "RA1" | "RA2" | "RA3" | "RA4" | "RA5" | "CL0" | "CL1" | "CL2", Uint8Array> } {
  const n = cellsOf(t);
  const byteOf = (u2: number) => (2 * u2 - base) / 2;
  const eight = t.groundBoxes.every((g) => {
    const lo = byteOf(g.lower), hi = byteOf(g.upper);
    return Number.isInteger(lo) && Number.isInteger(hi) && lo >= 0 && lo <= 255 && hi >= 1 && hi <= 255;
  });
  const depth: 8 | 16 = eight ? 8 : 16;
  const grids = emptyGroundBoxGrids(n, 8);
  const ra0 = depth === 8 ? grids.RA0 : new Uint8Array(2 * n * n);
  const ra1 = depth === 8 ? grids.RA1 : new Uint8Array(2 * n * n);
  const v0 = new DataView(ra0.buffer), v1 = new DataView(ra1.buffer), cv = new DataView(grids.CL0.buffer);
  const value16 = (u2: number, min: number) => {
    const s = Math.round((2 * u2 - base) * step);
    return s < min ? min : s > 65535 ? 65535 : s;
  };
  for (const g of t.groundBoxes) {
    const at = (g.x & (n - 1)) + (g.y & (n - 1)) * n;
    if (depth === 8) { ra0[at] = byteOf(g.lower); ra1[at] = byteOf(g.upper); }
    else { v0.setUint16(2 * at, value16(g.lower, 0), true); v1.setUint16(2 * at, value16(g.upper, 1), true); }
    for (let f = 0; f < 6; f++) cv.setUint16(at * 12 + f * 2, (g.faces[f] ?? 0) & 0xffff, true);
  }
  grids.RA0 = ra0;
  grids.RA1 = ra1;
  return { depth, grids };
}

/**
  The .TXV of a version 6 track: Traxx's record (WriteTXVFile's text, unknown keys carried over),
  with the section 6 keys set in place by setTxvValues (unknown keys and comments kept) and checked
  by writeTxv for a .SI3. CP4's terrainHeights is dropped: the heights are named by terrainHeightMap.
*/
export function v6Txv(traxxText: Uint8Array, situation: string, keys: { worldCells: number; terrainHeightMap: string; step: number; base: number; terrainGrid: string }): Uint8Array {
  const lines = parseTxv(traxxText);
  const set = setTxvValues(lines, {
    formatVersion: 6,
    worldCells: keys.worldCells,
    terrainHeightMap: keys.terrainHeightMap,
    terrainHeightStep: keys.step,
    terrainHeightBase: keys.base,
    terrainGrid: keys.terrainGrid,
    terrainHeights: null,
  });
  return writeTxv(set, { situation });
}
