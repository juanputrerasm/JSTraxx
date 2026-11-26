/*
  The track kind (Traxx origin/main, Include/TrackPOD.h: v6kind, worldcells, tallheights; TrackPOD/TrackPOD.cpp
  SetTrackKind, AdjustBoxHeightsForKind, NotTallValuesFit, WaterLevelMax4, LakeMaxHeightFor, FallMaxHeight;
  TrackPOD/TrackPODFile.cpp EndV6Read; Traxx/TraxxViewEdit.cpp OnSpecialTrackType).

  Three kinds, held explicitly on the track (TxxTrack.trackKind) and never guessed from its content:

    Classic          (v6 FALSE, 256, tall FALSE)  heights 0..65535 (511.99 ft), boxes in whole 2 ft steps,
                                                  water 0..1020 half-feet, 4,096 objects, .SIT / .SI2
    Standard V6      (v6 TRUE, 256 or 512, FALSE)  heights 0..65535 at 1/128 ft, water 0..1023, 16,384 objects, .SI3
    Tall Heights V6  (v6 TRUE, 256 or 512, TRUE)   heights 0..1,048,576 (8,192 ft), water 0..16384

  A 512 world is always version 6. No height, box, water, lake or fall is ever below 0.

  The store follows the ceiling (storeForKind): a tall track keeps its grid in an Int32Array, any other kind in a
  Uint16Array, so the editing tools clamp to the kind's ceiling through world.ts heightLimits. A grid that holds a
  value outside its kind's range (a TRAXXV99 file read as it was, txx.ts) stays 32-bit, and the save refuses it
  (txx.ts canSaveTxx, CanSaveBinary's sentences) until the author fixes it.
*/
import type { TxxGroundBox } from "./txx.ts";
import type { TraxxBox, TraxxTruck } from "./sit.ts";
import { TRAXX_MAX_BOXES, V6_MAX_BOXES } from "./sit.ts";
import { TERRAIN_H_CLASSIC_MAX, TERRAIN_H_TALL_MAX, cellsOf, type HeightGrid } from "./world.ts";
import { refreshRaw, syncFromRaw, TERRAINMODE_CLASSIC8, TERRAINMODE_CLASSIC16, TERRAINMODE_FINE, type Terrain16 } from "./terrain16.ts";
import { heightsChanged, setMode } from "./surface.ts";
import { FLAT_LTE, flatLte } from "./terrain.ts";
import { LAKE_MAX_HEIGHT } from "./lake-ground.ts";
import { fallEffectiveHeight, type TraxxFall } from "./falls.ts";

/** Classic, Standard V6 (precise ground boxes) or Tall Heights V6. */
export type TrackKind = "classic" | "standard" | "tall";
export const TRACK_KINDS: readonly TrackKind[] = ["classic", "standard", "tall"];

/** FALL_MAX_HEIGHT (Include/TrackPODFalls.h): a classic track's crest height cap, half-feet. */
export const FALL_MAX_HEIGHT = 4096;
/** LAKE_MAX_HEIGHT_V6 (Include/TrackPODLakes.h): the lake cap on a tall track (8,192 ft = the terrain ceiling / 64). */
export const LAKE_MAX_HEIGHT_V6 = 16384;
/** SetWaterLevel4's classic top: 255 whole 2 ft steps in quarters (510 ft). */
export const WATER_MAX4_CLASSIC = 4 * 255;

/** What the kind rules read. */
export interface HasTrackKind {
  /** Absent means classic (a record from before the kind existed). */
  trackKind?: TrackKind;
  worldCells?: number;
}

/** The kind, classic when the record does not say. */
export function trackKindOf(t: HasTrackKind | null | undefined): TrackKind {
  const k = t?.trackKind;
  return k === "standard" || k === "tall" ? k : "classic";
}

/** IsV6: Standard V6 or Tall Heights V6. */
export function isV6(t: HasTrackKind | null | undefined): boolean {
  return trackKindOf(t) !== "classic";
}

/** TallHeights. */
export function tallHeights(t: HasTrackKind | null | undefined): boolean {
  return trackKindOf(t) === "tall";
}

/** GetHeightLimit: TERRAIN_H_TALL_MAX when tall, else TERRAIN_H_CLASSIC_MAX (SetTrackKind's SetHeightLimit). */
export function heightLimitOf(kind: TrackKind): number {
  return kind === "tall" ? TERRAIN_H_TALL_MAX : TERRAIN_H_CLASSIC_MAX;
}

export function heightLimit(t: HasTrackKind): number {
  return heightLimitOf(trackKindOf(t));
}

/** WaterLevelMax4 (TrackPOD.cpp): 1020 on a classic track, the terrain ceiling / 64 on a v6 one (1023 not tall, 16384 tall). */
export function waterLevelMax4Of(kind: TrackKind): number {
  return kind === "classic" ? WATER_MAX4_CLASSIC : Math.floor(heightLimitOf(kind) / 64);
}

export function waterLevelMax4(t: HasTrackKind): number {
  return waterLevelMax4Of(trackKindOf(t));
}

/** LakeMaxHeightFor (TrackPOD.cpp): LAKE_MAX_HEIGHT (1023) on a classic track, limit / 64 on a v6 one. */
export function lakeMaxHeightForKind(v6: boolean, limit: number): number {
  return v6 ? Math.floor(limit / 64) : LAKE_MAX_HEIGHT;
}

/** LakeMaxHeight: the highest lake height (half-feet) the track takes. */
export function lakeMaxHeight(t: HasTrackKind): number {
  return lakeMaxHeightForKind(isV6(t), heightLimit(t));
}

/** FallMaxHeight: FALL_MAX_HEIGHT on a classic track, the lake cap on a v6 one. */
export function fallMaxHeight(t: HasTrackKind): number {
  return isV6(t) ? lakeMaxHeight(t) : FALL_MAX_HEIGHT;
}

/** MaxBoxes: MAXNPODBOXES (16,384) on a v6 track, MAXNPODBOXES_CLASSIC (4,096) otherwise. */
export function maxBoxes(t: HasTrackKind): number {
  return isV6(t) ? V6_MAX_BOXES : TRAXX_MAX_BOXES;
}

/** The kind File > New and Track Type take: (v6, cells, tall) as SetTrackKind accepts it, or null. */
export function kindAllowed(kind: TrackKind, cells: number): boolean {
  if (cells !== 256 && cells !== 512) return false;
  return !(cells === 512 && kind === "classic");
}

/*
  AdjustBoxHeightsForKind (TrackPOD.cpp): what a track kind does to one ground box. Not tall clamps both heights
  to 0..65535, classic also rounds them down to 2 ft (256 v) steps, and a box that had a top (upper > 0) keeps one
  above its bottom: 0 <= lower < upper, upper <= 65280 on classic, 65535 on v6. A box with upper == 0 is "no box"
  and stays so. Null when nothing changes.
*/
export function adjustBoxHeightsForKind(lower: number, upper: number, v6: boolean, tall: boolean): { lower: number; upper: number } | null {
  let lo = lower, up = upper;
  const hadtop = up > 0;
  if (!tall) {
    if (lo > TERRAIN_H_CLASSIC_MAX) lo = TERRAIN_H_CLASSIC_MAX;
    if (up > TERRAIN_H_CLASSIC_MAX) up = TERRAIN_H_CLASSIC_MAX;
    if (lo < 0) lo = 0;
    if (up < 0) up = 0;
  }
  if (!v6) {
    lo &= ~255;
    up &= ~255;
  }
  if ((lo !== lower || up !== upper) && hadtop && !tall) {
    const step = v6 ? 1 : 256;
    const top = v6 ? TERRAIN_H_CLASSIC_MAX : 65280;
    if (up <= lo) up = lo + step;
    if (up > top) {
      up = top;
      lo = up - step;
    }
  }
  if (lo === lower && up === upper) return null;
  return { lower: lo, upper: up };
}

/** The part of a track the kind operations read and change. */
export interface KindTrack extends Terrain16 {
  trackKind: TrackKind;
  worldCells: number;
  clr: Uint16Array;
  lte: Uint8Array | null;
  groundBoxes: TxxGroundBox[];
  boxes: TraxxBox[];
  trucks: TraxxTruck[];
  course: { cstart: number[]; cend: number[] }[];
  extendedCourses: ({ cstart: number[]; cend: number[] }[] | null)[];
  waterLevel4: number;
  lakes: { height: number }[];
  falls: TraxxFall[];
  vegetation: unknown;
  storedLakeMap?: unknown;
  lakeRule?: number;
}

/** The active grid: the fine grid on FINE, h16 on CLASSIC16 / SPLINE, null on CLASSIC8. */
function activeGrid(t: Pick<Terrain16, "terrainMode" | "h16" | "fine">): HeightGrid | null {
  if (t.terrainMode === TERRAINMODE_CLASSIC8) return null;
  return t.terrainMode === TERRAINMODE_FINE ? t.fine : t.h16;
}

/** NotTallValuesFit (TrackPOD.cpp): the active grid and every ground box fit 0..65535. */
export function notTallValuesFit(t: Pick<KindTrack, "terrainMode" | "h16" | "fine" | "groundBoxes">): boolean {
  const g = activeGrid(t);
  if (g) for (let i = 0; i < g.length; i++) { const v = g[i]!; if (v < 0 || v > TERRAIN_H_CLASSIC_MAX) return false; }
  for (const b of t.groundBoxes) {
    if (b.lower < 0 || b.lower > TERRAIN_H_CLASSIC_MAX || b.upper < 0 || b.upper > TERRAIN_H_CLASSIC_MAX) return false;
  }
  return true;
}

/*
  EndV6Read (TrackPODFile.cpp): a v6 track read from a file that does not say whether it is tall (a .SI3, or a
  JSTraxx TRAXXV99 .TXX) is tall when anything goes above what 16 bits of 1/128 ft hold: a height, a ground box,
  or the water, a lake or a fall above 65535 / 64 half-feet.
*/
export function v6KindByContent(t: Pick<KindTrack, "terrainMode" | "h16" | "fine" | "heights" | "rawShadow" | "groundBoxes" | "waterLevel4" | "lakes" | "falls"> & { worldCells?: number }): "standard" | "tall" {
  const wlimit = Math.floor(TERRAIN_H_CLASSIC_MAX / 64);
  syncFromRaw(t as Terrain16);
  const g = t.fine ?? t.h16;
  if (g) for (let i = 0; i < g.length; i++) if (g[i]! > TERRAIN_H_CLASSIC_MAX) return "tall";
  for (const b of t.groundBoxes) if (b.lower > TERRAIN_H_CLASSIC_MAX || b.upper > TERRAIN_H_CLASSIC_MAX) return "tall";
  if (t.waterLevel4 > wlimit) return "tall";
  for (const l of t.lakes) if (l.height > wlimit) return "tall";
  for (let i = 0; i < t.falls.length; i++) if (fallEffectiveHeight(t.falls, i, t.lakes) > wlimit) return "tall";
  return "standard";
}

/*
  JSTraxx: the store follows the kind. A tall track keeps its grids 32-bit; any other kind keeps them 16-bit when
  every value fits 0..65535 (else 32-bit, holding what the save will refuse). Values are kept exactly.
*/
export function storeForKind(t: Terrain16 & { trackKind?: TrackKind }): void {
  const tall = tallHeights(t);
  const convert = (g: HeightGrid | null): HeightGrid | null => {
    if (!g) return g;
    if (tall) return g instanceof Int32Array ? g : Int32Array.from(g);
    if (g instanceof Uint16Array) return g;
    for (let i = 0; i < g.length; i++) { const v = g[i]!; if (v < 0 || v > TERRAIN_H_CLASSIC_MAX) return g; }
    return Uint16Array.from(g);
  };
  const h16 = convert(t.h16), fine = convert(t.fine);
  if (h16 !== t.h16 || fine !== t.fine) {
    t.h16 = h16;
    t.fine = fine;
    heightsChanged(t);
  }
}

/** CountSpringFallsAbove: the spring falls (source 0) higher than maxheight half-feet, the ones SetTrackKind lowers. */
export function countSpringFallsAbove(falls: readonly TraxxFall[], maxheight: number): number {
  return falls.filter((f) => f.source === 0 && f.height > maxheight).length;
}

/*
  A new world of N cells (CTrackPODTerrain::SetWorldCells then SetNewWorldDefaults, and SetTrackKind's clearing):
  height 100 (raw, and h16 / fine as 100 << 8), no texture, the flat 0xed .LTE ground; no ground boxes, lakes,
  falls or vegetation. The mode is kept, except that CLASSIC8 becomes CLASSIC16 at 512. Walls are not cleared
  (they are not world-sized; a wall left outside a smaller world fails Problems, preflight and Save).
*/
function newWorld(t: KindTrack, n: number): void {
  const nn = n * n;
  if (n === 512 && t.terrainMode === TERRAINMODE_CLASSIC8) t.terrainMode = TERRAINMODE_CLASSIC16;
  const wide = t.h16 instanceof Int32Array || t.fine instanceof Int32Array;
  t.heights = new Uint8Array(nn).fill(100);
  t.clr = new Uint16Array(nn);
  t.lte = flatLte(FLAT_LTE, n);
  if (t.terrainMode === TERRAINMODE_FINE) {
    t.fine = (wide ? new Int32Array(16 * nn) : new Uint16Array(16 * nn)).fill(100 << 8);
    t.h16 = null;
  } else if (t.terrainMode !== TERRAINMODE_CLASSIC8) {
    t.h16 = (wide ? new Int32Array(nn) : new Uint16Array(nn)).fill(100 << 8);
    t.fine = null;
  } else t.h16 = t.fine = null;
  t.rawShadow = t.terrainMode === TERRAINMODE_CLASSIC8 ? null : t.heights.slice();
  t.worldCells = n;
  t.groundBoxes = [];
  t.lakes = [];
  t.falls = [];
  t.vegetation = null;
  t.storedLakeMap = null;
  delete t.lakeRule;
  heightsChanged(t);
}

/*
  SetTrackKind (TrackPOD.cpp): Classic only at 256, any kind at 256 or 512; false (nothing changed) for anything
  else, and for Classic on a track holding more than 4,096 objects. A v6 track cannot be CLASSIC8: it becomes
  CLASSIC16 (h16 = raw << 8). A change of world size is a new world (newWorld). Then the kind's rules: not tall
  clamps the active grid to 0..65535 (the mirror refreshed when a value moved), every ground box goes through
  AdjustBoxHeightsForKind, and the water, the spring falls and the lakes are held to the kind's ceilings.
*/
export function setTrackKind(t: KindTrack, kind: TrackKind, cells: number = cellsOf(t)): boolean {
  if (!kindAllowed(kind, cells)) return false;
  const v6 = kind !== "classic", tall = kind === "tall";
  if (!v6 && t.boxes.length > TRAXX_MAX_BOXES) return false;

  if (v6 && t.terrainMode === TERRAINMODE_CLASSIC8 && !setMode(t, TERRAINMODE_CLASSIC16)) return false;
  if (cells !== cellsOf(t)) newWorld(t, cells);

  t.trackKind = kind;
  t.worldCells = cells;

  if (!tall) {
    // Going (or staying) not tall: an 8-bit edit not yet folded in is folded first, then the grid is clamped.
    syncFromRaw(t);
    const g = activeGrid(t);
    if (g) {
      let clamped = false;
      for (let i = 0; i < g.length; i++) {
        const v = g[i]!;
        if (v > TERRAIN_H_CLASSIC_MAX) { g[i] = TERRAIN_H_CLASSIC_MAX; clamped = true; }
        else if (v < 0) { g[i] = 0; clamped = true; }
      }
      if (clamped) { refreshRaw(t); heightsChanged(t); }
    }
  }

  for (const b of t.groundBoxes) {
    const a = adjustBoxHeightsForKind(b.lower, b.upper, v6, tall);
    if (a) { b.lower = a.lower; b.upper = a.upper; }
  }

  const max4 = waterLevelMax4(t);
  if (t.waterLevel4 > max4) t.waterLevel4 = max4;
  const fallMax = fallMaxHeight(t);
  for (const f of t.falls) if (f.source === 0 && f.height > fallMax) f.height = fallMax;
  const lakeMax = lakeMaxHeight(t);
  for (const l of t.lakes) if (l.height > lakeMax) l.height = lakeMax;

  storeForKind(t);
  return true;
}

/*
  What Special > Track Type tells the author before it converts (TraxxViewEdit.cpp OnSpecialTrackType and its
  counters CountHeightsAbove512, CountPlacedAbove, CountBoxesAdjusted; CTrackTypeDlg::NoteFor). `refusal` is set
  (and nothing may change) when the track holds more objects than a classic track can; otherwise `message` is the
  confirmation's text without its closing question, "" when the change loses nothing and needs no question.
*/
export interface TrackTypeQuestion {
  refusal: string | null;
  message: string;
  /** The counts behind the message. */
  objects: number;
  lowered: number;
  floating: number;
  lowLakes: number;
  lowFalls: number;
  rounded: number;
  /** The water level after the change, quarter steps, when it is lowered; else null. */
  waterTo4: number | null;
}

/** CTrackTypeDlg::NoteFor. */
export function trackTypeNote(kind: TrackKind): string {
  if (kind === "classic") return "Works with retail, Community Patch 3 and Community Patch 4.";
  return "Version 6 tracks need Community Patch 4. Retail and Community Patch 3 won't list this track.";
}

/** The closing question of the Track Type confirmation. */
export const TRACK_TYPE_QUESTION = "\n\nChange the track type?";

function countHeightsAbove512(t: KindTrack): number {
  let count = 0;
  const g = activeGrid(t);
  if (g) for (let i = 0; i < g.length; i++) if (g[i]! > TERRAIN_H_CLASSIC_MAX) count++;
  for (const b of t.groundBoxes) {
    if (b.lower > TERRAIN_H_CLASSIC_MAX) count++;
    if (b.upper > TERRAIN_H_CLASSIC_MAX) count++;
  }
  return count;
}

function countPlacedAbove(t: KindTrack, ceilingv: number): number {
  let count = 0;
  for (const b of t.boxes) if (b.ipos[2] * 256 + b.fraction[2] > ceilingv) count++;
  for (const tr of t.trucks) if (tr.ipos[2] * 256 > ceilingv) count++;
  for (const c of [t.course, ...t.extendedCourses]) {
    if (!c) continue;
    for (const s of c) {
      if (s.cstart[2]! * 256 > ceilingv) count++;
      if (s.cend[2]! * 256 > ceilingv) count++;
    }
  }
  return count;
}

/** %.1f / %.2f of a half-feet value, as the C printf of a double does it here (whole quarters). */
function fixed(x: number, digits: number): string {
  return x.toFixed(digits);
}

export function trackTypeQuestion(t: KindTrack, to: TrackKind): TrackTypeQuestion {
  const from = trackKindOf(t);
  const out: TrackTypeQuestion = { refusal: null, message: "", objects: t.boxes.length, lowered: 0, floating: 0, lowLakes: 0, lowFalls: 0, rounded: 0, waterTo4: null };
  if (to === from) return out;
  if (to === "classic" && from !== "classic" && t.boxes.length > TRAXX_MAX_BOXES) {
    out.refusal = `This track has ${t.boxes.length} objects; a classic track holds at most 4,096. Delete objects first, then change the track type.`;
    return out;
  }
  if (from === "classic") {
    out.message = trackTypeNote(to);
    return out;
  }
  const lines: string[] = [];
  out.lowered = from === "tall" ? countHeightsAbove512(t) : 0;
  out.rounded = t.groundBoxes.filter((b) => adjustBoxHeightsForKind(b.lower, b.upper, to !== "classic", to === "tall") !== null).length;
  if (out.lowered > 0) lines.push(`${out.lowered} heights above 511.99 ft will be lowered to 511.99 ft.`);
  if (to !== "tall") {
    const ceilv = to === "classic" ? 255 * 256 : TERRAIN_H_CLASSIC_MAX;
    out.floating = countPlacedAbove(t, ceilv);
    if (out.floating > 0) {
      const n = out.floating;
      lines.push(`${n} object${n === 1 ? "" : "s"} sit${n === 1 ? "s" : ""} above ${to === "classic" ? "510 ft" : "511.99 ft"} and will float above the terrain.`);
    }
  }
  const newmax4 = waterLevelMax4Of(to);
  const newlake = lakeMaxHeightForKind(to !== "classic", heightLimitOf(to));
  const newfall = to === "classic" ? FALL_MAX_HEIGHT : newlake;
  out.lowFalls = countSpringFallsAbove(t.falls, newfall);
  out.lowLakes = t.lakes.filter((l) => l.height > newlake).length;
  if (t.waterLevel4 > newmax4) {
    out.waterTo4 = newmax4;
    lines.push(`The water level will be lowered to ${fixed(newmax4 / 2, 2)} ft.`);
  }
  if (out.lowLakes > 0) lines.push(`${out.lowLakes} lake${out.lowLakes === 1 ? "" : "s"} will be lowered to ${fixed(newlake / 2, 1)} ft.`);
  if (out.lowFalls > 0) lines.push(`${out.lowFalls} waterfall${out.lowFalls === 1 ? "" : "s"} will be lowered to ${fixed(newfall / 2, 1)} ft.`);
  if (out.rounded > 0) lines.push(`${out.rounded} ground boxes will be adjusted (heights rounded to 2 ft steps or kept in range).`);
  out.message = lines.join("\n");
  return out;
}

/** The Track Type error when SetTrackKind fails. */
export const TRACK_TYPE_NO_MEMORY = "Sorry, there is not enough memory to change the track type. The track is unchanged.";
