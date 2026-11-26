/*
  Clone TrackEd Track: CTrackPOD::CloneFromSIT (TrackPOD/TrackPODClone.cpp), then what
  CTraxxDoc::OnFileClone does after it (LoadMTM2Palette, LoadTextures, LoadModels).

  The source is a loose TrackEd folder: WORLD\<stem>.SIT with LEVELS\, DATA\, ART\ and MODELS\
  beside it. The situation file is read by the same reader a POD uses (Traxx's clone parser is
  a second copy of it); what a clone does differently is applied here:

    - a fresh stem: the source stem with 2, 3, ... 999 taken out of its own 20 characters,
      the first that no WORLD\*.SIT, WORLD\*.SI2 or LEVELS\*.LVL in the folder uses
      (Pod1PickCloneStem), and the track name with "2" added;
    - the UI picture names are not kept, so the clone derives its own;
    - always an MTM2 track, with the stock palette, fog map and pictures; no stadium, no
      backdrop, no text, music or fog table;
    - every .TEX line is a texture slot ("ART\<name>"), duplicates included;
    - the LVL's sun, ambient, boss light and 255 line are read (Traxx 1.7.2's ReadLVLLighting);
    - RAW, RA0, RA1, CL0, CLR, TEX, TTY and LTE must all be there (the RAW may be missing when
      the .TXV beside it names a heights PNG, Traxx 1.7); the RAW's size gives the terrain mode.

  Traxx origin/main (1.8.2-beta): a .SI3 (track format version 6) clones through the v6 path, with the same rules and
  sentences as Open POD ("cloned" for "opened"): its .TXV's keys as the engine reads them, the world's size first,
  the terrainHeightMap (or the CP4 .RAW at step 128, base 0), the box layers by the engine's rules, the grids at their
  exact sizes, the water in the window, then EndV6Read. A classic .SIT / .SI2 whose own .TXV carries a v6-only key is
  refused. The loose WORLD\<source stem>.WFL and .WTR beside the situation file are read as a pod's are, then a loose
  WORLD\<source stem>.CPX is applied if it fits these boxes (ApplyRaceRulesCpx; its walls and lead-ins are the only
  ones a clone gets). A failed clone leaves nothing behind.

  Art and models are then found by name as for a .TXX. Traxx looks only in its ART and MODELS
  folders; JSTraxx looks in the TrackEd folder's own ART and MODELS first (cloneAssetSource).

  Surface meshes (Traxx 1.7): LoadModels notes each model's source file (NoteSource,
  TrackPODBinary.cpp), and Write POD packs the .SRF found beside it (FindSurfaceSidecar). So a
  cloned model's .SRF is the one beside the .BIN it was read from: the TrackEd folder's
  MODELS\<stem>.SRF for a model found there, the MODELS folder's or the same library pod's for
  one found there, never one from another place.
*/
import { parseMtmSit, parseMtmLvl } from "../../vendor/openphotex/mtm/sit.js";
import { traxxSitFromParsed, TRAXX_BOX_CRUSH, TRAXX_MAX_BOXES, V6_MAX_BOXES } from "../traxx/sit.ts";
import type { TxxCourseSegment } from "../traxx/txx.ts";
import { applyMtm2Palette } from "../traxx/palette.ts";
import { inferPrefixAuto, POD1_TRACK_STEM_MAX } from "../traxx/terrain.ts";
import { pickFreeStem } from "../traxx/free-stem.ts";
import { swapExt } from "../traxx/pod-items.ts";
import { atoi, traxxLines } from "../traxx/lines.ts";
import { resetTrack } from "./new-track.ts";
import { emptyCarry, MTM2_ONLY, type TrackDocument } from "./document.ts";
import {
  applyStoredLakes, applyTerrainHeightsImage, applyV6HeightMap, deriveBoxHeights, endV6Read, readGroundBoxes, readGroundBoxesV6, readLvlLighting,
  resolveTerrainFromTxv, type V6Read,
} from "./load-pod.ts";
import { v6BadKeyRefusal, v6MsgGridSize, v6MsgMissingFile, v6MsgNoHeights, v6NoMap512Refusal, v6ParseTxv, v6TxvLevelRefusal, v6WaterRefusal } from "../traxx/v6.ts";
import { parseWtrLakes } from "../traxx/lakes.ts";
import { parseWflFalls } from "../traxx/falls.ts";
import { applyRaceRulesCpx } from "../traxx/race-rules.ts";
import { loadRaw, parseTerrainHeightsKey } from "../traxx/terrain16.ts";
import { loadTrackAssets, type AssetSource } from "./load-txx.ts";
import { findAsset } from "./names.ts";
import { layeredModels } from "./surface-sidecar.ts";

/** A TrackEd folder: files by their path below it, "WORLD\\X.SIT", any case. */
export interface TrackedFolder {
  read(path: string): Promise<Uint8Array | null>;
  /** Whether a file exists (for picking the clone's stem). */
  has(path: string): boolean;
}

/**
  The clone's art and models: the TrackEd folder's ART and MODELS, then `library` (Traxx's ART
  and MODELS folders and the game library). A .SRF is read only from where its model came.
*/
export function cloneAssetSource(folder: TrackedFolder, library: AssetSource): AssetSource {
  return {
    art: async (p) => (await folder.read(`ART\\${p}`)) ?? library.art(p),
    model: layeredModels([(p) => folder.read(`MODELS\\${p}`), (p) => library.model(p)]),
  };
}

export class CloneError extends Error {
  override name = "CloneError";
}

/* CLONEERR_* (TrackPODClone.cpp). */
const ERR = {
  noFile: "Can't open SIT file!",
  badRoot: "SIT not in proper location.",
  badSit: "Error in SIT file.",
  noLvl: "Can't open LVL file!",
  noRaw: "Can't open terrain RAW file!",
  noClr: "Can't open CLR file!",
  noTex: "Can't open TEX file!",
  noTty: "Can't open TTY file!",
  noLte: "Can't open LTE file!",
  noGroundBox: "Error loading GroundBox layer!",
};

/** Pod1PickCloneStem: the first free <base><n>, n = 2..999, the digits taken out of the stem's 20 (Pod1PickFreeStem). */
export function pickCloneStem(base: string, taken: (stem: string) => boolean): string | null {
  return pickFreeStem(base, taken);
}

export async function cloneFromSit(folder: TrackedFolder, sitPath: string, assets: AssetSource, progress: (f: number, label: string) => void = () => {}): Promise<TrackDocument> {
  if (!/^WORLD\\/i.test(sitPath)) throw new CloneError(ERR.badRoot);
  const sitBytes = await folder.read(sitPath);
  if (!sitBytes) throw new CloneError(ERR.noFile);
  const lines = traxxLines(sitBytes);
  const lvlName = (lines[0] ?? "").toUpperCase();
  const base = lvlName.split(".")[0].slice(0, POD1_TRACK_STEM_MAX);
  if (!base) throw new CloneError(ERR.badSit);
  const prefix = pickCloneStem(base, (stem) => ["WORLD\\%.SIT", "WORLD\\%.SI2", "WORLD\\%.SI3", "LEVELS\\%.LVL"].some((shape) => folder.has(shape.replace("%", stem))));
  if (!prefix) {
    throw new CloneError(`Can't find an unused name for the clone - everything from "${base}2" to "${base}999" is already in use. A track file name can be at most 20 characters, because LEVELS\\<name>.LVL has to fit the 31 a pod directory entry holds, so the number has to come out of the name itself. Rename or remove some of the existing copies.`);
  }

  // The level: every file it needs, from DATA\.
  progress(0.05, "Reading the level");
  const lvlBytes = await folder.read(`LEVELS\\${lvlName}`);
  if (!lvlBytes) throw new CloneError(ERR.noLvl);
  const lvl = parseMtmLvl(lvlBytes);
  if (!lvl) throw new CloneError(ERR.noLvl);
  const up = (n: string | null) => (n ?? "").toUpperCase();
  const rawName = up(lvl.rawName);
  const data = (name: string) => folder.read(`DATA\\${name.toUpperCase()}`);
  // The .TXV beside the .RAW, read first, whole up to 65,536 bytes: terrainHeights= says the heights are a PNG, and
  // then the .RAW need not exist. Otherwise the .RAW's size decides (LoadRaw: 64 KB, 128 KB or 2 MB, anything else
  // refused) and terrainGrid= can call a 256 x 256 grid spline.
  const txvBytes = rawName.includes(".RAW") ? await data(rawName.replace(".RAW", ".TXV")) : null;
  const txv = txvBytes ? new TextDecoder("windows-1252").decode(txvBytes.subarray(0, 65536)).split("\0")[0]! : null;
  const heightsEntry = parseTerrainHeightsKey(txv);
  let pngKey = Boolean(heightsEntry);

  /*
    A version 6 track (.SI3): its keys are in the same .TXV, read as the engine reads them. A bad value, formatVersion
    under 6 or a 512 world with no terrainHeightMap is refused, naming it. A named terrainHeightMap replaces the .RAW
    and terrainHeights=; without one the CP4 rules run at step 128, base 0. The world's size is set first (the read is
    tall, EndV6Read narrows it). A classic .SIT / .SI2 whose own .TXV carries a v6-only key is refused.
  */
  const dot = sitPath.lastIndexOf(".");
  const si3 = dot >= 0 && sitPath.slice(dot).toUpperCase() === ".SI3";
  let v6: V6Read | null = null;
  if (si3) {
    const p6 = v6ParseTxv(txv);
    if (p6.badKey) throw new CloneError(v6BadKeyRefusal(p6.badKey, "cloned"));
    const level = v6TxvLevelRefusal(true, txv);
    if (level) throw new CloneError(level);
    const map = p6.mapName !== "";
    if (p6.cells === 512 && !map) throw new CloneError(v6NoMap512Refusal("cloned"));
    v6 = { cells: p6.cells, step: map ? p6.step : 128, base: map ? p6.base : 0, mapName: p6.mapName };
    if (map) pngKey = false;
  } else {
    const level = v6TxvLevelRefusal(false, txv);
    if (level) throw new CloneError(level);
  }
  const cells = v6?.cells ?? 256;
  const nn = cells * cells;

  const track = resetTrack(cells, v6 ? "tall" : "classic");
  track.versionFlags |= MTM2_ONLY;
  track.prefix = prefix;
  const doc: TrackDocument = {
    track, textures: [], modelTextures: [], models: [], carry: emptyCarry(), prefixAuto: true, viewOnly: false,
    source: { kind: "clone", fileName: sitPath }, objectsShort: 0, objectsDropped: 0, groundBoxOverflow: 0,
    missingTextures: [], missingModels: [], warnings: [], notices: [],
  };

  let rawLength = -1;
  if (v6?.mapName) {
    // The map's file, by the key's name under the track's folder, as the engine opens it.
    const bytes = await folder.read(v6.mapName.toUpperCase());
    const why = bytes && bytes.length > 0 ? applyV6HeightMap(doc, txv, v6, bytes) : "";
    if (!bytes || bytes.length === 0 || why !== null) {
      throw new CloneError(`This track's height map ${v6.mapName} cannot be used: ${why || (bytes ? "it could not be read" : "file not found")}.`);
    }
  } else {
    const raw = await data(rawName);
    if (raw) {
      if (loadRaw(track, raw)) rawLength = raw.length;
      else if (!pngKey) {
        throw new CloneError(`The terrain height file ${rawName} is ${raw.length} bytes. Traxx reads 65,536 (8-bit), 131,072 (16-bit) or 2,097,152 (16-bit Full Map) byte height files, or the file is damaged.`);
      }
    } else if (!pngKey) throw new CloneError(v6 ? v6MsgNoHeights(rawName) : ERR.noRaw);
  }
  if (pngKey) applyTerrainHeightsImage(doc, txv, heightsEntry, await folder.read(heightsEntry.toUpperCase()), { length: rawLength, ok: rawLength >= 0 });
  else if (!v6?.mapName && rawName.includes(".RAW")) resolveTerrainFromTxv(doc, txv, rawLength);

  if (v6 && rawName.includes(".RAW")) {
    // The ground box layers of a v6 track, by the engine's rules (the same ones Open POD follows).
    const name = (ext: string) => rawName.replace(".RAW", `.${ext}`);
    const ra0 = await data(name("RA0"));
    const ra1 = ra0 ? await data(name("RA1")) : null;
    const cl0 = ra1 ? await data(name("CL0")) : null;
    const why = readGroundBoxesV6(doc, v6, ra0, ra1, cl0, name("RA0"), name("RA1"), name("CL0"));
    if (why) throw new CloneError(why);
  } else if (!v6) {
    const [ra0, ra1, cl0] = await Promise.all(["RA0", "RA1", "CL0"].map((ext) => data(swapExt(lvl.rawName, ext))));
    if (!ra0 || !ra1 || !cl0) throw new CloneError(ERR.noGroundBox);
    readGroundBoxes(doc, lvl.rawName, ra0, ra1, cl0);
  }
  const clr = await data(lvl.clrName);
  // A .SI3 with no .CLR, or one of another size than 2 * N * N, is refused in the engine's words.
  if (!clr) throw new CloneError(v6 ? v6MsgMissingFile("colour file", up(lvl.clrName)) : ERR.noClr);
  if (v6 && clr.length !== 2 * nn) throw new CloneError(v6MsgGridSize(up(lvl.clrName), clr.length, 2 * nn, cells));
  const n = Math.min(nn, clr.length >> 1);
  const view = new DataView(clr.buffer, clr.byteOffset, n * 2);
  for (let i = 0; i < n; i++) track.clr[i] = view.getUint16(i * 2, true);

  const tex = await data(lvl.texName);
  if (!tex) throw new CloneError(ERR.noTex);
  const texLines = traxxLines(tex);
  const count = atoi(texLines[0]);
  for (let t = 0; t < count; t++) track.textures.push({ name: `ART\\${(texLines[t + 1] ?? "").toUpperCase()}`.slice(0, 31), type: 0, depth: 1 });
  const tty = await data(swapExt(lvl.texName, "TTY"));
  if (!tty) throw new CloneError(ERR.noTty);
  const ttyLines = traxxLines(tty);
  for (let t = 0; t < atoi(ttyLines[0]); t++) {
    const line = (ttyLines[t + 1] ?? "").toUpperCase();
    const comma = line.indexOf(",");
    if (!line.includes(".RAW") || comma < 0) continue;
    const at = findAsset(track.textures, line.slice(0, comma));
    if (at < 0) continue;
    const value = atoi(line.slice(comma + 1));
    track.textures[at].type = Math.trunc(value / 100);
    track.textures[at].depth = value % 100;
  }
  // A .SI3 with no .LTE opens (the engine shades the world itself); a classic clone still needs one.
  const lte = lvl.lteName ? await data(lvl.lteName) : null;
  if (!lte && !v6) throw new CloneError(ERR.noLte);
  if (lte) {
    if (v6 && lte.length !== 7 * nn) throw new CloneError(v6MsgGridSize(up(lvl.lteName), lte.length, 7 * nn, cells));
    track.lte = new Uint8Array(nn * 7);
    track.lte.set(lte.subarray(0, nn * 7));
  }
  // The sun, ambient, boss light and the 255 line (ReadLVLLighting, shared with the pod reader).
  readLvlLighting(doc, lvl);
  if (lvl.waterHeight !== null) {
    // A .SI3's water is 0 .. 2 * (base + 65536 / step): outside that the engine refuses the track.
    const why = v6 ? v6WaterRefusal(lvl.waterHeight, v6.step, v6.base) : null;
    if (why) throw new CloneError(why);
    track.waterLevel4 = lvl.waterHeight;
  }

  // The situation file, through the shared reader.
  const parsed = parseMtmSit(sitBytes, sitPath.slice(sitPath.lastIndexOf("\\") + 1), { worldFt: 32 * cells });
  if (parsed.trackName === null) throw new CloneError(ERR.badSit);
  const sit = traxxSitFromParsed(parsed, { text: sitBytes, worldCells: cells, maxBoxes: v6 ? V6_MAX_BOXES : TRAXX_MAX_BOXES });
  const name = sit.trackName;
  track.trackName = name.length < 31 ? `${name}2` : `${name.slice(0, 30)}2`;
  track.localeName = sit.localeName;
  track.trackType = sit.trackType;
  if (sit.mtm2Only) { track.ambientSound = sit.ambientSound; track.weatherMask = sit.weatherMask; }
  track.trucks = sit.trucks;
  track.boxes = sit.boxes;
  const seg = (s: typeof sit.course[number]): TxxCourseSegment => ({ ...s, spare: [0, 0] });
  track.course = sit.course.map(seg);
  // The clone parser fills the extended courses in file order, not by slot.
  const ext = sit.extendedCourses.filter((c): c is NonNullable<typeof c> => c !== null);
  track.extendedCourses = [0, 1, 2, 3].map((i) => (ext[i] ? ext[i].map(seg) : null));
  doc.carry.cylinderCount = sit.cylinderCount;
  doc.carry.cylinderRaw = sit.cylinderRaw;
  doc.objectsDropped = sit.objectsDropped;
  doc.warnings.push(...sit.warnings);

  // Models by name, loaded below: each box's model, a crush car's base then cab.
  const models: string[] = [];
  const add = (m: string) => { if (m && findAsset(models.map((x) => ({ name: x })), m) < 0) models.push(`MODELS\\${m}`.slice(0, 31)); };
  for (const box of track.boxes) {
    add(box.modelName);
    if (box.type === TRAXX_BOX_CRUSH) add(box.crushName);
  }
  track.models = models;

  /*
    LAKES AND WATERFALLS: loose WORLD\<level stem>.WFL and .WTR beside the situation file, read the way Load reads
    them: the falls first, then the lakes, on the terrain, water level and ground boxes that are in by now. A .WTR
    whose tile map is not Traxx's own fill is kept and shown (ApplyStoredLakes). Both are optional.
  */
  const wfl = await folder.read(`WORLD\\${base}.WFL`);
  if (wfl && wfl.length > 0) track.falls = (v6 ? parseWflFalls(wfl, cells) : parseWflFalls(wfl)) ?? [];
  const wtr = await folder.read(`WORLD\\${base}.WTR`);
  let stored: Uint8Array | null | undefined;
  if (wtr && wtr.length > 0) {
    const lk = v6 ? parseWtrLakes(wtr, cells) : parseWtrLakes(wtr);
    if (lk) { track.lakes = lk.lakes; track.lakeRule = lk.rule; stored = lk.tmap; }
  }
  applyStoredLakes(doc, stored);
  /*
    RACE RULES: a loose WORLD\<level stem>.CPX beside the situation file, applied only if it fits these boxes; a stale
    one leaves the track as an old one, with a note. The stem is the source's: the clone's own name is only for the
    new files. An empty file is "the file is empty".
  */
  const cpxName = `WORLD\\${base}.CPX`;
  if (folder.has(cpxName)) {
    const cpx = await folder.read(cpxName);
    const d = applyRaceRulesCpx(track, track.raceRules, cpx && cpx.length > 0 ? cpx : null, cpxName);
    if (d.note) doc.notices!.push({ caption: "Race rules", text: d.note });
  }
  // A v6 track was read as tall (nothing clamped); now say whether it is.
  if (v6) endV6Read(track);

  deriveBoxHeights(track);
  doc.prefixAuto = inferPrefixAuto(track.trackName, track.prefix);

  // CTraxxDoc::OnFileClone: LoadMTM2Palette, then the art and models.
  const p = applyMtm2Palette({ palette: track.palette, fogMap: null, logoBmp: null, mapBmp: null, logoHd: false, mapHd: false });
  track.palette = p.palette;
  track.fogMap = p.fogMap;
  track.logoBmp = p.logoBmp;
  track.mapBmp = p.mapBmp;
  await loadTrackAssets(doc, assets, progress);
  progress(1, "Done");
  return doc;
}
