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
import { buildLakeGround, setMode } from "../traxx/surface.ts";
import { storeForKind, v6KindByContent } from "../traxx/track-kind.ts";
import { lakesSignature, parseWtrLakes, recomputeLakes } from "../traxx/lakes.ts";
import { parseWflFalls, trackNotches, FALLS_WFL_REFUSED } from "../traxx/falls.ts";
import { emptyCarry, type ModelAsset, type TextureAsset, type TrackDocument } from "./document.ts";
import { afterFirstSlash, findAsset } from "./names.ts";
import { notePodSurfaces } from "./surface-sidecar.ts";
import { cellsOf, TERRAIN_H_TALL_MAX } from "../traxx/world.ts";
import { vegBoundsProblem } from "../traxx/veg.ts";
import {
  heightScaleShift, sampleToHeight, v6BadKeyRefusal, v6DecodeHeightMap, v6MsgBoxNoPartner, v6MsgBoxPairSize, v6MsgCl0Size, v6MsgGridSize,
  v6MsgMissingFile, v6MsgNoHeights, v6NoMap512Refusal, v6ParseTxv, v6TxvLevelRefusal, v6WaterRefusal, V6_HEIGHTS_CLAMPED,
} from "../traxx/v6.ts";
import { heightImageDecode } from "../traxx/height-image.ts";
import { applyRaceRulesCpx } from "../traxx/race-rules.ts";

export const MAX_POD_TRACKS = 100;
export const MAX_TEXTURES = 1024;
export const MAX_MODEL_TEXTURES = 4096;
export const MAX_GROUND_BOXES = 2048;
export const MAX_ANIMATIONS = 64;
export const MAX_ANIMATION_FRAMES = 8;

/*
  A version 6 track (.SI3) being read (BeginV6Read: v6read, v6read_step, v6read_base, v6read_map): its world, the step
  and base its samples decode with (128 and 0 when it names no terrainHeightMap) and the map's name ("" for none).
*/
export interface V6Read {
  cells: number;
  step: number;
  base: number;
  mapName: string;
}

/** CTrackPOD::load_refusal: the first refusal of a read wins; the read goes on and is refused at its end. */
class Refusal {
  text = "";
  set(msg: string): void { if (!this.text) this.text = msg; }
}

/** A refused open: the track cannot be opened, with Traxx's sentence (load_refusal). */
export class PodLoadRefused extends Error {
  override name = "PodLoadRefused";
}

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
    The version record (PodReadTxvText). A .SI3 is judged by its OWN DATA\<stem>.TXV (the pod's first .TXV only when it
    has none by that stem), the way the engine reads it (V6ParseTXV): a key value the engine refuses, formatVersion under
    6 and a 512 world with no terrainHeightMap refuse the track, naming why. A classic .SIT / .SI2 whose own .TXV
    carries a v6-only key is "a version 6 level" and is refused too (formatVersion=6 alone is not: race rules write it).
  */
  const readTxvText = async (situation: string | null, ownOnly: boolean): Promise<string | null> => {
    const file = situation ? situation.slice(situation.lastIndexOf("\\") + 1) : "";
    const stem = situation ? (file.lastIndexOf(".") >= 0 ? file.slice(0, file.lastIndexOf(".")) : file).toUpperCase() : null;
    for (let pass = stem !== null ? 0 : 1; pass < (ownOnly && stem !== null ? 1 : 2); pass++) {
      for (const e of entries) {
        const dot = e.name.lastIndexOf(".");
        if (dot < 0 || e.name.slice(dot).toUpperCase() !== ".TXV") continue;
        if (pass === 0) {
          const t = e.name.slice(e.name.lastIndexOf("\\") + 1);
          if (t.slice(0, t.lastIndexOf(".")).toUpperCase() !== stem) continue;
        }
        if (e.length < 1 || e.length > 65536) continue;
        const text = new TextDecoder("windows-1252").decode(await source.read(e));
        const nul = text.indexOf("\0");
        return nul >= 0 ? text.slice(0, nul) : text;
      }
    }
    return null;
  };
  let v6: V6Read | null = null;
  let txvText: string | null;
  if (si3) {
    txvText = await readTxvText(sitEntry.name, false);
    const p6 = v6ParseTxv(txvText);
    if (p6.badKey) throw new PodLoadRefused(v6BadKeyRefusal(p6.badKey, "opened"));
    const level = v6TxvLevelRefusal(true, txvText);
    if (level) throw new PodLoadRefused(level);
    // With no height map the step and base are ignored (128 and 0), as in the engine.
    const map = p6.mapName !== "";
    if (p6.cells === 512 && !map) throw new PodLoadRefused(v6NoMap512Refusal("opened"));
    v6 = { cells: p6.cells, step: map ? p6.step : 128, base: map ? p6.base : 0, mapName: p6.mapName };
  } else {
    txvText = await readTxvText(null, false);
    const level = v6TxvLevelRefusal(false, await readTxvText(sitEntry.name, true));
    if (level) throw new PodLoadRefused(level);
  }
  const cells = v6?.cells ?? 256;

  // BeginV6Read (TrackPODFile.cpp): a .SI3 is read as a v6 track at the widest limit (tall), so nothing read is
  // clamped; EndV6Read below settles Standard or Tall by its content.
  const track = resetTrack(cells, si3 ? "tall" : "classic");
  const doc: TrackDocument = {
    track, textures: [], modelTextures: [], models: [], carry: emptyCarry(), prefixAuto: true, viewOnly: true,
    source: { kind: "pod", fileName, trackIndex: which }, objectsShort: 0, objectsDropped: 0, groundBoxOverflow: 0,
    missingTextures: [], missingModels: [], warnings: [], notices: [],
  };
  track.comment = source.archive.comment.slice(0, 79);
  doc.carry.situationIsSi2 = si2;
  doc.carry.txvText = txvText;

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
  const refusal = new Refusal();
  const raw = lvlBytes ? await readLevel(lvlBytes, doc, fetchPodOnly, fetch, progress, resolve, entryName, v6, refusal) : { length: -1, ok: false };
  // A grid file this world cannot take, no heights, the water out of the window (read inside the .LVL).
  if (refusal.text) throw new PodLoadRefused(refusal.text);

  /*
    Now that the .RAW and the .TXV are both in, what the terrain is (Load, after the item loop). A v6 track with a
    terrainHeightMap: its samples, by the entry's exact name (case-insensitive, no bare-name lookup), decoded with the
    key's step and base (ApplyV6HeightMap); a map that cannot be used refuses the track, naming it. Without one it
    follows CP4's rules (the .RAW, or terrainHeights=) at step 128, base 0.
  */
  if (v6 && v6.mapName) {
    const want = v6.mapName.toUpperCase();
    const hitem = entries.find((e) => e.name.toUpperCase() === want) ?? null;
    const hbytes = hitem && hitem.length > 0 && hitem.length <= 32 * 1024 * 1024 ? await source.read(hitem) : null;
    const why = hbytes ? applyV6HeightMap(doc, txvText, v6, hbytes) : "";
    if (!hbytes || why !== null) {
      throw new PodLoadRefused(`This track's height map ${v6.mapName} cannot be used: ${why || (hitem === null ? "the pod has no entry by that name" : "it could not be read")}.`);
    }
  } else {
    const heightsEntry = parseTerrainHeightsKey(txvText);
    if (heightsEntry) applyTerrainHeightsImage(doc, txvText, heightsEntry, await fetchPodOnly(heightsEntry.toUpperCase()), raw);
    else if (raw.length >= 0 && raw.ok) resolveTerrainFromTxv(doc, txvText, raw.length);
  }

  // Traxx 1.7: WORLD\<stem>.VEG and its painted masks, WORLD\<stem>.WTR, .WFL and the race rules' .CPX (Load).
  await readVegetationAndLakes(doc, fetchPodOnly, si3);
  if (si3) endV6Read(track);

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
  v6: V6Read | null = null,
  refusal: Refusal = new Refusal(),
): Promise<{ length: number; ok: boolean }> {
  const track = doc.track;
  const cells = v6?.cells ?? 256;
  const nn = cells * cells;
  const lvl = parseMtmLvl(bytes);
  const rawResult = { length: -1, ok: false };
  if (!lvl) return rawResult;
  const up = (s: string | null) => (s ?? "").toUpperCase();

  if (lvl.textName) track.text = await fetchPodOnly(up(lvl.textName));

  progress(0.1, "Reading the terrain");
  // A v6 track that names a terrainHeightMap does not use the .RAW (it is the 8-bit fallback for older readers).
  const raw = v6?.mapName ? null : await fetchPodOnly(`DATA\\${up(lvl.rawName)}`);
  if (!raw && v6 && !v6.mapName && !parseTerrainHeightsKey(doc.carry.txvText)) {
    // A .SI3 with no height map, no terrainHeights= PNG and no .RAW would open on a silently flat world: refused.
    refusal.set(v6MsgNoHeights(up(lvl.rawName)));
  }
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
  const boxGrid = (ext: string) => fetchPodOnly(swapExt(up(lvl.rawName), ext));
  if (v6) {
    // LoadGroundBoxes' v6 rules (the engine's v6BoxLayersLoad); the .RA2-.RA5, .CL1 and .CL2 are not read.
    if (/\.RAW/.test(up(lvl.rawName))) {
      const name = (ext: string) => up(lvl.rawName).replace(".RAW", `.${ext}`);
      const ra0 = await fetchPodOnly(name("RA0"));
      const ra1 = ra0 ? await fetchPodOnly(name("RA1")) : null;
      const cl0 = ra1 ? await fetchPodOnly(name("CL0")) : null;
      const why = readGroundBoxesV6(doc, v6, ra0, ra1, cl0, name("RA0"), name("RA1"), name("CL0"));
      if (why) refusal.set(why);
    }
  } else {
    readGroundBoxes(doc, up(lvl.rawName), await boxGrid("RA0"), await boxGrid("RA1"), await boxGrid("CL0"));
  }
  // A .SI3's grids are the engine's sizes exactly (2 * N * N, 7 * N * N): another size is refused, naming the file;
  // a .SI3 with no .CLR is refused (a classic pod without one still opens), one with no .LTE opens.
  let clr = await fetchPodOnly(up(lvl.clrName));
  if (v6 && clr && clr.length !== 2 * nn) { refusal.set(v6MsgGridSize(up(lvl.clrName), clr.length, 2 * nn, cells)); clr = null; }
  else if (v6 && !clr) refusal.set(v6MsgMissingFile("colour file", up(lvl.clrName)));
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
    let lte = await fetchPodOnly(up(lvl.lteName));
    if (v6 && lte && lte.length !== 7 * nn) { refusal.set(v6MsgGridSize(up(lvl.lteName), lte.length, 7 * nn, cells)); lte = null; }
    if (lte) { const plane = new Uint8Array(nn * 7); plane.set(lte.subarray(0, nn * 7)); track.lte = plane; }
  }
  readLvlLighting(doc, lvl);
  // The line after the level value must be the label (ParseLVLFile reads it there). A .SI3's water is 0 .. 2 * (base +
  // 65536 / step): outside that the engine refuses the track (it does not clamp).
  if (lvl.waterHeight !== null) {
    const why = v6 ? v6WaterRefusal(lvl.waterHeight, v6.step, v6.base) : null;
    if (why) refusal.set(why);
    else track.waterLevel4 = lvl.waterHeight;
  }
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
  /*
    RACE RULES: WORLD\<stem>.CPX, applied only when it was written for exactly these checkpoint boxes
    (ApplyRaceRulesCpx); otherwise nothing changes and the note says why, once ("Race rules"). An empty entry is
    "the file is empty". A pod with no .CPX is an old track and says nothing.
  */
  const cpxName = `WORLD\\${p}.CPX`;
  const cpx = await fetchPodOnly(cpxName);
  if (cpx) {
    const d = applyRaceRulesCpx(doc.track, doc.track.raceRules, cpx.length > 0 ? cpx : null, cpxName);
    if (d.note) doc.notices?.push({ caption: "Race rules", text: d.note });
  }
  // The lakes, now that the falls (and so the notches) are in (ApplyStoredLakes).
  applyStoredLakes(doc, stored);
}

/*
  ApplyStoredLakes (TrackPODFile.cpp): the lakes recomputed on the ground as it is now, the file's tile map compared
  with that fill and kept (and shown) when it differs: it is what the game draws, the engine never re-floods. A map
  equal to the fill is dropped. The author is told once (ReportStoredLakes, "Lakes"). `stored` undefined: no lake file.
*/
export function applyStoredLakes(doc: TrackDocument, stored: Uint8Array | null | undefined): void {
  if (stored === undefined || !stored) return;
  const t = doc.track;
  const st = recomputeLakes(buildLakeGround(t), t.lakes, t.waterLevel4, trackNotches(t));
  const nl = t.lakes.length;
  if (stored.length !== st.tmap.length || nl === 0) return;
  // SetStored keeps the ids the lakes name.
  const map = stored.map((id) => (id > nl ? 0 : id));
  let diff = 0;
  for (let i = 0; i < map.length; i++) if (map[i] !== st.tmap[i]) diff++;
  if (diff === 0) { t.storedLakeMap = null; return; }
  t.storedLakeMap = { tmap: map, lakes: nl, shown: true, sig: lakesSignature(t) };
  doc.notices?.push({ caption: "Lakes", text: storedLakesOpenText(diff) });
}

/** ReportStoredLakes (TraxxDoc.cpp): what the author is told when the view shows a stored lake map. */
export function storedLakesOpenText(ndiff: number): string {
  return `These lakes were not filled from their seeds the way Traxx fills them (${ndiff} tiles differ). Traxx shows them as stored, which is what the game shows. Editing the terrain, lakes or waterfalls recomputes them.`;
}

/*
  EndV6Read (TrackPODFile.cpp), once heights, boxes, water, lakes and falls are in: the track is tall when any of
  them goes above what 16 bits of 1/128 ft hold (track-kind.ts v6KindByContent), else Standard V6. A v6 track is
  never Classic 8-bit (SetTrackKind widens it). JSTraxx keeps the values as read (the save refuses what the kind
  cannot hold), and the store follows the kind.
*/
export function endV6Read(t: TrackDocument["track"]): void {
  t.trackKind = v6KindByContent(t);
  if (t.terrainMode === TERRAINMODE_CLASSIC8) setMode(t, TERRAINMODE_CLASSIC16);
  storeForKind(t);
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
      boxes.push({ x: i, y: j, w: 1, h: 1, lower: (ra0[c] ?? 0) << 8, upper: upper << 8, faces: words });
    }
  }
  doc.track.groundBoxes = boxes;
}

/*
  ApplyV6HeightMap (TrackPODFile.cpp): a terrainHeightMap entry decoded by its name (v6.ts v6DecodeHeightMap), each sample
  SampleToHeight at the key's step and base into the 32-bit store (the read is tall), N the coarse grid (Classic 16-bit,
  or Spline by terrainGrid=spline) and 4N the Full Map; a height above 8,192 ft is lowered to it, said once ("Terrain
  heights"). Null when it was applied, else why it cannot be used.
*/
export function applyV6HeightMap(doc: TrackDocument, txv: string | null, v6: V6Read, bytes: Uint8Array | null): string | null {
  const t = doc.track;
  const n = v6.cells;
  const d = v6DecodeHeightMap(v6.mapName, bytes, n, (f, c) => heightImageDecode(f, c));
  if (!d.ok) return d.why;
  const coarse = d.dim === n;
  const g = new Int32Array(d.samples.length);
  let clamped = false;
  for (let i = 0; i < g.length; i++) {
    const h = sampleToHeight(d.samples[i]!, v6.step, v6.base);
    if (h > TERRAIN_H_TALL_MAX) { g[i] = TERRAIN_H_TALL_MAX; clamped = true; } else g[i] = h;
  }
  t.terrainMode = coarse ? TERRAINMODE_CLASSIC16 : TERRAINMODE_FINE;
  t.h16 = coarse ? g : null;
  t.fine = coarse ? null : g;
  t.rawShadow = new Uint8Array(n * n);
  refreshRaw(t);
  t.pngHeights = /\.PNG$/i.test(v6.mapName);
  t.heightStep = v6.step;
  t.heightBase = v6.base;
  if (clamped) doc.notices?.push({ caption: "Terrain heights", text: V6_HEIGHTS_CLAMPED });
  // ResolveTerrainFromTXV speaks in 256-world lengths: a 512 world's files are the same two shapes.
  resolveTerrainFromTxv(doc, txv, coarse ? RAWLEN_16BIT : RAWLEN_FINE);
  return null;
}

/*
  The ground boxes of a version 6 track (LoadGroundBoxes, ReadV6BoxLayers, RebuildFromRA01CL0_16): .RA0 / .RA1 16-bit
  samples (2*N*N bytes) or 8-bit (N*N, a byte b decoding to base * 128 + 256 * b whatever the step), the same size as
  each other, and the .CL0 12*N*N. The engine's rules (Ground.cpp v6BoxLayersLoad): no .RA0 means no ground boxes and
  nothing more is asked; an .RA0 with no .RA1 is refused; with the pair right, a missing .CL0 is refused. One box per
  cell whose top is not 0, up to 2048. Returns the refusal, or null.
*/
export function readGroundBoxesV6(doc: TrackDocument, v6: Pick<V6Read, "cells" | "step" | "base">, ra0: Uint8Array | null, ra1: Uint8Array | null, cl0: Uint8Array | null, ra0Name = "RA0", ra1Name = "RA1", cl0Name = "CL0"): string | null {
  const n = v6.cells, NN = n * n;
  if (!ra0) return null;
  if (!ra1) return v6MsgBoxNoPartner(ra0Name, ra1Name);
  if (ra0.length !== ra1.length || (ra0.length !== NN && ra0.length !== 2 * NN)) return v6MsgBoxPairSize(ra0Name, ra0.length, ra1Name, ra1.length, NN);
  if (!cl0) return v6MsgMissingFile("ground box texture file", cl0Name);
  if (cl0.length !== 12 * NN) return v6MsgCl0Size(cl0Name, cl0.length, n);
  const sixteen = ra0.length === 2 * NN;
  const sh = heightScaleShift(v6.step);
  const word = (b: Uint8Array, c: number) => (sixteen ? b[2 * c]! | (b[2 * c + 1]! << 8) : ((b[c]! << 8) >> sh) & 0xffff);
  const faces = new DataView(cl0.buffer, cl0.byteOffset, cl0.byteLength);
  const boxes: TxxGroundBox[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = i + j * n;
      const top = word(ra1, c);
      if (top === 0) continue;
      if (boxes.length >= MAX_GROUND_BOXES) { doc.groundBoxOverflow++; continue; }
      const words: number[] = [];
      for (let f = 0; f < 6; f++) words.push(faces.getUint16(c * 12 + f * 2, true));
      boxes.push({ x: i, y: j, w: 1, h: 1, lower: sampleToHeight(word(ra0, c), v6.step, v6.base), upper: sampleToHeight(top, v6.step, v6.base), faces: words });
    }
  }
  doc.track.groundBoxes = boxes;
  return null;
}

/*
  ParseTEXFile: a count, then one name per line; slot t is line t + 1. Names resolve as model textures do (verbatim,
  .RAW, .PNG, .TGA). Traxx origin/main (122c43d): the list is POSITIONAL (tile ids index it), so every listed slot gets
  a texture named as listed: a missing item, a wrong-length item or a name already loaded becomes a 64x64
  placeholder (texturePlaceholder), which Write POD lists and does not pack. The missing ones are still reported.
*/
async function readTexList(
  doc: TrackDocument, bytes: Uint8Array, fetch: (name: string) => Promise<Uint8Array | null>,
  resolve: (name: string) => string, entryName: (name: string) => string | null,
): Promise<void> {
  const lines = traxxLines(bytes);
  const count = atoi(lines[0]);
  const slots: (TextureAsset | null)[] = [];
  const info: { name: string; type: number; depth: number }[] = [];
  for (let t = 0; t < count; t++) {
    if (t >= MAX_TEXTURES) break;
    const recorded = (lines[t + 1] ?? "").toUpperCase();
    const listed = `ART\\${recorded.slice(0, TEXTURENAMELEN - 4)}`.slice(0, TEXTURENAMELEN);
    const placeholder = () => { slots[t] = texturePlaceholder(listed); info[t] = { name: listed, type: 0, depth: 1 }; };
    if (findAsset(slots, recorded) >= 0) { placeholder(); continue; }
    const tex = recorded ? await loadTexture(resolve(recorded), fetch, entryName) : null;
    if (!tex) {
      if (recorded) doc.missingTextures.push(recorded);
      placeholder();
      continue;
    }
    slots[t] = tex;
    info[t] = { name: tex.name, type: 0, depth: 1 };
  }
  doc.textures = slots;
  doc.track.textures = info;
}

/** TEXTURENAMELEN (Include/TrackPODTexture.h). */
const TEXTURENAMELEN = 32;

/** NewTexPlaceholder: a named blank 64x64 tile standing in for a listed texture the pod cannot supply. */
export function texturePlaceholder(name: string): TextureAsset {
  return { name, side: 64, indices: new Uint8Array(64 * 64), act: null, hd: null, bad: false, placeholder: true };
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
