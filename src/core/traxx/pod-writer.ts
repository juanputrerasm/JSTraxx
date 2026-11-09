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
    UI\ pictures, ART\<stem>_DTL / _MASK, the vegetation masks ART\<stem>_V / _G, the info
      photo, the HD track art
    WORLD\<stem>.SIT (.SI2 when any legacy fallback was left out, or the terrain is not classic
      8-bit), DATA\<stem>.TXV, WORLD\<stem>.VEG, WORLD\<stem>.WTR, WORLD\<stem>.TXT

  Traxx 1.7: DATA\<stem>.RAW is the mode's height file (64 KB, 128 KB or 2 MB). The vegetation
  and lakes go out as the document holds them: the .VEG and its masks as bytes, the .WTR as read
  from the pod (JSTraxx cannot build one from the lakes yet).

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
import { saveRaw, TERRAINMODE_CLASSIC8, TERRAINMODE_FINE, TERRAINMODE_SPLINE } from "./terrain16.ts";
import { heightsPodPlan } from "./heights-png.ts";
import { buildLakeGround } from "./surface.ts";
import { buildWtr, recomputeLakes, LAKES_NOT_SAVED } from "./lakes.ts";
import { parseMtm2Veg } from "../../vendor/openphotex/mtm/veg.js";
import { vegetationFromTxx } from "./veg.ts";
import { instPodTextureOk, vegModelsThatWillNotInstance, type VegInstanceIssue } from "./instancing.ts";
import { findAsset } from "../doc/names.ts";
import { findModelTexture } from "../doc/load-pod.ts";

/** Write POD refused before anything is written ("Cannot build the pod"): the heights PNG could not go in. */
export class PodBuildRefused extends Error {
  override name = "PodBuildRefused";
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
}

export interface PodWriteResult {
  comment: string;
  entries: { name: string; data: Uint8Array }[];
  /** A legacy fallback was left out: the situation file is .SI2. */
  omittedAny: boolean;
  anyHdOver256: boolean;
  /** Textures the writer could not stand behind (g_podBadTex). */
  badTextures: string[];
  /** Animation frame names over 15 characters (g_podLongAniFrame). */
  longFrames: string[];
  /** What was not written as Traxx would write it, for the author. */
  warnings: string[];
  /** Traxx 1.7: the vegetation models the game will not instance (VegModelsThatWillNotInstance), when a .VEG was written. */
  vegNotInstanced: VegInstanceIssue[];
}

const ascii = (s: string) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };
const text = (lines: string[]) => ascii(lines.join(""));
const afterSlash = (name: string) => { const i = name.indexOf("\\"); return i >= 0 ? name.slice(i + 1) : name; };
const latin1 = (b: Uint8Array, from = 0, to = b.length) => { let s = ""; for (let i = from; i < to && b[i]; i++) s += String.fromCharCode(b[i]!); return s; };

/** WriteTEXFile: the count is the highest slot + 1; each texture's name without its folder. */
export function writeTex(textures: readonly (TextureAsset | null)[]): Uint8Array {
  let max = -1;
  textures.forEach((t, i) => { if (t) max = i; });
  const lines = [`${max + 1}\r\n`];
  for (let i = 0; i <= max; i++) if (textures[i]) lines.push(`${afterSlash(textures[i]!.name)}\r\n`);
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
  if (mtm2 && t.waterLevel4 > 0) lines.push("!waterHeight\r\n", `${t.waterLevel4}\r\n`);
  return text(lines);
}

/** TXVKeyIsOurs: the keys WriteTXVFile writes itself, so a carried copy is never written back. */
const OUR_TXV_KEYS = new Set(["formatversion", "tool", "toolversion", "built", "legacyfallback", "hdtextures", "fogvolumes",
  "vegetation", "vegtrees", "vegclumps", "terraingrid", "terrainheights"]);

/** The key of a .TXV line as TXVKeyIsOurs reads it: blanks around it trimmed, lower case. */
const txvKeyOf = (line: string) => line.replace(/^[ \t]+/, "").split("=")[0].replace(/[ \t]+$/, "").toLowerCase();

/**
  WriteTXVFile: the version record, with any key it does not own carried over.

  formatVersion: 2 for a Light or Moving box, 4 for a Fog (with fogVolumes=<n>), at least 3 for
  a .VEG with placements, at least 5 for any terrain mode but classic 8-bit. `vegetation` is the
  packed .VEG's placement counts (vegetation=1, vegTrees=, vegClumps= when it has any).
*/
export function writeTxvFile(doc: TrackDocument, legacyFallback: boolean, hdTextures: boolean, date: Date, vegetation: { trees: number; clumps: number } | null = null, heightsEntry = ""): Uint8Array {
  const t = doc.track;
  let formatVersion = t.boxes.some((b) => b.type === TRAXX_BOX_LIGHT || b.type === 13) ? 2 : 1;
  const fogs = t.boxes.filter((b) => b.type === TRAXX_BOX_FOG).length;
  if (fogs) formatVersion = 4;
  const vegKeys = vegetation && (vegetation.trees || vegetation.clumps) ? vegetation : null;
  if (vegKeys && formatVersion < 3) formatVersion = 3;
  if (t.terrainMode !== TERRAINMODE_CLASSIC8 && formatVersion < 5) formatVersion = 5;
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
  if (heightsEntry) lines.push(`terrainHeights=${heightsEntry}\r\n`);
  if (fogs) lines.push(`fogVolumes=${fogs}\r\n`);
  if (vegKeys) lines.push(`vegetation=1\r\nvegTrees=${vegKeys.trees}\r\nvegClumps=${vegKeys.clumps}\r\n`);
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

/** BuildRA01CL0: each box's heights and six face words at its cell. */
export function groundBoxGrids(doc: TrackDocument): { ra0: Uint8Array; ra1: Uint8Array; cl0: Uint8Array } {
  const ra0 = new Uint8Array(65536), ra1 = new Uint8Array(65536), cl0 = new Uint8Array(12 * 65536);
  const v = new DataView(cl0.buffer);
  for (const g of doc.track.groundBoxes) {
    const at = (g.x & 255) + ((g.y & 255) << 8);
    ra0[at] = g.lower;
    ra1[at] = g.upper;
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
  // A non-classic terrain is written as if the fallback were omitted, whatever the setting:
  // .SI2 and legacyFallback=0 keep the builds that read every height file as 8-bit off it.
  const classic = t.terrainMode === TERRAINMODE_CLASSIC8;
  const omitFallback = t.omitRawFallback || !classic;
  let omittedAny = !classic, anyHdOver256 = false;

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
  for (const tex of doc.textures) if (tex) writeTexture(tex);
  for (const tex of doc.modelTextures) writeTexture(tex);

  const { ra0, ra1, cl0 } = groundBoxGrids(doc);
  const clr = new Uint8Array(131072);
  const cv = new DataView(clr.buffer);
  for (let c = 0; c < 65536; c++) cv.setUint16(c * 2, t.clr[c]!, true);
  const lte = new Uint8Array(458752);
  if (t.lte) lte.set(t.lte.subarray(0, 458752));
  add(`DATA\\${p}.ANI`, writeAniFile(doc, longFrames));
  add(`DATA\\${p}.CL0`, cl0);
  add(`DATA\\${p}.CL1`, new Uint8Array(262144));
  add(`DATA\\${p}.CL2`, new Uint8Array(786432));
  add(`DATA\\${p}.CLR`, clr);
  add(`DATA\\${p}.LTE`, lte);
  add(`DATA\\${p}.PUP`, new Uint8Array(0));
  add(`DATA\\${p}.RA0`, ra0);
  add(`DATA\\${p}.RA1`, ra1);
  for (const n of [2, 3, 4, 5]) add(`DATA\\${p}.RA${n}`, new Uint8Array(65536));
  // THE HEIGHTS: the mode's height file after SyncFromRaw, and with "Store heights as PNG"
  // DATA\<stem>_H.PNG beside it (Classic 8-bit) or in its place (heights-png.ts). A PNG that
  // cannot go in refuses the whole pod, as Traxx does.
  const heights = heightsPodPlan(t, p, t.pngHeights);
  if (heights.error) throw new PodBuildRefused(heights.error);
  if (heights.raw) add(`DATA\\${p}.RAW`, saveRaw(t));
  if (heights.png) add(heights.png.name, heights.png.bytes);
  add(`DATA\\${p}.TEX`, writeTex(doc.textures));
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

  for (const s of t.sounds) {
    if (s.flags & 1) {
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
  for (const [map, ext, suffix] of [[t.detailMap, t.detailExt, "_DTL"], [t.maskMap, t.maskExt, "_MASK"]] as const) {
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

  add(`WORLD\\${p}${omittedAny ? ".SI2" : ".SIT"}`, writeTraxxSit(traxxSitOf(doc), stockMap ? { stockMapIcon: stockMap.name } : {}));
  // The .VEG goes after the .TXV, which says whether the pod has one. Masks only, no image:
  // nothing to pack (Traxx would build one from the rules).
  const vegName = `WORLD\\${p}.VEG`.toUpperCase();
  const vegImage = veg?.image && vegName.length <= POD_NAME_MAX ? veg.image : null;
  add(`DATA\\${p}.TXV`, writeTxvFile(doc, !omittedAny, anyHdOver256, options.date ?? new Date(), vegImage ? vegCounts(vegImage) : null, heights.txvKey));
  if (vegImage) add(vegName, vegImage);
  /*
    INSTANCING WARNING (CTrackPOD::Save, when the vegetation was written): every species model the
    game will not instance, judged with InstPodTextureOK (a texture the track holds but marked
    bad is not loadable). A warning, not a refusal.
  */
  const vegNotInstanced = vegImage ? vegModelsThatWillNotInstance(vegetationFromTxx(veg), (bare) => {
    const at = findAsset(doc.models, bare);
    return at >= 0 ? doc.models[at]!.bytes : null;
  }, instPodTextureOk((name) => doc.modelTextures[findModelTexture(doc.modelTextures, name)] ?? null)) : [];
  // The lakes (BuildWTR), recomputed first so the tile map is the terrain's as it is now. A lake
  // in error or a name that does not fit is reported and writes no item.
  if (t.lakes.length) {
    const wtrName = `WORLD\\${p}.WTR`.toUpperCase();
    const ground = buildLakeGround(t);
    const wtr = ground && wtrName.length <= POD_NAME_MAX ? buildWtr(t.lakes, recomputeLakes(ground, t.lakes, t.waterLevel4)) : null;
    if (wtr) add(wtrName, wtr);
    else warnings.push(LAKES_NOT_SAVED);
  }
  if (t.text) add(`WORLD\\${p}.TXT`, t.text);

  return { comment: t.comment.slice(0, 79), entries, omittedAny, anyHdOver256, badTextures, longFrames, warnings, vegNotInstanced };
}
