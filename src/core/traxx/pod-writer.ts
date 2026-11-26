/*
  Write POD (CTrackPOD::Save and the writers it calls, TrackPOD/TrackPODFile.cpp): a track's
  POD entries, in Traxx's order.

    ART\<stem>.ACT and .RAW      the track palette and an empty 64 tile
    every texture, terrain then model: the legacy .ACT and .RAW (left out when an HD source
      stands in and the author omits the fallback, or the texture failed to load), the HD
      source, and the _N / _AO map siblings
    DATA\ .ANI .CL0 .CL1 .CL2 .CLR .LTE .PUP .RA0-.RA5 .RAW .TEX .TTY .TXT, DATA\NULL,
      DATA\ZERO.RAW, FOG\<stem>.MAP, LEVELS\<stem>.LVL
    the models, the backdrop, the sounds (a .KLP before each continuous one), the music
    UI\ pictures, ART\<stem>_DTL / _MASK / _WDTL / _WMSK, the vegetation masks ART\<stem>_V / _G, the info
      photo, the HD track art
    WORLD\<stem>.SIT (.SI2 when any legacy fallback was left out, the terrain is not classic
      8-bit, the race rules are on or the track has more than 20 checkpoint boxes; .SI3 on a
      version 6 track), DATA\<stem>.TXV, WORLD\<stem>.VEG, WORLD\<stem>.CPX (race rules),
      WORLD\<stem>.WTR, WORLD\<stem>.WFL, WORLD\<stem>.TXT

  Traxx origin/main (1.8.2-beta): a version 6 track (.SI3) re-picks its height step and base on every
  write (v6.ts V6PickWriteScale, refused below 0 ft or past a 65,535 ft span) and writes its heights as
  the 16-bit DATA\<stem>_H.PNG with the 8-bit N*N DATA\<stem>.RAW mirror before it, its ground boxes
  as 16-bit .RA0 / .RA1, and the v6 keys in its .TXV. The race rules' WORLD\<stem>.CPX is built first
  (race-rules.ts buildTrackCpx): a refusal writes nothing. The .TEX list is positional: an empty slot
  writes RUSTPLAT.RAW, and a placeholder texture (a listed tile the pod never held) keeps its name
  and packs nothing.

  Traxx 1.7: DATA\<stem>.RAW is the mode's height file (64 KB, 128 KB or 2 MB). The vegetation
  goes out as the document holds it (the .VEG and its masks as bytes); the .WTR is rebuilt from
  the lakes (BuildWTR).

  Traxx 1.7.1: the waterfalls' WORLD\<stem>.WFL right after the .WTR, only when the lakes and
  every fall are free of errors (decided before the sounds: a fall's sound gets its .KLP, and the
  .TXV says waterfalls=<n>); otherwise Traxx's "Waterfalls not saved" report. The lakes are
  recomputed with the spillway notches the falls cut (UpdateLakeNotches).

  An entry whose name is already in the directory is not added again (PodItemExists).

  JSTraxx holds each texture's own tile and palette in memory, which is what Traxx re-reads
  from the ART folder; a tile built in memory from HD art (no .RAW anywhere) is written as
  Traxx writes that case, remapped into the track palette with the track palette beside it.
  MTM2 only: the MTM1 fog files (.MIX, .FOG, .LTE) are not written.
*/
import { JSTRAXX_VERSION } from "../version.ts";
import type { TrackDocument, TextureAsset } from "../doc/document.ts";
import { MTM2_ONLY } from "../doc/document.ts";
import { trackIndices } from "../view/tiles.ts";
import { metalcr2Act3, defaultFogMap } from "./palette.ts";
import { swapExt } from "./pod-items.ts";
import { uiBitmapName, uiInfoName } from "./terrain.ts";
import { hdDimensions } from "../image/hd-texture.ts";
import { stockIconCell } from "../image/bmp.ts";
import { writeTraxxSit, traxxSitDefaults, type TraxxSit } from "./sit.ts";
import { TRAXX_BOX_FOG, TRAXX_BOX_LIGHT } from "./sit.ts";
import { saveRaw, TERRAINMODE_CLASSIC8, TERRAINMODE_CLASSIC16, TERRAINMODE_FINE, TERRAINMODE_SPLINE } from "./terrain16.ts";
import { heightsPodPlan, HEIGHTS_PNG_NAME_TOO_LONG } from "./heights-png.ts";
import { buildLakeGround, surfaceFeet } from "./surface.ts";
import {
  buildWtr, buildWtrStored, buildWtrV6, lakeHeightWindowFor, overStoredLakes, recomputeLakes, storedLakeMapOf, storedLakesNotWritableText, storedLakesWritable,
  anyLakeErrors, lakeErrorText, LAKEERR_LAST, LAKES_NOT_SAVED, LAKE_RULE_EDGE, STORED_LAKES_NO_MEMORY, type LakesState,
} from "./lakes.ts";
import {
  buildWfl, fallErrors, fallErrorText, fallNameInPod, trackNotches, FALLERR_ROUGH, FALLFLAG_SOUND, FALL_NAMELEN, FALLS_NOT_SAVED,
  FALL_WORLD_CLASSIC,
} from "./falls.ts";
import { parseMtm2Veg } from "../../vendor/openphotex/mtm/veg.js";
import { vegBoundsProblem } from "./veg.ts";
import { cellsOf } from "./world.ts";
import { boxByte } from "./height-units.ts";
import { fallMaxHeight } from "./track-kind.ts";
import { fallWorldOf, isV6Track, v6GroundBoxGrids, v6HeightsEntry, v6PickWriteScale, v6RawMirror, v6TerrainGrid, v6WriteScaleRefusal, V6W_BELOW_ZERO, V6W_OK } from "./v6.ts";
import { buildTrackCpx, commitTrackCpx, CPX_RETAIL_BOXES } from "./race-rules.ts";
import { RACERULES_DRAG, RACERULES_NONE, RACERULES_RACE } from "./race-types.ts";
import { TRAXX_BOX_CHECKPOINT } from "./sit.ts";
import { vegGroundHeightClassic8 } from "../edit/veg-planter.ts";
import { f32 } from "./cformat.ts";
import { vegetationFromTxx } from "./veg.ts";
import { instPodTextureOk, vegModelsThatWillNotInstance, type VegInstanceIssue } from "./instancing.ts";
import { findAsset } from "../doc/names.ts";
import { findModelTexture } from "../doc/load-pod.ts";

/**
  Write POD refused before anything is written: Save's MessageBox, its text and caption ("Cannot build the pod" for
  the heights PNG's name and the race rules, "Write POD" for the version 6 scale). Nothing was written.
*/
export class PodBuildRefused extends Error {
  override name = "PodBuildRefused";
  readonly caption: string;
  constructor(message: string, caption = "Cannot build the pod") {
    super(message);
    this.caption = caption;
  }
}

/** Save's backstop for a v6 track the scale refuses (OnFileWritePOD checks first, with the lowest point named). */
export const V6_BELOW_ZERO_BACKSTOP = "Write POD can't write this track: version 6 tracks can't go below 0 ft. Raise the terrain or ground boxes below 0 ft (Adjust Heights) and try again.";
/** Save's refusal of a mode that disagrees with its height data. */
export const TERRAIN_MODE_DISAGREES = "Terrain mode and height data disagree; export refused.";

/** CountCheckpointBoxes (TrackPODFile.cpp): the type-6 boxes, copies included. */
export function countCheckpointBoxes(t: { boxes: readonly { type: number }[] }): number {
  return t.boxes.filter((b) => b.type === TRAXX_BOX_CHECKPOINT).length;
}

/**
  ExportWallGround (TrackPODFile.cpp): a wall's ground for CTrackPODWalls::Export, VegGroundHeight at (float) x and
  (float) z, in feet: the drive surface, or the engine's groundHeight1 on Classic 8-bit.
*/
export function exportWallGround(t: TrackDocument["track"]): (xft: number, zft: number) => number {
  if (t.terrainMode === TERRAINMODE_CLASSIC8) return (x, z) => vegGroundHeightClassic8(t.heights, f32(x), f32(z));
  return (x, z) => surfaceFeet(t, f32(x), f32(z));
}

/**
  What Write POD writes into WORLD\<stem>.WTR when the track holds a stored lake map (CTrackPOD::lakewrite):
  "computed" (the default: the lakes as Traxx fills them) or "stored" (the pod's own map, judged by the engine's
  own checks), the answer to AskStoredLakes.
*/
export type LakeWrite = "computed" | "stored";

/** The Write POD dialog's forced note (OnFileWritePOD's podexport_forcednote), or null when the tick is the author's. */
export function podExportForcedNote(t: TrackDocument["track"]): string | null {
  if (isV6Track(t)) return "This track is written as a version 6 track (.SI3). Retail Monster Truck Madness 2 and Community Patch 3 won't list it; it needs Community Patch 4.";
  if (t.terrainMode !== TERRAINMODE_CLASSIC8) return "16-bit and 8 ft terrain: old game builds cannot read it.";
  if (countCheckpointBoxes(t) > CPX_RETAIL_BOXES) return "More than 20 checkpoints: only new builds can load this track, so it is written as .SI2.";
  return null;
}

/**
  OnFileWritePOD's refusals, before any dialog (Traxx/TraxxDoc.cpp): lakes in error ("Lakes need
  fixing", Traxx 1.7), then waterfalls in error ("Waterfalls need fixing", 1.7.1), one line per
  error bit, "Nothing was written." at the end. The lakes are recomputed with the falls' notches
  first, and a fall's lip is judged on the ground as it is now. Null when the build may go on.
  Traxx 1.7.3: the export always writes the EDGE rule, so it is judged under it too (the notch
  codes worded for the notch edge); the document's own rule is left as it is.

  Traxx origin/main: with a stored lake map kept (`lakeWrite` "stored", the Yes of AskStoredLakes) the lakes are not
  judged by Traxx's flood errors, the falls read the stored map, and the map is judged by the engine's own checks
  (StoredWritable) once the version 6 scale is known. A version 6 track the scale cannot hold is refused between
  the two, caption "Write POD" (V6PickWriteScale, with the lowest point named).
*/
export function podRefusal(doc: TrackDocument, lakeWrite: LakeWrite = "computed"): { title: string; text: string } | null {
  const t = doc.track;
  const notches = trackNotches({ falls: t.falls, worldCells: t.worldCells, lakeRule: LAKE_RULE_EDGE });
  const ground = buildLakeGround(t);
  const keep = lakeWrite === "stored" && storedLakeMapOf(t) !== null;
  const fill = t.lakes.length && ground ? recomputeLakes(ground, t.lakes, t.waterLevel4, notches) : null;
  const list = (lines: string[]) => {
    const out: string[] = [];
    let len = 0;
    for (const line of lines) {
      if (len + 300 >= 4096 - 64) { out.push("...\n"); break; }
      out.push(line);
      len += line.length;
    }
    return `${out.join("")}\nNothing was written.`;
  };
  if (t.lakes.length) {
    if (!ground || !fill) return { title: "Lakes need fixing", text: "There was not enough memory to check the lakes against the terrain.\n\nNothing was written." };
    // A kept stored map is judged after the version 6 scale is known (below): its height window needs it.
    if (!keep && anyLakeErrors(fill) !== 0) {
      const lines: string[] = [];
      fill.lakes.forEach((l, li) => { for (let bit = 1; bit <= LAKEERR_LAST; bit <<= 1) if (l.errors & bit) lines.push(`Lake ${li + 1}: ${lakeErrorText(bit)}\n`); });
      return { title: "Lakes need fixing", text: list(lines) };
    }
  }
  const st = fill && keep ? overStoredLakes(t, fill) : fill;
  const falls = t.falls ?? [];
  // Track format version 6 (spec 9.3): the falls are judged in the track's N world and height range.
  const world = falls.length ? fallWorldOf(t) : FALL_WORLD_CLASSIC;
  const lakes = { lakes: t.lakes, tmap: st?.tmap ?? null, world, rule: LAKE_RULE_EDGE };
  const names = fallNameInPod(t.sounds, doc.textures, doc.modelTextures);
  const lines: string[] = [];
  falls.forEach((_, fi) => {
    const errors = fallErrors(falls, fi, lakes, names, ground);
    for (let bit = 1; bit <= FALLERR_ROUGH; bit <<= 1) if (errors & bit) lines.push(`Waterfall ${fi + 1}: ${fallErrorText(bit, world, true)}\n`);
  });
  if (lines.length) return { title: "Waterfalls need fixing", text: list(lines) };

  // VERSION 6 (.SI3): the heights are 16-bit samples from a whole-foot base up, and the engine takes no negative base.
  let step = 128, base = 0;
  if (isV6Track(t)) {
    const scale = v6PickWriteScale(t);
    const why = v6WriteScaleRefusal(scale);
    if (why) return { title: "Write POD", text: why };
    step = scale.step;
    base = scale.base;
  }
  if (keep) {
    const bad = ground ? storedLakesWritable(t, ground, t.waterLevel4, lakeHeightWindowFor(isV6Track(t), cellsOf(t), step, base)) : 0;
    if (!ground) return { title: "Lakes need fixing", text: STORED_LAKES_NO_MEMORY };
    if (bad !== -1) return { title: "Lakes need fixing", text: storedLakesNotWritableText(bad) };
  }
  return null;
}

/** ANIFRAMENAMEMAX. */
const ANI_FRAME_NAME_MAX = 15;
const POD_NAME_MAX = 31;

/** Art found beside a texture in the ART folder or the library: its HD source and map siblings. */
export interface TextureExtras {
  hd: { ext: "PNG" | "TGA"; data: Uint8Array } | null;
  maps: { suffix: string; ext: "PNG" | "TGA"; data: Uint8Array }[];
}

export interface PodWriteOptions {
  /** By texture name, upper case. */
  extras?: ReadonlyMap<string, TextureExtras>;
  /** The TXV's built= date. */
  date?: Date;
  /** The .WTR of a track with a stored lake map: Traxx's fill (the default) or the stored map (AskStoredLakes' Yes). */
  lakeWrite?: LakeWrite;
}

export interface PodWriteResult {
  comment: string;
  entries: { name: string; data: Uint8Array }[];
  /** A legacy fallback was left out: the situation file is .SI2. */
  omittedAny: boolean;
  /** Track format version 6: the situation file is .SI3 and the .TXV says formatVersion=6 (v6.ts). */
  v6: boolean;
  anyHdOver256: boolean;
  /** Textures the writer could not stand behind (g_podBadTex). */
  badTextures: string[];
  /** Animation frame names over 15 characters (g_podLongAniFrame). */
  longFrames: string[];
  /** What was not written as Traxx would write it, for the author. */
  warnings: string[];
  /** Traxx 1.7: the vegetation models the game will not instance (VegModelsThatWillNotInstance), when a .VEG was written. */
  vegNotInstanced: VegInstanceIssue[];
  /** Version 6: the height step and base the track was written with (V6PickWriteScale), else null. */
  v6Scale: { step: number; base: number } | null;
  /** The race rules' WORLD\<stem>.CPX was written (the type-6 boxes were put in its order, CTrackPOD::Save). */
  cpx: boolean;
}

const ascii = (s: string) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };
const text = (lines: string[]) => ascii(lines.join(""));
const afterSlash = (name: string) => { const i = name.indexOf("\\"); return i >= 0 ? name.slice(i + 1) : name; };
const latin1 = (b: Uint8Array, from = 0, to = b.length) => { let s = ""; for (let i = from; i < to && b[i]; i++) s += String.fromCharCode(b[i]!); return s; };

/**
  GetMaxTextureIndex (TrackPOD.cpp): the highest texture index the terrain's colour words (low 12 bits) and the
  ground boxes' faces use, capped at MAXNPODTEXTURES - 1. 0 when nothing uses one.
*/
export function maxTextureIndex(t: { clr: ArrayLike<number>; worldCells?: number; groundBoxes: readonly { faces: readonly number[] }[] }): number {
  let max = 0;
  const n = cellsOf(t);
  for (let i = 0; i < n * n && i < t.clr.length; i++) { const v = t.clr[i]! & 0x0fff; if (v > max) max = v; }
  for (const g of t.groundBoxes) for (let f = 0; f < 6; f++) { const v = (g.faces[f] ?? 0) & 0x0fff; if (v > max) max = v; }
  return max >= MAXNPODTEXTURES ? MAXNPODTEXTURES - 1 : max;
}

/** MAXNPODTEXTURES. */
const MAXNPODTEXTURES = 1024;

/**
  WriteTEXFile (122c43d): the count is GetMaxTextureIndex() + 1, the highest index the terrain and the ground boxes
  use, then every slot up to it in order, each texture's name without its folder. The list is positional (tile ids
  index it), so a slot is never skipped: an empty one writes the placeholder name RUSTPLAT.RAW. Slots past the count
  are not listed.
*/
export function writeTex(textures: readonly (TextureAsset | null)[], maxIndex: number): Uint8Array {
  const n = maxIndex + 1;
  const lines = [`${n}\r\n`];
  for (let i = 0; i < n; i++) lines.push(`${textures[i] ? afterSlash(textures[i]!.name) : "RUSTPLAT.RAW"}\r\n`);
  return text(lines);
}

/** WriteTTYFile: textures with a type, "NAME,type*100+depth". */
export function writeTtyFile(doc: TrackDocument): Uint8Array {
  const typed = doc.textures.map((t, i) => ({ t, info: doc.track.textures[i] })).filter((x) => x.t && x.info && x.info.type !== 0);
  return text([`${typed.length}\r\n`, ...typed.map((x) => `${afterSlash(x.t!.name)},${100 * x.info!.type + x.info!.depth}\r\n`)]);
}

/** WriteANIFile: base name, "frames,65*period", frame names; NULL.RAW for a missing texture. */
export function writeAniFile(doc: TrackDocument, longFrames: string[]): Uint8Array {
  const anis = doc.track.animations;
  const lines = [`${anis.length}\r\n`];
  const nameOf = (i: number) => {
    const n = doc.textures[i]?.name ?? "NULL.RAW";
    const line = `${n.startsWith("ART\\") ? n.slice(4) : n}\r\n`;
    if (line.length > ANI_FRAME_NAME_MAX + 2) longFrames.push(line.trim());
    return line;
  };
  for (const a of anis) {
    lines.push(nameOf(a.frames[0]!), `${a.nframes},${65 * a.period}\r\n`);
    for (let j = 0; j < a.nframes; j++) lines.push(nameOf(a.frames[j]!));
  }
  return text(lines);
}

/**
  MusicKindOf (Include/TrackPOD.h): what the music blob is, from its bytes. The order is the
  rule: RIFF a WAV, "MUSIC" a stock pick ("MUSIC\NAME.WAV", nothing packed), OggS an OGG
  Vorbis, ID3 or an MPEG audio frame sync an MP3, anything else a MOD.
*/
export function musicKind(m: Uint8Array | null): "wav" | "mp3" | "ogg" | "stock" | "mod" | null {
  if (!m) return null;
  if (m.length < 4) return "mod";
  if (latin1(m, 0, 4) === "RIFF") return "wav";
  if (m.length >= 5 && latin1(m, 0, 5) === "MUSIC") return "stock";
  if (latin1(m, 0, 4) === "OggS") return "ogg";
  if (latin1(m, 0, 3) === "ID3") return "mp3";
  // Layer bits 00 are AAC ADTS (and FF FE a UTF-16LE BOM); version bits 01 are reserved.
  if (m[0] === 0xff && (m[1] & 0xe0) === 0xe0 && (m[1] & 0x06) !== 0 && ((m[1] >> 3) & 3) !== 1) return "mp3";
  return "mod";
}

/** WriteLVLFile. */
export function writeLvl(doc: TrackDocument): Uint8Array {
  const t = doc.track;
  const mtm2 = (t.versionFlags & MTM2_ONLY) !== 0;
  const p = t.prefix;
  const low = (s: string) => `${s.toLowerCase()}\r\n`;
  const kind = musicKind(t.music);
  const music = kind === "stock" ? latin1(t.music!, 6) : kind === "wav" || kind === "mp3" || kind === "ogg" ? `${p}.${kind}` : `${p}.mod`;
  const sun = t.sun ?? { vector: [-46333, -46333, 0], shadowIntensity: 32768, position: [32000, -46333, 0], intensity: 64000 };
  const lines = [
    mtm2 ? "0\r\n" : "4\r\n",
    low(`${p}.txt`), low(`${p}.raw`), low(`${p}.clr`), low(`${p}.act`), low(`${p}.tex`), low("zero.raw"), low(`${p}.pup`),
    low(`${p}.ani`), low(`${p}.tdf`), low(mtm2 ? "cloudy2.raw" : "aliensky.raw"), low(mtm2 ? "cloudy2.act" : "earthsky.act"),
    low(`${p}.def`), low(`${p}.nav`), low(music), low(`${p}.fog`), low(`${p}.lte`),
    `${sun.vector[0]},${sun.vector[1]},${sun.vector[2]}\r\n${sun.shadowIntensity}\r\n`,
    `${sun.position[0]},${sun.position[1]},${sun.position[2]}\r\n${sun.intensity}\r\n`,
    `${doc.carry.levelValue}\r\n`,
  ];
  // MTM2 only, or a v6 track whatever its flags (the engine reads the height back as the window's water), when > 0.
  if ((mtm2 || isV6Track(t)) && t.waterLevel4 > 0) lines.push("!waterHeight\r\n", `${t.waterLevel4}\r\n`);
  return text(lines);
}

/** TXVKeyIsOurs: the keys WriteTXVFile writes itself, so a carried copy is never written back. */
const OUR_TXV_KEYS = new Set(["formatversion", "tool", "toolversion", "built", "legacyfallback", "hdtextures", "fogvolumes",
  "vegetation", "vegtrees", "vegclumps", "terraingrid", "terrainheights", "waterfalls", "racerules",
  // ...and the v6 keys, written only for a v6 track: a stale copy must not be carried over or written twice.
  "worldcells", "terrainheightmap", "terrainheightstep", "terrainheightbase"]);

/** The key of a .TXV line as TXVKeyIsOurs reads it: blanks around it trimmed, lower case. */
const txvKeyOf = (line: string) => line.replace(/^[ \t]+/, "").split("=")[0].replace(/[ \t]+$/, "").toLowerCase();

/**
  WriteTXVFile: the version record, with any key it does not own carried over.

  formatVersion: 2 for a Light or Moving box, 4 for a Fog (with fogVolumes=<n>), at least 3 for
  a .VEG with placements, at least 5 for any terrain mode but classic 8-bit. `vegetation` is the
  packed .VEG's placement counts (vegetation=1, vegTrees=, vegClumps= when it has any).
  `waterfalls`: the falls in the .WFL being written (waterfalls=<n>, informational), 0 for none.

  Traxx origin/main: formatVersion 6 for race rules (with raceRules=drag|race|parallel after waterfalls), for more
  than 20 checkpoint boxes (no key), and for a v6 track, whose keys (worldCells, terrainHeightMap = `heightsEntry`,
  terrainHeightStep, terrainHeightBase from `v6`) follow terrainGrid; a v6 track never writes terrainHeights=.
*/
export function writeTxvFile(doc: TrackDocument, legacyFallback: boolean, hdTextures: boolean, date: Date, vegetation: { trees: number; clumps: number } | null = null, heightsEntry = "", waterfalls = 0, v6: { step: number; base: number } | null = null): Uint8Array {
  const t = doc.track;
  const rules = t.raceRules?.mode ?? RACERULES_NONE;
  let formatVersion = t.boxes.some((b) => b.type === TRAXX_BOX_LIGHT || b.type === 13) ? 2 : 1;
  const fogs = t.boxes.filter((b) => b.type === TRAXX_BOX_FOG).length;
  if (fogs) formatVersion = 4;
  const vegKeys = vegetation && (vegetation.trees || vegetation.clumps) ? vegetation : null;
  if (vegKeys && formatVersion < 3) formatVersion = 3;
  if (t.terrainMode !== TERRAINMODE_CLASSIC8 && formatVersion < 5) formatVersion = 5;
  // 6: a .CPX (race rules on), more than 20 checkpoint boxes (engine MAX_CHECKPOINTS is 100), a v6 track.
  if (rules !== RACERULES_NONE && formatVersion < 6) formatVersion = 6;
  if (countCheckpointBoxes(t) > CPX_RETAIL_BOXES && formatVersion < 6) formatVersion = 6;
  const v6keys = isV6Track(t) && v6 !== null;
  if (v6keys && formatVersion < 6) formatVersion = 6;
  const pad = (n: number) => String(n).padStart(2, "0");
  const lines = [
    "# MTM2 track version record - written by JSTraxx\r\n",
    `formatVersion=${formatVersion}\r\n`, "tool=JSTraxx\r\n", `toolVersion=${JSTRAXX_VERSION}\r\n`,
    `built=${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}\r\n`,
    `legacyFallback=${legacyFallback ? 1 : 0}\r\n`, `hdTextures=${hdTextures ? 1 : 0}\r\n`,
  ];
  if (t.terrainMode === TERRAINMODE_SPLINE || t.terrainMode === TERRAINMODE_FINE) {
    lines.push(`terrainGrid=${t.terrainMode === TERRAINMODE_SPLINE ? "spline" : "fine"}\r\n`);
  }
  if (v6keys) {
    lines.push(`worldCells=${cellsOf(t)}\r\n`);
    if (heightsEntry) lines.push(`terrainHeightMap=${heightsEntry}\r\n`);
    lines.push(`terrainHeightStep=${v6!.step}\r\nterrainHeightBase=${v6!.base}\r\n`);
  } else if (heightsEntry) lines.push(`terrainHeights=${heightsEntry}\r\n`);
  if (fogs) lines.push(`fogVolumes=${fogs}\r\n`);
  if (vegKeys) lines.push(`vegetation=1\r\nvegTrees=${vegKeys.trees}\r\nvegClumps=${vegKeys.clumps}\r\n`);
  // Only when the .WFL was written: informational, no formatVersion bump (handover 7).
  if (waterfalls > 0) lines.push(`waterfalls=${waterfalls}\r\n`);
  // Only when the .CPX was written.
  if (rules !== RACERULES_NONE) lines.push(`raceRules=${rules === RACERULES_DRAG ? "drag" : rules === RACERULES_RACE ? "race" : "parallel"}\r\n`);
  const carried = doc.carry.txvText;
  if (carried) {
    let header = false;
    for (const line of carried.split(/[\r\n]+/)) {
      if (!line || line.length >= 508 || line[0] === "#" || !line.includes("=")) continue;
      if (OUR_TXV_KEYS.has(txvKeyOf(line))) continue;
      if (!header) { lines.push("# carried over from the previous build\r\n"); header = true; }
      lines.push(`${line}\r\n`);
    }
  }
  return text(lines);
}

/** A .VEG's placement counts (the .TXV's vegTrees and vegClumps); null when it cannot be read. */
export function vegCounts(image: Uint8Array): { trees: number; clumps: number } | null {
  try {
    const v = parseMtm2Veg(image);
    return { trees: v.trees.count, clumps: v.clumps.count };
  } catch {
    return null;
  }
}

/** The situation file Traxx's WriteSITFile writes, from the document. */
export function traxxSitOf(doc: TrackDocument): TraxxSit {
  const t = doc.track;
  return {
    ...traxxSitDefaults(),
    prefix: t.prefix, trackName: t.trackName, localeName: t.localeName, logoBmpName: t.logoBmpName, mapBmpName: t.mapBmpName,
    trackType: t.trackType, mtm2Only: (t.versionFlags & MTM2_ONLY) !== 0, ambientSound: t.ambientSound, weatherMask: t.weatherMask,
    trucks: t.trucks, boxes: t.boxes, cylinderCount: doc.carry.cylinderCount, cylinderRaw: doc.carry.cylinderRaw,
    course: t.course, extendedCourses: t.extendedCourses, arena: t.arena, backdropName: t.backdropName, extraBackdrops: t.arena ? [] : t.extraBackdrops, objectsDropped: doc.objectsDropped,
  };
}

/** BuildRA01CL0: each box's heights (BoxByte: v >> 8, 0..255) and six face words at its cell. */
export function groundBoxGrids(doc: TrackDocument): { ra0: Uint8Array; ra1: Uint8Array; cl0: Uint8Array } {
  const ra0 = new Uint8Array(65536), ra1 = new Uint8Array(65536), cl0 = new Uint8Array(12 * 65536);
  const v = new DataView(cl0.buffer);
  for (const g of doc.track.groundBoxes) {
    const at = (g.x & 255) + ((g.y & 255) << 8);
    ra0[at] = boxByte(g.lower);
    ra1[at] = boxByte(g.upper);
    for (let f = 0; f < 6; f++) v.setUint16(at * 12 + f * 2, (g.faces[f] ?? 0) & 0xffff, true);
  }
  return { ra0, ra1, cl0 };
}

export function buildTrackPod(doc: TrackDocument, options: PodWriteOptions = {}): PodWriteResult {
  const t = doc.track;
  const p = t.prefix;
  const entries: { name: string; data: Uint8Array }[] = [];
  const names = new Set<string>();
  const has = (name: string) => names.has(name.toUpperCase());
  const add = (name: string, data: Uint8Array) => {
    if (has(name)) return false;
    names.add(name.toUpperCase());
    entries.push({ name, data });
    return true;
  };
  const badTextures: string[] = [];
  const longFrames: string[] = [];
  const warnings: string[] = [];
  // A version 6 track (its kind, track-kind.ts IsV6) is a .SI3; a classic one is written as Traxx writes it.
  const v6 = isV6Track(t);
  const cells = cellsOf(t);
  // A 512 world is only ever a v6 track: anything else is refused before anything is written (Save, no message of its own).
  if (cells !== 256 && !(cells === 512 && v6)) throw new PodBuildRefused("A 512-cell world is only ever a version 6 track; this one cannot be written.");
  /*
    REFUSE A MODE THAT DISAGREES WITH ITS HEIGHT DATA, before anything is written (Save): the mode decides the .RAW's
    length, the .TXV key and the .SI2 path. Nothing in Traxx can make this happen; this is the guard against the bug
    that does.
  */
  {
    const m = t.terrainMode;
    const consistent = ((m === TERRAINMODE_CLASSIC8 && !t.h16 && !t.fine) || ((m === TERRAINMODE_CLASSIC16 || m === TERRAINMODE_SPLINE) && Boolean(t.h16)) ||
      (m === TERRAINMODE_FINE && Boolean(t.fine))) && t.heights.length === cells * cells;
    if (!consistent) throw new PodBuildRefused(TERRAIN_MODE_DISAGREES);
  }
  // ANY MODE BUT CLASSIC 8-BIT, and a v6 track, force the no-fallback path (ExportOmitsRawFallback).
  const classic = t.terrainMode === TERRAINMODE_CLASSIC8;
  const omitFallback = t.omitRawFallback || v6 || !classic;
  let anyHdOver256 = false;
  /*
    A V6 TRACK: the scale is picked BEFORE anything is written, so a track the format cannot hold (below 0 ft, or a span
    no 16-bit sample holds) is refused with nothing written. OnFileWritePOD refuses first with the lowest point named
    (podRefusal); this is Save's backstop.
  */
  let stepBase: { step: number; base: number } | null = null;
  if (v6) {
    const scale = v6PickWriteScale(t);
    if (scale.verdict !== V6W_OK) throw new PodBuildRefused(scale.verdict === V6W_BELOW_ZERO ? V6_BELOW_ZERO_BACKSTOP : v6WriteScaleRefusal(scale)!, "Write POD");
    stepBase = { step: scale.step, base: scale.base };
  }
  /*
    RACE RULES (RACE_RULES_FORMAT.md): WORLD\<stem>.CPX, built FIRST, so a map the rules refuse stops the export with
    nothing written ("Race rules: <why>", caption "Cannot build the pod"). Only once the build has succeeded are the
    type-6 boxes put in the sorted order and the track type forced (commitTrackCpx), so the .SIT and the .CPX agree.
  */
  const cpx = buildTrackCpx(t, t.raceRules, { prefix: p, ground: exportWallGround(t), worldFt: cells * 32 });
  if (cpx && !cpx.ok) throw new PodBuildRefused(cpx.message);
  if (cpx && cpx.ok) commitTrackCpx(t, cpx);
  /*
    What the pod ACTUALLY contains decides the situation file and the .TXV (omitted_any): a non-classic terrain, a v6
    track, the race rules on (the engine that reads the .CPX is the one that reads .SI2), and more than 20 checkpoint
    boxes, copies counted (retail holds 20 and quits on load past that), all write .SI2 and legacyFallback=0.
  */
  let omittedAny = !classic || v6 || t.raceRules.mode !== RACERULES_NONE || countCheckpointBoxes(t) > CPX_RETAIL_BOXES;

  add(`ART\\${p}.ACT`, t.palette.slice(0, 768));
  add(`ART\\${p}.RAW`, new Uint8Array(4096));

  const writeTexture = (tex: TextureAsset) => {
    if (!tex.indices || !tex.side) { badTextures.push(`${tex.name} (nothing in memory to write)`); return; }
    if (tex.bad) badTextures.push(`${tex.name} (could not be loaded when the track was opened)`);
    const tname = tex.name;
    const extra = options.extras?.get(tname.toUpperCase());
    const hd = tex.hd ?? extra?.hd ?? null;
    if (hd) {
      const dim = hdDimensions(hd.ext, hd.data);
      if (dim && (dim.width > 256 || dim.height > 256)) anyHdOver256 = true;
      if (omitFallback || tex.bad) omittedAny = true;
    }
    if ((!hd || (!omitFallback && !tex.bad)) && !has(tname)) {
      const aname = tname.toUpperCase().includes(".RAW") ? tname.replace(/\.RAW/i, ".ACT") : tname;
      // Neither half on disk: the tile in the track palette, with the track palette.
      const fromMemory = Boolean(tex.legacyBuilt || tex.bad);
      const act = fromMemory ? t.palette.slice(0, 768) : tex.trackIndexed ? t.palette.slice(0, 768) : (tex.act ?? metalcr2Act3()).slice(0, 768);
      const raw = fromMemory ? trackIndices(tex, t.palette) ?? tex.indices : tex.indices;
      if (aname !== tname) add(aname, act);
      add(tname, raw.slice(0, tex.side * tex.side));
    }
    if (hd) {
      const stem = tname.lastIndexOf(".") > 0 ? tname.slice(0, tname.lastIndexOf(".")) : tname;
      const hdName = `${stem}.${hd.ext}`.toUpperCase();
      if (hdName.length <= POD_NAME_MAX) add(hdName, hd.data);
    }
    for (const m of extra?.maps ?? []) {
      const stem = tname.lastIndexOf(".") > 0 ? tname.slice(0, tname.lastIndexOf(".")) : tname;
      const mapName = `${stem}${m.suffix}.${m.ext}`.toUpperCase();
      if (mapName.length <= POD_NAME_MAX) add(mapName, m.data);
    }
  };
  // A placeholder keeps its .TEX slot but has nothing real to pack (122c43d).
  for (const tex of doc.textures) if (tex && !tex.placeholder) writeTexture(tex);
  for (const tex of doc.modelTextures) writeTexture(tex);

  // Every grid is N x N cells (format version 6, spec 8.2); N is 256 on every Traxx track.
  const nn = cells * cells;
  const boxes = stepBase ? v6GroundBoxGrids(t, stepBase.step, stepBase.base) : null;
  const { ra0, ra1, cl0 } = boxes ? { ra0: boxes.RA0, ra1: boxes.RA1, cl0: boxes.CL0 } : groundBoxGrids(doc);
  const clr = new Uint8Array(2 * nn);
  const cv = new DataView(clr.buffer);
  for (let c = 0; c < nn; c++) cv.setUint16(c * 2, t.clr[c] ?? 0, true);
  const lte = new Uint8Array(7 * nn);
  if (t.lte) lte.set(t.lte.subarray(0, 7 * nn));
  add(`DATA\\${p}.ANI`, writeAniFile(doc, longFrames));
  add(`DATA\\${p}.CL0`, cl0);
  add(`DATA\\${p}.CL1`, boxes ? boxes.CL1 : new Uint8Array(262144));
  add(`DATA\\${p}.CL2`, boxes ? boxes.CL2 : new Uint8Array(786432));
  add(`DATA\\${p}.CLR`, clr);
  add(`DATA\\${p}.LTE`, lte);
  add(`DATA\\${p}.PUP`, new Uint8Array(0));
  add(`DATA\\${p}.RA0`, ra0);
  add(`DATA\\${p}.RA1`, ra1);
  for (const n of [2, 3, 4, 5] as const) add(`DATA\\${p}.RA${n}`, boxes ? boxes[`RA${n}`] : new Uint8Array(65536));
  // THE HEIGHTS: the mode's height file after SyncFromRaw, and with "Store heights as PNG"
  // DATA\<stem>_H.PNG beside it (Classic 8-bit) or in its place (heights-png.ts). A PNG that
  // cannot go in refuses the whole pod, as Traxx does. A version 6 track always writes the
  // classic 8-bit N*N .RAW (the raw mirror: the .LVL names it and the engine ignores it while a
  // map is set), then its terrainHeightMap, the 16-bit DATA\<stem>_H.PNG at the step and base
  // picked above (Save, EncodeV6SamplesPng).
  let heightsKey = "";
  if (stepBase) {
    const map = v6HeightsEntry(t, p, stepBase.step, stepBase.base);
    if (map.name.length > POD_NAME_MAX) throw new PodBuildRefused(HEIGHTS_PNG_NAME_TOO_LONG);
    add(`DATA\\${p}.RAW`, v6RawMirror(t));
    add(map.name, map.bytes);
    heightsKey = map.name;
  } else {
    const heights = heightsPodPlan(t, p, t.pngHeights);
    if (heights.error) throw new PodBuildRefused(heights.error);
    if (heights.raw) add(`DATA\\${p}.RAW`, saveRaw(t));
    if (heights.png) add(heights.png.name, heights.png.bytes);
    heightsKey = heights.txvKey;
  }
  add(`DATA\\${p}.TEX`, writeTex(doc.textures, maxTextureIndex(t)));
  add(`DATA\\${p}.TTY`, writeTtyFile(doc));
  add(`DATA\\${p}.TXT`, t.infoText ? t.infoText.slice() : new Uint8Array(0));
  add("DATA\\NULL", new Uint8Array(0));
  add("DATA\\ZERO.RAW", new Uint8Array(78));
  // The fog map's first byte selects the palette in Traxx; the file carries 0 there.
  const fog = new Uint8Array(32768);
  fog.set((t.fogMap ?? defaultFogMap()).subarray(0, 32768));
  if (t.fogMap) fog[0] = 0;
  add(`FOG\\${p}.MAP`, fog);
  add(`LEVELS\\${p}.LVL`, writeLvl(doc));

  /*
    PodAddSurfaceSidecar: a model's .SRF right after it, named from the model's pod name with the
    source's extension. A stem too long for the extra extension is dropped and reported once;
    one already packed is skipped without a word.
  */
  const droppedSrf: string[] = [];
  const sidecar = (m: { srf?: Uint8Array | null; name: string }, tname: string) => {
    if (!m.srf) return;
    const dot = tname.lastIndexOf(".");
    const stem = dot >= 0 ? tname.slice(0, dot) : tname;
    const name = `${stem}.SRF`.toUpperCase();
    if (name.length > POD_NAME_MAX) { droppedSrf.push(`${afterSlash(stem)}.SRF`); return; }
    if (!has(name)) add(name, m.srf);
  };
  for (const name of t.models) {
    const m = doc.models.find((x) => x.name.toUpperCase() === name.toUpperCase());
    if (m?.bytes && add(m.name, m.bytes)) sidecar(m, m.name);
  }
  for (const drop of [t.backdropName, ...(t.arena ? [] : t.extraBackdrops)]) {
    if (!drop) continue;
    const m = doc.models.find((x) => afterSlash(x.name).toUpperCase() === afterSlash(drop).toUpperCase() || x.name.toUpperCase() === drop.toUpperCase());
    const name = drop.toUpperCase().startsWith("MODELS\\") ? drop : `MODELS\\${drop}`;
    if (m?.bytes && add(name.slice(0, POD_NAME_MAX), m.bytes)) sidecar(m, name.slice(0, POD_NAME_MAX));
  }
  if (droppedSrf.length) {
    warnings.push(`These surface-mesh files could NOT be packed into the pod:\n\n${droppedSrf.map((n) => `    ${n}\n`).join("")}\nThe track is otherwise complete, but the models they belong to will have no surface\ntypes in game. Check that the files can be read and build again.`);
  }

  /*
    WATERFALLS: whether WORLD\<stem>.WFL will be written is decided now, before the sounds (a
    fall's sound gets a .KLP) and the .TXV (waterfalls=<n>). Written when there are falls, none in
    error (the lip judged on the ground as it is now) and the lakes they name go in too. Traxx 1.7.2:
    the image itself is built here too, so the .TXV key and the sounds follow what was built.
    Traxx 1.7.3: Traxx writes only edge-rule files; the lakes (and so the falls' notches) are
    filled, checked and written under the EDGE rule, whatever rule a viewed pod was shown under.
  */
  // Track format version 6 (spec 9.3): a version 6 track's falls live in its N world, with the
  // terrain's height range, and its .WFL is version 1 or 2 as they need (buildWfl).
  const falls = t.falls ?? [];
  const fallWorld = v6 && stepBase ? { cells, terrain: stepBase, maxHeight: fallMaxHeight(t) } : FALL_WORLD_CLASSIC;
  const notches = trackNotches({ falls: t.falls, worldCells: t.worldCells, lakeRule: LAKE_RULE_EDGE });
  const lakeGround = t.lakes.length || falls.length ? buildLakeGround(t) : null;
  /*
    A stored lake map the caller chose to keep (lakeWrite "stored"): the .WTR carries it byte for byte and it is judged
    by the engine's checks (StoredWritable), not by Traxx's flood errors; the falls read it as the engine will. Otherwise
    the lakes are Traxx's fill under the EDGE rule.
  */
  const keepStored = options.lakeWrite === "stored" && storedLakeMapOf(t) !== null;
  const lakeHw = lakeHeightWindowFor(v6, cells, stepBase?.step ?? 128, stepBase?.base ?? 0);
  const fill: LakesState | null = t.lakes.length && lakeGround ? recomputeLakes(lakeGround, t.lakes, t.waterLevel4, notches) : null;
  const lakeState = fill && keepStored ? overStoredLakes(t, fill) : fill;
  let fallsWrite = false, fallsFailed = false;
  let wflImage: Uint8Array | null = null;
  const wflName = `WORLD\\${p}.WFL`.toUpperCase();
  const nameCheck = fallNameInPod(t.sounds, doc.textures, doc.modelTextures);
  if (falls.length) {
    const lakesOk = !t.lakes.length || (lakeState !== null && (keepStored ? storedLakesWritable(t, lakeGround, t.waterLevel4, lakeHw) === -1 : anyLakeErrors(lakeState) === 0));
    const fl = { lakes: t.lakes, tmap: lakeState?.tmap ?? null, world: fallWorld, rule: LAKE_RULE_EDGE };
    fallsWrite = lakesOk && falls.every((_, i) => fallErrors(falls, i, fl, nameCheck, lakeGround) === 0);
    // Build the image now: the .TXV waterfalls= key and the sounds go in only if it exists.
    if (fallsWrite) {
      wflImage = wflName.length < 32 ? buildWfl(falls, fl, nameCheck) : null;
      if (!wflImage) fallsWrite = false;
    }
    fallsFailed = !fallsWrite;
  }
  // FallUsesSound: a fall with its sound on that names this SOUND\<stem>.WAV.
  const fallUsesSound = (name: string) => {
    const title = name.slice(name.lastIndexOf("\\") + 1).toUpperCase();
    return falls.some((w) => (w.flags & FALLFLAG_SOUND) && w.sound && `${w.sound.slice(0, FALL_NAMELEN - 1)}.WAV`.toUpperCase() === title);
  };

  for (const s of t.sounds) {
    if ((s.flags & 1) || (fallsWrite && fallUsesSound(s.name))) {
      const dot = s.name.indexOf(".");
      if (dot >= 0) add(`${s.name.slice(0, dot)}.KLP`, ascii("1 0 0\r\n"));
    }
    add(s.name, s.data);
  }
  // Custom WAV, MP3 or OGG Vorbis: SOUND\<stem>.KLP then the music; a stock pick packs nothing.
  const kind = musicKind(t.music);
  if (kind === "wav" || kind === "mp3" || kind === "ogg") {
    add(`SOUND\\${p}.KLP`, ascii("1 0 0\r\n"));
    add(`SOUND\\${p}.${kind.toUpperCase()}`, t.music!);
  } else if (kind === "mod") add(`MUSIC\\${p}.MOD`, t.music!);

  const logoName = uiBitmapName(t.logoBmpName, p, "S");
  const mapName = uiBitmapName(t.mapBmpName, p, "L");
  const stockMap = stockIconCell(t.mapBmp);
  if (t.mapBmp && t.mapBmp[0] === 0x42 && t.mapBmp[1] === 0x4d) add(`UI\\${mapName}`, t.mapBmp);
  if (t.logoBmp) add(`UI\\${logoName}`, t.logoBmp);
  // The terrain pair, then the water pair (Traxx 1.7.2: _WDTL, _WMSK), byte for byte.
  for (const [map, ext, suffix] of [
    [t.detailMap, t.detailExt, "_DTL"], [t.maskMap, t.maskExt, "_MASK"],
    [t.waterDetailMap, t.waterDetailExt, "_WDTL"], [t.waterMaskMap, t.waterMaskExt, "_WMSK"],
  ] as const) {
    if (!map) continue;
    const name = `ART\\${p}${suffix}${ext || ".PNG"}`;
    if (name.length <= POD_NAME_MAX) add(name, map);
  }
  // The vegetation masks, only when there is vegetation (the engine never reads them).
  const veg = t.vegetation && (t.vegetation.image || t.vegetation.masks.some(Boolean)) ? t.vegetation : null;
  if (veg) {
    ["_V", "_G"].forEach((suffix, layer) => {
      const mask = veg.masks[layer];
      if (!mask) return;
      const name = `ART\\${p}${suffix}${mask.ext || ".PNG"}`.toUpperCase();
      if (name.length <= POD_NAME_MAX) add(name, mask.data);
      else warnings.push(`${name} does not fit a pod entry name, so it was not written.`);
    });
  }
  const infoName = uiInfoName(logoName);
  if (t.infoBmp && infoName) add(`UI\\${infoName}`, t.infoBmp);
  [logoName, mapName, infoName].forEach((bmp, slot) => {
    const art = t.uiHd[slot];
    if (!art || !art.ext || !bmp) return;
    if (slot === 1 && t.mapBmp && t.mapBmp[0] !== 0x42) return; // a stock icon lives in a game pod
    const name = `UI\\${swapExt(bmp, art.ext.replace(/^\./, ""))}`;
    if (name.length <= POD_NAME_MAX) add(name, art.data);
  });

  const situation = `WORLD\\${p}${v6 ? ".SI3" : omittedAny ? ".SI2" : ".SIT"}`;
  // (After commitTrackCpx: the .SIT carries the boxes in the .CPX's order and the forced track type.)
  add(situation, writeTraxxSit(traxxSitOf(doc), stockMap ? { stockMapIcon: stockMap.name } : {}));
  // The .VEG goes after the .TXV, which says whether the pod has one. Masks only, no image:
  // nothing to pack (Traxx would build one from the rules).
  const vegName = `WORLD\\${p}.VEG`.toUpperCase();
  const vegImage = veg?.image && vegName.length <= POD_NAME_MAX ? veg.image : null;
  add(`DATA\\${p}.TXV`, writeTxvFile(doc, !omittedAny, anyHdOver256, options.date ?? new Date(), vegImage ? vegCounts(vegImage) : null, heightsKey, fallsWrite ? falls.length : 0, stepBase));
  if (vegImage) {
    // Spec 9.2: trees in [0, W * 256), grass tiles 0..N-1. A .VEG that does not fit is reported.
    const why = v6 ? vegBoundsProblem(vegImage, cells) : null;
    if (why) warnings.push(`WORLD\\${p}.VEG: ${why}`);
    add(vegName, vegImage);
  }
  /*
    INSTANCING WARNING (CTrackPOD::Save, when the vegetation was written): every species model the
    game will not instance, judged with InstPodTextureOK (a texture the track holds but marked
    bad is not loadable). A warning, not a refusal.
  */
  const vegNotInstanced = vegImage ? vegModelsThatWillNotInstance(vegetationFromTxx(veg, cells), (bare) => {
    const at = findAsset(doc.models, bare);
    return at >= 0 ? doc.models[at]!.bytes : null;
  }, instPodTextureOk((name) => doc.modelTextures[findModelTexture(doc.modelTextures, name)] ?? null)) : [];
  // WORLD\<stem>.CPX: the race rules, built (and its map checked) at the top; after the .TXV and the .VEG, before the .WTR.
  if (cpx && cpx.ok) add(cpx.name, cpx.image);
  // The lakes (BuildWTR), recomputed first so the tile map is the terrain's as it is now. A lake
  // in error or a name that does not fit is reported and writes no item.
  if (t.lakes.length) {
    const wtrName = `WORLD\\${p}.WTR`.toUpperCase();
    // A version 6 track: version 1 or 2 as the world needs (spec 9.1), a 256 world's lakes in the engine's window too.
    // A kept stored map: BuildWTRStored, exactly its TMAP bytes, each lake's count and box from it.
    const wtr = fill && wtrName.length <= POD_NAME_MAX
      ? keepStored ? buildWtrStored(t, fill, lakeGround, t.waterLevel4, lakeHw, v6 && cells === 256 && stepBase ? stepBase : undefined)
        : v6 && stepBase ? buildWtrV6(t.lakes, fill, stepBase.step, stepBase.base) : buildWtr(t.lakes, fill)
      : null;
    if (wtr) add(wtrName, wtr);
    else warnings.push(LAKES_NOT_SAVED);
  }
  // WORLD\<stem>.WFL, built above; a fall in error or a failed build is reported and writes no item.
  if (fallsWrite && wflImage) add(wflName, wflImage);
  if (fallsFailed) warnings.push(FALLS_NOT_SAVED);
  if (t.text) add(`WORLD\\${p}.TXT`, t.text);

  return { comment: t.comment.slice(0, 79), entries, omittedAny, v6, anyHdOver256, badTextures, longFrames, warnings, vegNotInstanced, v6Scale: stepBase, cpx: Boolean(cpx && cpx.ok) };
}
