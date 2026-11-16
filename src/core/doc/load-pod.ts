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
import { traxxSitFromParsed, TRAXX_BOX_CRUSH, TRAXX_MAX_BOXES, V6_MAX_BOXES, type TraxxBox } from "../traxx/sit.ts";
import { boxHeightPairOf, surfaceTrack } from "../traxx/box-ground.ts";
import type { TxxAnimation, TxxCourseSegment, TxxGroundBox, TxxSound } from "../traxx/txx.ts";
import { isHdName, rawSide, resolveItemName, seekToItem, swapExt } from "../traxx/pod-items.ts";
import { withSysColors } from "../traxx/palette.ts";
import { CELLS, inferPrefixAuto, interpolateRawAtPoint, uiInfoName } from "../traxx/terrain.ts";
import { atoi, traxxLines } from "../traxx/lines.ts";
import { loadRaw, parseTerrainGridKey, parseTerrainHeightsKey, resolveTerrainMode, setModeOnLoad, refreshRaw, RAWLEN_8BIT, RAWLEN_16BIT, RAWLEN_FINE, TERRAINMODE_CLASSIC16, TERRAINMODE_CLASSIC8, TERRAINMODE_FINE, TERRAINMODE_SPLINE, TERRAIN_FINE, type Terrain16 } from "../traxx/terrain16.ts";
import { frameNameTooLongForPod, modelFrameNames } from "../traxx/keyframe.ts";
import { decodePngSamples } from "../../vendor/openphotex/texture/png.js";
import { resetTrack } from "./new-track.ts";
import { vegetationFromPod } from "../traxx/veg.ts";
import { buildLakeGround } from "../traxx/surface.ts";
import { lakesSignature, parseWtrLakes, recomputeLakes, LAKES_MISMATCH } from "../traxx/lakes.ts";
import { parseWflFalls, trackNotches, FALLS_WFL_REFUSED } from "../traxx/falls.ts";
import { emptyCarry, type ModelAsset, type TextureAsset, type TrackDocument } from "./document.ts";
import { afterFirstSlash, findAsset } from "./names.ts";
import { notePodSurfaces } from "./surface-sidecar.ts";
import { readTxvV6, type TxvV6 } from "../../vendor/openphotex/mtm/txv.js";
import { decodeMtm2V6Heights, mtm2V6HeightsH128 } from "../../vendor/openphotex/mtm/heights.js";
import { checkMtm2GridSize, mtm2GroundBoxDepth, mtm2GroundBoxHeightFt } from "../../vendor/openphotex/terrain/ground-boxes.js";
import { cellsOf } from "../traxx/world.ts";
import { vegBoundsProblem } from "../traxx/veg.ts";

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

/**
  PodIsSituationName: the text after the FIRST dot is .SIT or .SI2, or (track format version 6,
  spec 5.1) .SI3. A .SI3 is its own track, listed beside a .SIT or .SI2 of the same stem.
*/
export function situationKind(name: string): "sit" | "si2" | "si3" | null {
  const dot = name.indexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot).toUpperCase();
  return ext === ".SIT" ? "sit" : ext === ".SI2" ? "si2" : ext === ".SI3" ? "si3" : null;
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
  let index = 0, sitEntry: PodEntry | null = null, si2 = false, si3 = false;
  for (const e of entries) {
    const kind = situationKind(e.name);
    if (!kind) continue;
    if (index++ === which) { sitEntry = e; si2 = kind === "si2"; si3 = kind === "si3"; break; }
  }
  if (!sitEntry) throw new Error(index === 0 ? "No tracks in this POD." : `This POD has no track ${which + 1}.`);
  progress(0, "Reading the situation file");

  /*
    Track format version 6 (spec 5.2, 6): a .SI3 track needs DATA\<stem>.TXV with formatVersion=6
    and valid section 6 keys, or it is refused with the key named (readTxvV6). Its world size
    sizes every grid below.
  */
  const sitFile = sitEntry.name.slice(sitEntry.name.lastIndexOf("\\") + 1);
  const sitStem = sitFile.slice(0, sitFile.indexOf(".") >= 0 ? sitFile.indexOf(".") : undefined).toUpperCase();
  let v6: TxvV6 | null = null;
  let v6TxvText: string | null = null;
  if (si3) {
    const txvBytes = await fetchPodOnly(`DATA\\${sitStem}.TXV`);
    try {
      v6 = readTxvV6(txvBytes);
    } catch (err) {
      throw new Error(`${sitEntry.name} is a track format version 6 track and cannot be opened: ${(err as Error).message}`);
    }
    v6TxvText = txvBytes ? new TextDecoder("windows-1252").decode(txvBytes) : null;
  }
  const cells = v6?.worldCells ?? 256;

  const track = resetTrack(cells);
  const doc: TrackDocument = {
    track, textures: [], modelTextures: [], models: [], carry: emptyCarry(), prefixAuto: true, viewOnly: true,
    source: { kind: "pod", fileName, trackIndex: which }, objectsShort: 0, objectsDropped: 0, groundBoxOverflow: 0,
    missingTextures: [], missingModels: [], warnings: [],
  };
  track.comment = source.archive.comment.slice(0, 79);
  doc.carry.situationIsSi2 = si2;
  doc.carry.situationIsSi3 = si3;
  if (v6) doc.warnings.push(...v6.warnings);

  const sitBytes = await source.read(sitEntry);
  // Negative x or z wrap by the world's side (spec 8.4): 8192 ft, or 32 N for a .SI3.
  const parsed = parseMtmSit(sitBytes, sitEntry.title, { worldFt: 32 * cells });
  // A UI picture counts as present when its HD sibling is (LoadUIArtHD before SeekToItem).
  const present = (name: string) => Boolean(seek(name)) || (/\.BMP$/i.test(name) && Boolean(seek(swapExt(name, "PNG")) || seek(swapExt(name, "TGA"))));
  const sit = traxxSitFromParsed(parsed, { hasEntry: present, text: sitBytes, worldCells: cells, maxBoxes: si3 ? V6_MAX_BOXES : TRAXX_MAX_BOXES });
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
  const raw = lvlBytes ? await readLevel(lvlBytes, doc, fetchPodOnly, fetch, progress, resolve, entryName, v6) : { length: -1, ok: false };

  // The .TXV record, if the pod has one (a .SI3 track's is its own DATA\<stem>.TXV, read above).
  const txv = entries.find((e) => /\.TXV$/i.test(e.name.slice(e.name.lastIndexOf("."))) && e.length >= 1 && e.length <= 65536);
  if (v6) doc.carry.txvText = v6TxvText;
  else if (txv) doc.carry.txvText = new TextDecoder("windows-1252").decode(await source.read(txv));

  // Now that the .RAW and the .TXV are both in, what the terrain is (Load, after the item loop).
  // A version 6 track with terrainHeightMap has its heights already (readLevel); without one it
  // follows CP4's rules, as today (spec 7.1).
  const heightsEntry = v6?.terrainHeightMap ? "" : parseTerrainHeightsKey(doc.carry.txvText);
  if (v6?.terrainHeightMap) { /* read in readLevel */ }
  else if (heightsEntry) applyTerrainHeightsImage(doc, doc.carry.txvText, heightsEntry, await fetchPodOnly(heightsEntry.toUpperCase()), raw);
  else if (raw.length >= 0 && raw.ok) resolveTerrainFromTxv(doc, doc.carry.txvText, raw.length);

  // Traxx 1.7: WORLD\<stem>.VEG and its painted masks, WORLD\<stem>.WTR (Load, after the info pop-up).
  await readVegetationAndLakes(doc, fetchPodOnly, si3);

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
      // ParseSITFile (Traxx 1.8.0): a frame name longer than a pod entry is not loaded (CheckIntegrity reports it).
      if (cab?.frameNames[0] && !frameNameTooLongForPod(cab.frameNames[0])) await loadModel(cab.frameNames[0]);
    }
  }
  // The vegetation's species models reach a pod only by being in the model list. Traxx loads
  // the ones the .VEG names; until OpenPhotex reads .VEG, every other model the pod holds is
  // loaded when it has vegetation, so none of them is lost on the next Write POD.
  if (track.vegetation) {
    for (const e of entries) if (/^MODELS\\.*\.BIN$/i.test(e.name)) await loadModel(e.name.toUpperCase());
  }
  const backdrops = new Set<unknown>();
  for (const name of [track.backdropName, ...track.extraBackdrops]) if (name) backdrops.add(await loadModel(name));
  track.models = doc.models.filter((m) => !backdrops.has(m)).map((m) => m.name);
  // Traxx 1.7 (CTrackPOD::Load): a model whose pod also carries MODELS\<stem>.SRF is tagged a surface mesh.
  notePodSurfaces(doc.models, entries.map((e) => e.name));

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

  // The terrain detail normal and its painted mask, and the water pair beside them (Traxx 1.7.2:
  // _WDTL, _WMSK), .PNG then .TGA, byte for byte, any situation kind (.SIT, .SI2, .SI3).
  for (const [suffix, which2] of [["_DTL", "detail"], ["_MASK", "mask"], ["_WDTL", "wdetail"], ["_WMSK", "wmask"]] as const) {
    for (const ext of ["PNG", "TGA"] as const) {
      const bytes = await fetchPodOnly(`ART\\${track.prefix}${suffix}.${ext}`.toUpperCase());
      if (!bytes) continue;
      if (which2 === "detail") { track.detailMap = bytes; track.detailExt = `.${ext}`; doc.carry.detailFromPod = true; }
      else if (which2 === "mask") { track.maskMap = bytes; track.maskExt = `.${ext}`; doc.carry.maskFromPod = true; }
      else if (which2 === "wdetail") { track.waterDetailMap = bytes; track.waterDetailExt = `.${ext}`; doc.carry.waterDetailFromPod = true; }
      else { track.waterMaskMap = bytes; track.waterMaskExt = `.${ext}`; doc.carry.waterMaskFromPod = true; }
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
  // And each waterfall's WAV (the same addition, Traxx 1.7.1 falls): SOUND\<stem>.WAV, kept as continuous.
  for (const fall of track.falls) {
    if (!fall.sound) continue;
    const full = `SOUND\\${fall.sound}.WAV`.toUpperCase();
    if (sounds.some((s) => s.name.toUpperCase() === full)) continue;
    const data = await fetch(full);
    if (data) sounds.push({ name: full, flags: 1, data });
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
  v6: TxvV6 | null = null,
): Promise<{ length: number; ok: boolean }> {
  const track = doc.track;
  const cells = v6?.worldCells ?? 256;
  const nn = cells * cells;
  /* A .SI3 track's grid files must be N x N cells (spec 8.2): any other size refuses the track. */
  const gridFile = async (name: string): Promise<Uint8Array | null> => {
    const bytes = await fetchPodOnly(name);
    if (bytes && v6) checkMtm2GridSize(name, bytes.length, cells);
    return bytes;
  };
  const lvl = parseMtmLvl(bytes);
  const rawResult = { length: -1, ok: false };
  if (!lvl) return rawResult;
  const up = (s: string | null) => (s ?? "").toUpperCase();

  if (lvl.textName) track.text = await fetchPodOnly(up(lvl.textName));

  progress(0.1, "Reading the terrain");
  // A version 6 track with terrainHeightMap: the heights come from that entry only, and the .RAW
  // the .LVL names need not exist (spec 6, 7).
  const raw = v6?.terrainHeightMap ? null : await fetchPodOnly(`DATA\\${up(lvl.rawName)}`);
  if (v6?.terrainHeightMap) await readV6Heights(doc, v6, fetchPodOnly);
  if (raw) {
    // LoadRawLegacy: 65,536, 131,072 or 2,097,152 bytes by size; any other size the old way, as
    // an 8-bit map from its first 64 KB (the rest at 100).
    rawResult.length = raw.length;
    rawResult.ok = loadRaw(track, raw);
    if (!rawResult.ok) {
      track.terrainMode = TERRAINMODE_CLASSIC8;
      track.h16 = track.fine = track.rawShadow = null;
      track.heights.fill(100);
      track.heights.set(raw.subarray(0, CELLS));
      doc.warnings.push(`The terrain height file ${up(lvl.rawName)} is ${raw.length.toLocaleString("en-US")} bytes. Traxx reads 65,536 (8-bit), 131,072 (16-bit) or 2,097,152 (16-bit Full Map) byte height files, so it was read as an 8-bit 256x256 map.`);
    }
  }
  // Read with or without the .RAW: a PNG-heights track packs none, and the ground boxes are
  // found from the name the .LVL gives all the same.
  const boxGrid = (ext: string) => (v6 ? gridFile : fetchPodOnly)(swapExt(up(lvl.rawName), ext));
  if (v6) {
    // Spec 8.2: every grid file of a .SI3 track is checked against N, used or not.
    for (const ext of ["RA2", "RA3", "RA4", "RA5", "CL1", "CL2"]) await boxGrid(ext);
    readGroundBoxesV6(doc, v6, await boxGrid("RA0"), await boxGrid("RA1"), await boxGrid("CL0"), swapExt(up(lvl.rawName), "RA0"), swapExt(up(lvl.rawName), "RA1"));
  } else {
    readGroundBoxes(doc, up(lvl.rawName), await boxGrid("RA0"), await boxGrid("RA1"), await boxGrid("CL0"));
  }
  const clr = await (v6 ? gridFile : fetchPodOnly)(up(lvl.clrName));
  if (clr) {
    const n = Math.min(nn, clr.length >> 1);
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
    const lte = await (v6 ? gridFile : fetchPodOnly)(up(lvl.lteName));
    if (lte) { const plane = new Uint8Array(nn * 7); plane.set(lte.subarray(0, nn * 7)); track.lte = plane; }
  }
  readLvlLighting(doc, lvl);
  // The line after the level value must be the label (ParseLVLFile reads it there).
  if (lvl.waterHeight !== null) track.waterLevel4 = lvl.waterHeight;
  return rawResult;
}

/**
  CTrackPOD::ReadLVLLighting (Traxx 1.7.2, 7d36314): the five lines after the .LTE name, the sun
  (the direction the light travels), the ambient, the boss light position and intensity, and the
  255 line. One reader for both ways in: a pod (ParseLVLFile) and Clone (CloneFromSIT), which
  used to skip them and so shipped Traxx's defaults. A missing line reads as 0, as atoi does.
*/
export function readLvlLighting(doc: TrackDocument, lvl: { sunVector?: number[] | null; shadowIntensity?: number | null; sunPosition?: number[] | null; sunIntensity?: number | null; levelValue?: number | null }): void {
  const v3 = (v: number[] | null | undefined): [number, number, number] => [v?.[0] ?? 0, v?.[1] ?? 0, v?.[2] ?? 0];
  doc.track.sun = {
    vector: v3(lvl.sunVector),
    shadowIntensity: lvl.shadowIntensity ?? 0,
    position: v3(lvl.sunPosition),
    intensity: lvl.sunIntensity ?? 0,
  };
  doc.carry.levelValue = lvl.levelValue ?? 0;
}

/**
  ResolveTerrainFromTXV: the height file's size decided the data; the .TXV's terrainGrid key
  can only call a 256 x 256 grid SPLINE, or disagree, which is reported once.
*/
export function resolveTerrainFromTxv(doc: TrackDocument, txv: string | null, rawLength: number): void {
  const { mode, warning } = resolveTerrainMode(parseTerrainGridKey(txv), rawLength);
  if (warning) doc.warnings.push(warning);
  if (mode !== doc.track.terrainMode && !setModeOnLoad(doc.track, mode)) {
    doc.warnings.push("This track could not be shown in the mode its files declare; it is open in the mode its height file gave it (Classic 8-bit, 16-bit or 16-bit Full Map). Check Special > Terrain Grid before saving.");
  }
}

/**
  ApplyTerrainHeightsImage: the terrainHeights= PNG decoded and turned into the bytes of the .RAW
  it stands for (HeightImageToRaw: 8-bit 256 -> 65,536; 16-bit 256 -> 131,072; any 1024 ->
  2,097,152, an 8-bit sample meaning b << 8), loaded in the mode that size gives and resolved
  against terrainGrid= exactly as that .RAW would be. Grey or grey + alpha (the alpha ignored), 8
  or 16 bits, 256 or 1024 square; anything else takes the fallback below.
*/
export function applyTerrainHeightsImage(doc: TrackDocument, txv: string | null, entry: string, png: Uint8Array | null, raw: { length: number; ok: boolean }): void {
  let why = png ? "" : "The pod has no entry by that name.";
  let bytes: Uint8Array | null = null;
  if (png) {
    try {
      const img = decodePngSamples(png);
      if (img.colorType !== 0 && img.colorType !== 4) why = "It is not a greyscale image.";
      // OpenPhotex reads 1, 2 and 4-bit grey too; a height image is 8 or 16-bit only.
      else if (img.bitDepth !== 8 && img.bitDepth !== 16) why = `It could not be decoded (png: bit depth ${img.bitDepth} is not supported).`;
      else if (img.width !== img.height || (img.width !== 256 && img.width !== 1024)) why = `It is ${img.width} x ${img.height}; a height image is 256 x 256 or 1024 x 1024.`;
      else {
        const n = img.width * img.height, ch = img.channels;
        if (img.width === 256 && img.bitDepth === 8) {
          bytes = new Uint8Array(n);
          for (let i = 0; i < n; i++) bytes[i] = img.samples[i * ch]!;
        } else {
          bytes = new Uint8Array(n * 2);
          for (let i = 0; i < n; i++) {
            const v = img.bitDepth === 8 ? img.samples[i * ch]! << 8 : img.samples[i * ch]!;
            bytes[2 * i] = v & 255;
            bytes[2 * i + 1] = v >> 8;
          }
        }
      }
    } catch (err) {
      why = `It could not be decoded (${(err as Error).message}).`;
    }
  }
  if (bytes && loadRaw(doc.track, bytes)) {
    doc.track.pngHeights = true;
    resolveTerrainFromTxv(doc, txv, bytes.length);
    return;
  }
  applyHeightsKeyUnsupported(doc, txv, entry, raw, why);
}

/**
  ApplyTerrainHeightsImage's fallback, for an image that cannot be used. The track keeps "Store heights as PNG" set; the .RAW, when one was read, is the terrain;
  without one the ground is flat at height 0 in the mode the track declares (16-bit, or a Full
  Map under terrainGrid=fine), as the engine does.
*/
export function applyHeightsKeyUnsupported(doc: TrackDocument, txv: string | null, entry: string, raw: { length: number; ok: boolean }, why = ""): void {
  const t = doc.track;
  t.pngHeights = true;
  let then: string;
  if (raw.length >= 0) {
    then = "The heights were read from the track's .RAW instead.";
    if (raw.ok) resolveTerrainFromTxv(doc, txv, raw.length);
  } else {
    then = "There is no .RAW to fall back on, so the terrain is flat at height 0.";
    const fine = parseTerrainGridKey(txv) === TERRAINMODE_FINE;
    const flat: Terrain16 = t;
    flat.terrainMode = fine ? TERRAINMODE_FINE : TERRAINMODE_CLASSIC16;
    flat.h16 = fine ? null : new Uint16Array(256 * 256);
    flat.fine = fine ? new Uint16Array(TERRAIN_FINE * TERRAIN_FINE) : null;
    flat.rawShadow = new Uint8Array(RAWLEN_8BIT);
    refreshRaw(flat);
    resolveTerrainFromTxv(doc, txv, fine ? RAWLEN_FINE : RAWLEN_16BIT);
  }
  doc.warnings.push(`The track's heights are stored in ${entry} (terrainHeights= in its .TXV), which could not be used.${why ? ` ${why}` : ""} ${then}`);
}

/*
  WORLD\<stem>.VEG, then the painted masks ART\<stem>_V / _G (.PNG then .TGA), then WORLD\<stem>.WTR
  (TrackPODFile.cpp):

    - the .VEG and the masks become the track's vegetation, which a .TXX keeps (V15) and Write
      POD packs back. A mask is adopted only when the .VEG's RULE chunk names it
      (vegetationFromPod, core/traxx/veg.ts);
    - the .WTR gives the lakes' authored part (ParseWTR); the terrain and the water level are in
      by now, so the tiles are recomputed, and a stored tile map that differs from the one Traxx
      computes is said once. An unusable file leaves no lakes;
    - Traxx 1.7.1: the .WFL gives the waterfalls (ParseWFL), read after the .WTR; the lakes are
      recomputed only then, with the spillway notches the falls cut (UpdateLakeNotches), before
      the tile map is compared. An unusable file leaves no falls.
*/
async function readVegetationAndLakes(doc: TrackDocument, fetchPodOnly: (name: string) => Promise<Uint8Array | null>, si3 = false): Promise<void> {
  const p = doc.track.prefix.toUpperCase();
  if (!p) return;
  const cells = cellsOf(doc.track);
  const veg = await fetchPodOnly(`WORLD\\${p}.VEG`);
  if (veg && veg.length > 0) {
    // Spec 9.2: trees anywhere in [0, W * 256), grass tiles 0..N-1.
    const v = await vegetationFromPod(p, async (name) => (name === `WORLD\\${p}.VEG` ? veg : fetchPodOnly(name)), cells);
    doc.track.vegetation = { masks: v.masks.map((m) => (m ? { ext: m.ext, data: m.data } : null)), image: veg };
    const why = si3 ? vegBoundsProblem(veg, cells) : null;
    if (why) doc.warnings.push(`WORLD\\${p}.VEG: ${why}`);
  }
  const wtr = await fetchPodOnly(`WORLD\\${p}.WTR`);
  let stored: Uint8Array | null | undefined;
  if (wtr && wtr.length > 0) {
    // A .SI3 track's .WTR may be version 1 or 2, N x N (spec 9.1); others are read as Traxx reads them.
    const parsed = si3 ? parseWtrLakes(wtr, cells) : parseWtrLakes(wtr);
    if (parsed) {
      doc.track.lakes = parsed.lakes;
      stored = parsed.tmap;
      // Traxx 1.7.3: the lakes are re-filled with the rule that built them (header flags bit 0: EDGE, else TILE).
      doc.track.lakeRule = parsed.rule;
    }
  }
  const wfl = await fetchPodOnly(`WORLD\\${p}.WFL`);
  if (wfl && wfl.length > 0) {
    // A .SI3 track's .WFL may be version 1 or 2, its header N x N (spec 9.3); others are read as Traxx reads them.
    const falls = si3 ? parseWflFalls(wfl, cells) : parseWflFalls(wfl);
    if (!falls && si3) doc.warnings.push(FALLS_WFL_REFUSED);
    doc.track.falls = falls ?? [];
  }
  // The lakes, now that the falls (and so the notches) are in; the stored map is only compared.
  if (stored !== undefined) {
    const st = recomputeLakes(buildLakeGround(doc.track), doc.track.lakes, doc.track.waterLevel4, trackNotches(doc.track));
    if (!stored || !sameBytes(stored, st.tmap)) {
      doc.warnings.push(LAKES_MISMATCH);
      // JSTraxx: the pod's own map and file are kept until a lake or a fall changes (StoredLakes).
      if (stored && stored.length === st.tmap.length && wtr) doc.track.storedLakes = { sig: lakesSignature(doc.track), tmap: stored, wtr };
    }
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
  The heights of a version 6 track with terrainHeightMap (spec 7): the entry decoded at N with its
  step and base (decodeMtm2V6Heights; a wrong size refuses the track), kept at 1/128 ft in the
  32-bit store (mtm2V6HeightsH128, spec 7.3). classic is the 16-bit 32 ft grid, spline the same
  grid shown smoothed, fine the 8 ft Full Map. The step and base are remembered for Write POD.
*/
async function readV6Heights(doc: TrackDocument, v6: TxvV6, fetchPodOnly: (name: string) => Promise<Uint8Array | null>): Promise<void> {
  const t = doc.track;
  const name = v6.terrainHeightMap!;
  const bytes = await fetchPodOnly(name.toUpperCase());
  if (!bytes) throw new Error(`terrainHeightMap: this pod has no entry ${name}, so the track cannot be opened.`);
  let d;
  try {
    d = decodeMtm2V6Heights(bytes, { name, cells: v6.worldCells, step: v6.terrainHeightStep, base: v6.terrainHeightBase, terrainGrid: v6.terrainGrid });
  } catch (err) {
    throw new Error(`terrainHeightMap ${name}: ${(err as Error).message}`);
  }
  if (d.warning) doc.warnings.push(d.warning);
  const n = v6.worldCells;
  if (d.mode === "fine") {
    t.terrainMode = TERRAINMODE_FINE;
    t.fine = mtm2V6HeightsH128(d.fine!, d.step, d.base);
    t.h16 = null;
  } else {
    t.terrainMode = d.mode === "spline" ? TERRAINMODE_SPLINE : TERRAINMODE_CLASSIC16;
    t.h16 = mtm2V6HeightsH128(d.coarse, d.step, d.base);
    t.fine = null;
  }
  t.rawShadow = new Uint8Array(n * n);
  refreshRaw(t);
  t.pngHeights = /\.PNG$/i.test(name);
  t.heightStep = d.step;
  t.heightBase = d.base;
}

/*
  The ground boxes of a version 6 track (spec 8.3): RA0 / RA1 8 or 16-bit (the pair must agree,
  mtm2GroundBoxDepth), heights base + 2 * byte or base + value / step (mtm2GroundBoxHeightFt; step
  128 and base 0 when the track has no terrainHeightMap). Kept in Traxx's 2 ft units, which may now
  be fractional, negative or above 255. One box per cell whose top is not 0, up to 2048, as LoadGroundBoxes.
*/
export function readGroundBoxesV6(doc: TrackDocument, v6: TxvV6, ra0: Uint8Array | null, ra1: Uint8Array | null, cl0: Uint8Array | null, ra0Name = "RA0", ra1Name = "RA1"): void {
  if (!ra0 || !ra1 || !cl0) return;
  const n = v6.worldCells;
  const depth = mtm2GroundBoxDepth(ra0, ra1, n, [ra0Name, ra1Name]);
  const step = v6.terrainHeightMap ? v6.terrainHeightStep : 128;
  const base = v6.terrainHeightMap ? v6.terrainHeightBase : 0;
  const r0 = new DataView(ra0.buffer, ra0.byteOffset, ra0.byteLength), r1 = new DataView(ra1.buffer, ra1.byteOffset, ra1.byteLength);
  const value = (v: DataView, c: number) => (depth === 16 ? v.getUint16(2 * c, true) : v.getUint8(c));
  const faces = new DataView(cl0.buffer, cl0.byteOffset, cl0.byteLength);
  const boxes: TxxGroundBox[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = i + j * n;
      const top = value(r1, c);
      if (top === 0) continue;
      if (boxes.length >= MAX_GROUND_BOXES) { doc.groundBoxOverflow++; continue; }
      const words: number[] = [];
      for (let f = 0; f < 6; f++) words.push(faces.getUint16(c * 12 + f * 2, true));
      boxes.push({
        x: i, y: j, w: 1, h: 1,
        lower: mtm2GroundBoxHeightFt(value(r0, c), depth, step, base) / 2,
        upper: mtm2GroundBoxHeightFt(top, depth, step, base) / 2,
        faces: words,
      });
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
  // An HD name is HD whatever its length: a PNG can happen to be a square number of bytes.
  const side = isHdName(name) ? 0 : rawSide(bytes.length);
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
  // GetAniName (Traxx 1.8.0, eaaace7): KEYFRAME and KEYFRAME64, every name whole and upper-cased.
  return { name, bytes, textureNames, frameNames: modelFrameNames(bytes), bad: false };
}

/*
  DeriveBoxHeightsAboveGround: each box's height above the terrain from its absolute Z, after
  normalising the fraction to 0..255. Not clamped at zero: buried props stay buried.
*/
export function deriveBoxHeights(track: { boxes: { ipos: [number, number, number]; fraction: [number, number, number]; heightAboveGround: number }[]; heights: Uint8Array } & Partial<Terrain16>): void {
  // Traxx 1.7 (e4e034d): on 16-bit, Spline and Full Map the ground has a fraction of its own,
  // so the height is the floored difference of the totals; ipos[2] and zfraction stay absolute.
  const surface = surfaceTrack(track as Terrain16);
  for (const box of track.boxes) {
    while (box.fraction[2] < 0) { box.fraction[2] += 256; box.ipos[2]--; }
    while (box.fraction[2] > 255) { box.fraction[2] -= 256; box.ipos[2]++; }
    if (surface) box.heightAboveGround = boxHeightPairOf(surface, box as TraxxBox)[0];
    else box.heightAboveGround = box.ipos[2] - interpolateRawAtPoint(track.heights, box.ipos[0], box.ipos[1]);
  }
}
