/*
  Opening a track out of a POD: CTrackPOD::Load and the readers it calls (ParseSITFile,
  ParseLVLFile, ParseTEXFile, ParseTTYFile, LoadGroundBoxes; TrackPOD/TrackPODFile.cpp).

  Traxx reads everything from the one POD, with its own name rules (core/traxx/pod-items.ts).
  Two things are added here, both only where Traxx would find nothing:

    - `fallback`: an asset the POD does not hold is looked up in the mounted game PODs, as the
      game itself would find it;
    - box sounds and the .ANI texture animations are read, so a track imported to be edited
      keeps them (Traxx's View POD is read-only and drops both).
*/
import type { PodArchive, PodEntry } from "../../vendor/openphotex/pod/types.js";
import { parseMtmSit, parseMtmLvl } from "../../vendor/openphotex/mtm/sit.js";
import { parseAnimations } from "../../vendor/openphotex/tv/ani.js";
import { parseBin } from "../../vendor/openphotex/model/bin.js";
import { traxxSitFromParsed, TRAXX_BOX_CRUSH } from "../traxx/sit.ts";
import type { TxxAnimation, TxxCourseSegment, TxxGroundBox, TxxSound } from "../traxx/txx.ts";
import { isHdName, rawSide, resolveItemName, seekToItem, swapExt } from "../traxx/pod-items.ts";
import { withSysColors } from "../traxx/palette.ts";
import { CELLS, inferPrefixAuto, interpolateRawAtPoint, uiInfoName } from "../traxx/terrain.ts";
import { atoi, traxxLines } from "../traxx/lines.ts";
import { cText } from "../traxx/bytes.ts";
import { resetTrack } from "./new-track.ts";
import { emptyCarry, type ModelAsset, type TextureAsset, type TrackDocument } from "./document.ts";
import { afterFirstSlash, findAsset } from "./names.ts";

export const MAX_POD_TRACKS = 100;
export const MAX_TEXTURES = 1024;
export const MAX_MODEL_TEXTURES = 4096;
export const MAX_GROUND_BOXES = 2048;
export const MAX_ANIMATIONS = 64;
export const MAX_ANIMATION_FRAMES = 8;

/** An archive and a way to read its entries. */
export interface PodSource {
  archive: PodArchive;
  read(entry: PodEntry): Promise<Uint8Array>;
}

export interface LoadPodOptions {
  /** Look an asset up elsewhere (the library) by the name Traxx asked the POD for. */
  fallback?: (name: string) => Promise<Uint8Array | null>;
  /** Called as the load goes, 0..1, with what is being read. */
  progress?: (fraction: number, label: string) => void;
}

/** PodIsSituationName: the text after the FIRST dot is .SIT or .SI2. */
export function situationKind(name: string): "sit" | "si2" | null {
  const dot = name.indexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot).toUpperCase();
  return ext === ".SIT" ? "sit" : ext === ".SI2" ? "si2" : null;
}

export interface PodTrackList {
  /** Each track's name, from the third line of its situation file (up to 31 characters). */
  names: string[];
  /** Each track's stem, from its situation entry's name. */
  stems: string[];
  /** Authoring warnings about the set of tracks (PodNoteStemCollisions). */
  warning: string;
}

/** CTrackPOD::CountTracks. */
export async function countTracks(source: PodSource): Promise<PodTrackList> {
  const names: string[] = [];
  const stems: string[] = [];
  for (const entry of source.archive.entries) {
    if (!situationKind(entry.name)) continue;
    const lines = traxxLines(await source.read(entry));
    names.push((lines[2] ?? "").slice(0, 31));
    const file = entry.name.slice(entry.name.lastIndexOf("\\") + 1);
    const dot = file.lastIndexOf(".");
    stems.push((dot >= 0 ? file.slice(0, dot) : file).slice(0, 20));
    if (names.length >= MAX_POD_TRACKS) break;
  }
  let warning = "";
  for (let i = 0; i < stems.length; i++) {
    for (let j = i + 1; j < stems.length; j++) {
      if (stems[i].slice(0, 7).toUpperCase() !== stems[j].slice(0, 7).toUpperCase()) continue;
      warning += `Tracks "${stems[i]}" and "${stems[j]}" share their first 7 characters. Under the original 8.3 UI\\ naming they would resolve to the same UI\\ picture and icon.\n`;
    }
  }
  return { names, stems, warning };
}

/** Load track `which` (0-based, in directory order). Throws when the POD has no such track. */
export async function loadPodTrack(source: PodSource, which: number, fileName: string, options: LoadPodOptions = {}): Promise<TrackDocument> {
  const entries = source.archive.entries;
  const progress = options.progress ?? (() => {});
  const seek = (name: string) => seekToItem(entries, name);
  /** An entry's bytes by Traxx's lookup, then the fallback; null when neither has it. */
  const fetch = async (name: string): Promise<Uint8Array | null> => {
    const e = seek(name);
    if (e) return source.read(e);
    return options.fallback ? options.fallback(name) : null;
  };
  const fetchPodOnly = async (name: string) => { const e = seek(name); return e ? source.read(e) : null; };

  // The situation file.
  let index = 0, sitEntry: PodEntry | null = null, si2 = false;
  for (const e of entries) {
    const kind = situationKind(e.name);
    if (!kind) continue;
    if (index++ === which) { sitEntry = e; si2 = kind === "si2"; break; }
  }
  if (!sitEntry) throw new Error(index === 0 ? "No tracks in this POD." : `This POD has no track ${which + 1}.`);
  progress(0, "Reading the situation file");

  const track = resetTrack();
  const doc: TrackDocument = {
    track, textures: [], modelTextures: [], models: [], carry: emptyCarry(), prefixAuto: true, viewOnly: true,
    source: { kind: "pod", fileName, trackIndex: which }, objectsShort: 0, objectsDropped: 0, groundBoxOverflow: 0,
    missingTextures: [], missingModels: [], warnings: [],
  };
  track.comment = source.archive.comment.slice(0, 79);
  doc.carry.situationIsSi2 = si2;

  const parsed = parseMtmSit(await source.read(sitEntry), sitEntry.title);
  // A UI picture counts as present when its HD sibling is (LoadUIArtHD before SeekToItem).
  const present = (name: string) => Boolean(seek(name)) || (/\.BMP$/i.test(name) && Boolean(seek(swapExt(name, "PNG")) || seek(swapExt(name, "TGA"))));
  const sit = traxxSitFromParsed(parsed, { hasEntry: present });
  track.prefix = sit.prefix;
  track.trackName = sit.trackName;
  track.localeName = sit.localeName;
  track.logoBmpName = sit.logoBmpName;
  track.mapBmpName = sit.mapBmpName;
  track.trackType = sit.trackType;
  track.versionFlags = sit.mtm2Only ? 1 : 0;
  if (sit.mtm2Only) { track.ambientSound = sit.ambientSound; track.weatherMask = sit.weatherMask; }
  track.trucks = sit.trucks;
  track.boxes = sit.boxes;
  const seg = (s: typeof sit.course[number]): TxxCourseSegment => ({ ...s, spare: [0, 0] });
  track.course = sit.course.map(seg);
  track.extendedCourses = sit.extendedCourses.map((c) => (c ? c.map(seg) : null));
  track.arena = sit.arena;
  track.backdropName = sit.backdropName.toUpperCase();
  track.extraBackdrops = sit.extraBackdrops.map((n) => n.toUpperCase());
  doc.carry.cylinderCount = sit.cylinderCount;
  doc.carry.cylinderRaw = sit.cylinderRaw;
  doc.objectsDropped = sit.objectsDropped;
  doc.objectsShort = countShort(sit.warnings);
  doc.warnings.push(...sit.warnings);

  // UI pictures: the BMP and its HD sibling, by the recorded name when the pod has it.
  const uiArt = async (recorded: string | null, slot: number): Promise<Uint8Array | null> => {
    const name = (recorded ?? "").toUpperCase().replace(/^UI\\/, "");
    if (!name) return null;
    for (const ext of ["PNG", "TGA"] as const) {
      const hd = await fetchPodOnly(swapExt(name, ext));
      if (hd) { track.uiHd[slot] = { ext: `.${ext}`, data: hd }; break; }
    }
    return fetchPodOnly(name);
  };
  track.logoBmp = await uiArt(parsed.logoBmp, 0);
  track.mapBmp = await uiArt(parsed.mapBmp, 1);

  // The level file.
  const lvlBytes = sit.prefix ? await fetchPodOnly(parsed.lvlName.toUpperCase()) : null;
  const resolve = (name: string) => resolveItemName(entries, name);
  const entryName = (name: string) => seek(name)?.name ?? null;
  if (lvlBytes) await readLevel(lvlBytes, doc, fetchPodOnly, fetch, progress, resolve, entryName);

  // The .TXV record, if the pod has one.
  const txv = entries.find((e) => /\.TXV$/i.test(e.name.slice(e.name.lastIndexOf("."))) && e.length >= 1 && e.length <= 65536);
  if (txv) doc.carry.txvText = new TextDecoder("windows-1252").decode(await source.read(txv));

  // Models, in the order ParseSITFile loads them: each box's model, a crush car's base, cab and cab frame 0.
  progress(0.6, "Reading models");
  const loadModel = async (name: string): Promise<ModelAsset | null> => {
    if (!name) return null;
    const at = findAsset(doc.models, name);
    if (at >= 0) return doc.models[at];
    const e = seek(name.toUpperCase());
    const bytes = e ? await source.read(e) : options.fallback ? await options.fallback(name.toUpperCase()) : null;
    if (!bytes) {
      if (!doc.missingModels.includes(name)) doc.missingModels.push(name);
      return null;
    }
    const model = modelAsset(e ? e.name : `MODELS\\${afterFirstSlash(name)}`, bytes);
    doc.models.push(model);
    return model;
  };
  for (const box of track.boxes) {
    await loadModel(box.modelName);
    if (box.type === TRAXX_BOX_CRUSH && box.crushName) {
      const cab = await loadModel(box.crushName);
      if (cab?.frameNames[0]) await loadModel(cab.frameNames[0]);
    }
  }
  const backdrops = new Set<unknown>();
  for (const name of [track.backdropName, ...track.extraBackdrops]) if (name) backdrops.add(await loadModel(name));
  track.models = doc.models.filter((m) => !backdrops.has(m)).map((m) => m.name);

  // CTrackPOD::DeriveBoxHeightsAboveGround and InferPrefixMode.
  deriveBoxHeights(track);
  doc.prefixAuto = inferPrefixAuto(track.trackName, track.prefix);

  // The info pop-up: UI\<logo minus S>M.BMP and DATA\<stem>.TXT, found by convention.
  const info = uiInfoName(track.logoBmpName || `${track.prefix}S.BMP`);
  if (info) {
    track.infoBmp = await fetchPodOnly(`UI\\${info}`);
    for (const ext of ["PNG", "TGA"] as const) {
      const hd = await fetchPodOnly(swapExt(`UI\\${info}`, ext));
      if (hd) { track.uiHd[2] = { ext: `.${ext}`, data: hd }; break; }
    }
  }
  const infoText = await fetchPodOnly(`DATA\\${track.prefix}.TXT`.toUpperCase());
  if (infoText && infoText.length > 0) track.infoText = infoText;

  // The terrain detail normal and its painted mask, .PNG then .TGA.
  for (const [suffix, which2] of [["_DTL", "detail"], ["_MASK", "mask"]] as const) {
    for (const ext of ["PNG", "TGA"] as const) {
      const bytes = await fetchPodOnly(`ART\\${track.prefix}${suffix}.${ext}`.toUpperCase());
      if (!bytes) continue;
      if (which2 === "detail") { track.detailMap = bytes; track.detailExt = `.${ext}`; doc.carry.detailFromPod = true; }
      else { track.maskMap = bytes; track.maskExt = `.${ext}`; doc.carry.maskFromPod = true; }
      break;
    }
  }

  // The models' and backdrop's textures, remapped through their own .ACT (or metalcr2).
  progress(0.8, "Reading model textures");
  const order = [...doc.models.filter((m) => !backdrops.has(m)), ...doc.models.filter((m) => backdrops.has(m))];
  for (const model of order) {
    for (const recorded of model.textureNames) {
      if (doc.modelTextures.length >= MAX_MODEL_TEXTURES) break;
      const name = resolveItemName(entries, recorded.toUpperCase());
      if (findModelTexture(doc.modelTextures, name) >= 0) continue;
      const tex = await loadTexture(name, fetch, entryName);
      if (tex) doc.modelTextures.push(tex);
    }
  }

  // Box sounds (a JSTraxx addition): SOUND\<name> for every sound a box names.
  const sounds: TxxSound[] = [];
  for (const box of track.boxes) {
    for (const [name, flags] of [[box.soundImpact, 0], [box.soundCont, 1]] as const) {
      if (!name || name.toUpperCase() === "NULL.WAV") continue;
      const full = `SOUND\\${name}`;
      if (sounds.some((s) => afterFirstSlash(s.name) === afterFirstSlash(full))) continue;
      const data = await fetch(full.toUpperCase());
      if (data) sounds.push({ name: full, flags, data });
    }
  }
  track.sounds = sounds;
  progress(1, "Done");
  return doc;
}

/* OpenPhotex's "<kind> count N and real ramp|object count M doesn't match": the records promised and missing. */
function countShort(warnings: readonly string[]): number {
  let n = 0;
  for (const w of warnings) {
    const m = /count (\d+) and real (?:ramp|object) count (\d+)/.exec(w);
    if (m && Number(m[1]) > Number(m[2])) n += Number(m[1]) - Number(m[2]);
  }
  return n;
}

/*
  ParseLVLFile: the terrain, colour grid and ground boxes; the palette and its fog map; the
  texture list and types; music, fog table, light plane, sun and water.
*/
async function readLevel(
  bytes: Uint8Array, doc: TrackDocument,
  fetchPodOnly: (name: string) => Promise<Uint8Array | null>,
  fetch: (name: string) => Promise<Uint8Array | null>,
  progress: (f: number, label: string) => void,
  resolve: (name: string) => string,
  entryName: (name: string) => string | null,
): Promise<void> {
  const track = doc.track;
  const lvl = parseMtmLvl(bytes);
  if (!lvl) return;
  const up = (s: string | null) => (s ?? "").toUpperCase();

  if (lvl.textName) track.text = await fetchPodOnly(up(lvl.textName));

  progress(0.1, "Reading the terrain");
  const raw = await fetchPodOnly(`DATA\\${up(lvl.rawName)}`);
  if (raw) {
    track.heights.set(raw.subarray(0, CELLS));
    readGroundBoxes(doc, up(lvl.rawName), await fetchPodOnly(swapExt(up(lvl.rawName), "RA0")),
      await fetchPodOnly(swapExt(up(lvl.rawName), "RA1")), await fetchPodOnly(swapExt(up(lvl.rawName), "CL0")));
  }
  const clr = await fetchPodOnly(up(lvl.clrName));
  if (clr) {
    const n = Math.min(CELLS, clr.length >> 1);
    const view = new DataView(clr.buffer, clr.byteOffset, n * 2);
    for (let i = 0; i < n; i++) track.clr[i] = view.getUint16(i * 2, true);
  }

  const act = await fetchPodOnly(up(lvl.actName));
  if (act) {
    track.paletteName = up(lvl.actName).slice(0, 31);
    const rgb = new Uint8Array(768);
    rgb.set(act.subarray(0, 768));
    track.palette = withSysColors(rgb);
    const fog = await fetchPodOnly(`FOG\\${swapExt(up(lvl.actName), "MAP")}`);
    if (fog) { track.fogMap = new Uint8Array(32768); track.fogMap.set(fog.subarray(0, 32768)); }
  }

  progress(0.2, "Reading terrain textures");
  const texBytes = await fetchPodOnly(up(lvl.texName));
  if (texBytes) {
    await readTexList(doc, texBytes, fetch, resolve, entryName);
    const tty = await fetchPodOnly(swapExt(up(lvl.texName), "TTY"));
    if (tty) readTty(doc, tty);
  }

  // Texture animations (a JSTraxx addition): the .ANI the level names.
  if (lvl.aniName) {
    const ani = await fetchPodOnly(up(lvl.aniName));
    if (ani) track.animations = await readAnimations(doc, ani, fetch, resolve, entryName);
  }

  if (lvl.musicName) track.music = await fetchPodOnly(up(lvl.musicName));
  if (lvl.fogName) {
    const fog = await fetchPodOnly(up(lvl.fogName));
    if (fog) { doc.carry.fogFog = new Uint8Array(4096); doc.carry.fogFog.set(fog.subarray(0, 4096)); }
  }
  if (lvl.lteName) {
    const lte = await fetchPodOnly(up(lvl.lteName));
    if (lte) { const plane = new Uint8Array(CELLS * 7); plane.set(lte.subarray(0, CELLS * 7)); track.lte = plane; }
  }
  track.sun = {
    vector: lvl.sunVector ?? [0, 0, 0],
    shadowIntensity: lvl.shadowIntensity ?? 0,
    position: lvl.sunPosition ?? [0, 0, 0],
    intensity: lvl.sunIntensity ?? 0,
  };
  doc.carry.levelValue = lvl.levelValue ?? 0;
  // The line after the level value must be the label (ParseLVLFile reads it there).
  if (lvl.waterHeight !== null) track.waterLevel4 = lvl.waterHeight;
}

/*
  LoadGroundBoxes: one box per cell whose upper height is above zero, row by row, up to 2048;
  the rest are counted. All three grids must be there or there are none.
*/
export function readGroundBoxes(doc: TrackDocument, _rawName: string, ra0: Uint8Array | null, ra1: Uint8Array | null, cl0: Uint8Array | null): void {
  if (!ra0 || !ra1 || !cl0) return;
  const boxes: TxxGroundBox[] = [];
  const faces = new DataView(cl0.buffer, cl0.byteOffset, cl0.byteLength);
  for (let j = 0; j < 256; j++) {
    for (let i = 0; i < 256; i++) {
      const c = i + j * 256;
      const upper = ra1[c] ?? 0;
      if (upper === 0) continue;
      if (boxes.length >= MAX_GROUND_BOXES) { doc.groundBoxOverflow++; continue; }
      const words: number[] = [];
      for (let f = 0; f < 6; f++) words.push(c * 12 + f * 2 + 1 < cl0.length ? faces.getUint16(c * 12 + f * 2, true) : 0);
      boxes.push({ x: i, y: j, w: 1, h: 1, lower: ra0[c] ?? 0, upper, faces: words });
    }
  }
  doc.track.groundBoxes = boxes;
}

/*
  ParseTEXFile: a count, then one name per line; slot t is line t + 1. A name already loaded
  leaves its slot empty. Names resolve as model textures do (verbatim, .RAW, .PNG, .TGA).
*/
async function readTexList(
  doc: TrackDocument, bytes: Uint8Array, fetch: (name: string) => Promise<Uint8Array | null>,
  resolve: (name: string) => string, entryName: (name: string) => string | null,
): Promise<void> {
  const lines = traxxLines(bytes);
  const count = Math.min(atoi(lines[0]), MAX_TEXTURES);
  const slots: (TextureAsset | null)[] = [];
  const info: { name: string; type: number; depth: number }[] = [];
  for (let t = 0; t < count; t++) {
    const recorded = (lines[t + 1] ?? "").toUpperCase();
    slots[t] = null;
    info[t] = { name: "", type: 0, depth: 0 };
    if (!recorded || findAsset(slots, recorded) >= 0) continue;
    const tex = await loadTexture(resolve(recorded), fetch, entryName);
    if (!tex) { doc.missingTextures.push(recorded); continue; }
    slots[t] = tex;
    info[t] = { name: tex.name, type: 0, depth: 1 };
  }
  // Trailing empty slots are not slots.
  while (slots.length && slots[slots.length - 1] === null) { slots.pop(); info.pop(); }
  doc.textures = slots;
  doc.track.textures = info;
}

/** ParseTTYFile: "NAME.RAW,value" sets that texture's type (value / 100) and grip depth (value % 100). */
function readTty(doc: TrackDocument, bytes: Uint8Array): void {
  const lines = traxxLines(bytes);
  const count = atoi(lines[0]);
  for (let t = 0; t < count; t++) {
    const line = (lines[t + 1] ?? "").toUpperCase();
    if (!line.includes(".RAW")) continue;
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const at = findAsset(doc.textures, line.slice(0, comma));
    if (at < 0) continue;
    const value = atoi(line.slice(comma + 1));
    doc.track.textures[at].type = Math.trunc(value / 100);
    doc.track.textures[at].depth = value % 100;
  }
}

/*
  The .ANI, read back the way WriteANIFile writes it: frame names are terrain texture names
  without ART\, and the rate is 65 x the period. In Traxx every frame is a terrain texture, so
  a frame the .TEX does not list is loaded and added as a new texture slot, as adding it in
  Texture Animation would.
*/
async function readAnimations(
  doc: TrackDocument, bytes: Uint8Array, fetch: (name: string) => Promise<Uint8Array | null>,
  resolve: (name: string) => string, entryName: (name: string) => string | null,
): Promise<TxxAnimation[]> {
  const out: TxxAnimation[] = [];
  for (const a of parseAnimations(bytes)) {
    if (out.length >= MAX_ANIMATIONS) break;
    const frames: number[] = [];
    for (const name of a.frames.slice(0, MAX_ANIMATION_FRAMES)) {
      let at = findAsset(doc.textures, name);
      if (at < 0 && doc.textures.length < MAX_TEXTURES) {
        const tex = await loadTexture(resolve(name.toUpperCase()), fetch, entryName);
        if (tex) {
          at = doc.textures.length;
          doc.textures.push(tex);
          doc.track.textures.push({ name: tex.name, type: 0, depth: 1 });
        }
      }
      frames.push(at);
    }
    if (frames.length === 0 || frames.some((f) => f < 0)) {
      doc.warnings.push(`Texture animation ${a.baseName} names a frame this POD does not hold, so it was not kept.`);
      continue;
    }
    const nframes = frames.length;
    while (frames.length < MAX_ANIMATION_FRAMES) frames.push(0);
    out.push({ period: Math.trunc(a.rate / 65), nframes, frames });
  }
  return out;
}

/** FindModelTexture, then the .RAW of the same stem (IsModelTextureLoaded). */
export function findModelTexture(list: readonly { name: string }[], name: string): number {
  const at = findAsset(list, name);
  if (at >= 0) return at;
  const legacy = swapExt(name, "RAW");
  return legacy.toUpperCase() === name.toUpperCase() ? -1 : findAsset(list, legacy);
}

/*
  One texture: a legacy tile by its byte count, with the .ACT beside a .RAW (metalcr2 when
  there is none; a tile not named .RAW is taken as already in the track palette); or an
  HD-only entry, kept under its .RAW name with the bytes attached. Null when nothing is there.
*/
async function loadTexture(name: string, fetch: (name: string) => Promise<Uint8Array | null>, entryName: ((n: string) => string | null) | null): Promise<TextureAsset | null> {
  const bytes = await fetch(name);
  if (!bytes) return null;
  const stored = entryName?.(name) ?? (name.includes("\\") ? name : `ART\\${name}`);
  const side = rawSide(bytes.length);
  if (side === 0) {
    if (!isHdName(name)) return null;
    const ext = name.toUpperCase().endsWith(".TGA") ? "TGA" : "PNG";
    return { name: swapExt(stored, "RAW"), side: 0, indices: null, act: null, hd: { ext, data: bytes }, bad: false };
  }
  let act: Uint8Array | null = null;
  let trackIndexed = false;
  if (name.includes(".RAW")) {
    const pal = await fetch(name.replace(".RAW", ".ACT"));
    if (pal) { act = new Uint8Array(768); act.set(pal.subarray(0, 768)); }
  } else trackIndexed = true;
  return { name: stored, side, indices: bytes.slice(0, side * side), act, hd: null, bad: false, ...(trackIndexed ? { trackIndexed } : {}) };
}

/** A model's bytes and the names a loader needs from them. */
export function modelAsset(name: string, bytes: Uint8Array): ModelAsset {
  const bin = parseBin(bytes);
  const textureNames: string[] = [];
  for (const face of bin.faces) {
    // Solid faces (0x19) draw no texture; LoadModelTextures skips them.
    if (face.opcode === 0x19) continue;
    for (const t of face.textureFrames ?? [face.textureName]) if (t && !textureNames.includes(t)) textureNames.push(t);
  }
  return { name, bytes, textureNames, frameNames: bin.frameNames.map((f) => cText(new TextEncoder().encode(f))), bad: false };
}

/*
  DeriveBoxHeightsAboveGround: each box's height above the terrain from its absolute Z, after
  normalising the fraction to 0..255. Not clamped at zero: buried props stay buried.
*/
export function deriveBoxHeights(track: { boxes: { ipos: [number, number, number]; fraction: [number, number, number]; heightAboveGround: number }[]; heights: Uint8Array }): void {
  for (const box of track.boxes) {
    while (box.fraction[2] < 0) { box.fraction[2] += 256; box.ipos[2]--; }
    while (box.fraction[2] > 255) { box.fraction[2] -= 256; box.ipos[2]++; }
    box.heightAboveGround = box.ipos[2] - interpolateRawAtPoint(track.heights, box.ipos[0], box.ipos[1]);
  }
}
