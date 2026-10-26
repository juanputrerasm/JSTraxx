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
    UI\ pictures, ART\<stem>_DTL / _MASK, the info photo, the HD track art
    WORLD\<stem>.SIT (.SI2 when any legacy fallback was left out), DATA\<stem>.TXV, WORLD\<stem>.TXT

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
import { TRAXX_BOX_LIGHT } from "./sit.ts";

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

/** The music's kind: a WAV (RIFF), a stock reference ("MUSIC\NAME.WAV"), or a MOD. */
function musicKind(m: Uint8Array | null): "wav" | "stock" | "mod" | null {
  if (!m) return null;
  if (latin1(m, 0, 4) === "RIFF") return "wav";
  if (latin1(m, 0, 5) === "MUSIC") return "stock";
  return "mod";
}

/** WriteLVLFile. */
export function writeLvl(doc: TrackDocument): Uint8Array {
  const t = doc.track;
  const mtm2 = (t.versionFlags & MTM2_ONLY) !== 0;
  const p = t.prefix;
  const low = (s: string) => `${s.toLowerCase()}\r\n`;
  const kind = musicKind(t.music);
  const music = kind === "wav" ? `${p}.wav` : kind === "stock" ? latin1(t.music!, 6) : `${p}.mod`;
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

const OUR_TXV_KEYS = new Set(["formatversion", "tool", "toolversion", "built", "legacyfallback", "hdtextures"]);

/** WriteTXVFile: the version record, with any key it does not own carried over. */
export function writeTxvFile(doc: TrackDocument, legacyFallback: boolean, hdTextures: boolean, date: Date): Uint8Array {
  const v2 = doc.track.boxes.some((b) => b.type === TRAXX_BOX_LIGHT || b.type === 13);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lines = [
    "# MTM2 track version record - written by JSTraxx\r\n",
    `formatVersion=${v2 ? 2 : 1}\r\n`, "tool=JSTraxx\r\n", `toolVersion=${JSTRAXX_VERSION}\r\n`,
    `built=${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}\r\n`,
    `legacyFallback=${legacyFallback ? 1 : 0}\r\n`, `hdTextures=${hdTextures ? 1 : 0}\r\n`,
  ];
  const carried = doc.carry.txvText;
  if (carried) {
    let header = false;
    for (const line of carried.split(/[\r\n]+/)) {
      if (!line || line.length >= 508 || line[0] === "#" || !line.includes("=")) continue;
      const key = line.slice(0, line.indexOf("=")).replace(/[ \t]+$/, "").toLowerCase();
      if (OUR_TXV_KEYS.has(key)) continue;
      if (!header) { lines.push("# carried over from the previous build\r\n"); header = true; }
      lines.push(`${line}\r\n`);
    }
  }
  return text(lines);
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
  let omittedAny = false, anyHdOver256 = false;

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
      if (t.omitRawFallback || tex.bad) omittedAny = true;
    }
    if ((!hd || (!t.omitRawFallback && !tex.bad)) && !has(tname)) {
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
  add(`DATA\\${p}.RAW`, t.heights.slice(0, 65536));
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

  for (const name of t.models) {
    const m = doc.models.find((x) => x.name.toUpperCase() === name.toUpperCase());
    if (m?.bytes) add(m.name, m.bytes);
  }
  for (const drop of [t.backdropName, ...(t.arena ? [] : t.extraBackdrops)]) {
    if (!drop) continue;
    const m = doc.models.find((x) => afterSlash(x.name).toUpperCase() === afterSlash(drop).toUpperCase() || x.name.toUpperCase() === drop.toUpperCase());
    const name = drop.toUpperCase().startsWith("MODELS\\") ? drop : `MODELS\\${drop}`;
    if (m?.bytes) add(name.slice(0, POD_NAME_MAX), m.bytes);
  }

  for (const s of t.sounds) {
    if (s.flags & 1) {
      const dot = s.name.indexOf(".");
      if (dot >= 0) add(`${s.name.slice(0, dot)}.KLP`, ascii("1 0 0\r\n"));
    }
    add(s.name, s.data);
  }
  const kind = musicKind(t.music);
  if (kind === "wav") { add(`SOUND\\${p}.KLP`, ascii("1 0 0\r\n")); add(`SOUND\\${p}.WAV`, t.music!); }
  else if (kind === "mod") add(`MUSIC\\${p}.MOD`, t.music!);

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
  add(`DATA\\${p}.TXV`, writeTxvFile(doc, !omittedAny, anyHdOver256, options.date ?? new Date()));
  if (t.text) add(`WORLD\\${p}.TXT`, t.text);

  return { comment: t.comment.slice(0, 79), entries, omittedAny, anyHdOver256, badTextures, longFrames };
}
