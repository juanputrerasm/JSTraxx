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
    - RAW, RA0, RA1, CL0, CLR, TEX, TTY and LTE must all be there.

  Art and models are then found by name as for a .TXX. Traxx looks only in its ART and MODELS
  folders; JSTraxx looks in the TrackEd folder's own ART and MODELS first.
*/
import { parseMtmSit, parseMtmLvl } from "../../vendor/openphotex/mtm/sit.js";
import { traxxSitFromParsed, TRAXX_BOX_CRUSH } from "../traxx/sit.ts";
import type { TxxCourseSegment } from "../traxx/txx.ts";
import { applyMtm2Palette } from "../traxx/palette.ts";
import { CELLS, inferPrefixAuto, POD1_TRACK_STEM_MAX } from "../traxx/terrain.ts";
import { swapExt } from "../traxx/pod-items.ts";
import { atoi, traxxLines } from "../traxx/lines.ts";
import { resetTrack } from "./new-track.ts";
import { emptyCarry, MTM2_ONLY, type TrackDocument } from "./document.ts";
import { deriveBoxHeights, readGroundBoxes } from "./load-pod.ts";
import { loadTrackAssets, type AssetSource } from "./load-txx.ts";
import { findAsset } from "./names.ts";

/** A TrackEd folder: files by their path below it, "WORLD\\X.SIT", any case. */
export interface TrackedFolder {
  read(path: string): Promise<Uint8Array | null>;
  /** Whether a file exists (for picking the clone's stem). */
  has(path: string): boolean;
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

/** Pod1PickCloneStem: the first free <base><n>, n = 2..999, the digits taken out of the stem's 20. */
export function pickCloneStem(base: string, taken: (stem: string) => boolean): string | null {
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const keep = Math.min(POD1_TRACK_STEM_MAX - suffix.length, base.length);
    if (keep < 1) return null;
    const cand = base.slice(0, keep) + suffix;
    if (!taken(cand)) return cand;
  }
  return null;
}

export async function cloneFromSit(folder: TrackedFolder, sitPath: string, assets: AssetSource, progress: (f: number, label: string) => void = () => {}): Promise<TrackDocument> {
  if (!/^WORLD\\/i.test(sitPath)) throw new CloneError(ERR.badRoot);
  const sitBytes = await folder.read(sitPath);
  if (!sitBytes) throw new CloneError(ERR.noFile);
  const lines = traxxLines(sitBytes);
  const lvlName = (lines[0] ?? "").toUpperCase();
  const base = lvlName.split(".")[0].slice(0, POD1_TRACK_STEM_MAX);
  if (!base) throw new CloneError(ERR.badSit);
  const prefix = pickCloneStem(base, (stem) => ["WORLD\\%.SIT", "WORLD\\%.SI2", "LEVELS\\%.LVL"].some((shape) => folder.has(shape.replace("%", stem))));
  if (!prefix) {
    throw new CloneError(`Can't find an unused name for the clone - everything from "${base}2" to "${base}999" is already in use. A track file name can be at most 20 characters, because LEVELS\\<name>.LVL has to fit the 31 a pod directory entry holds, so the number has to come out of the name itself. Rename or remove some of the existing copies.`);
  }

  const track = resetTrack();
  track.versionFlags |= MTM2_ONLY;
  track.prefix = prefix;
  const doc: TrackDocument = {
    track, textures: [], modelTextures: [], models: [], carry: emptyCarry(), prefixAuto: true, viewOnly: false,
    source: { kind: "clone", fileName: sitPath }, objectsShort: 0, objectsDropped: 0, groundBoxOverflow: 0,
    missingTextures: [], missingModels: [], warnings: [],
  };

  // The level: every file it needs, from DATA\.
  progress(0.05, "Reading the level");
  const lvlBytes = await folder.read(`LEVELS\\${lvlName}`);
  if (!lvlBytes) throw new CloneError(ERR.noLvl);
  const lvl = parseMtmLvl(lvlBytes);
  if (!lvl) throw new CloneError(ERR.noLvl);
  const data = (name: string) => folder.read(`DATA\\${name.toUpperCase()}`);
  const raw = await data(lvl.rawName);
  if (!raw) throw new CloneError(ERR.noRaw);
  track.heights.set(raw.subarray(0, CELLS));
  const [ra0, ra1, cl0] = await Promise.all(["RA0", "RA1", "CL0"].map((ext) => data(swapExt(lvl.rawName, ext))));
  if (!ra0 || !ra1 || !cl0) throw new CloneError(ERR.noGroundBox);
  readGroundBoxes(doc, lvl.rawName, ra0, ra1, cl0);
  const clr = await data(lvl.clrName);
  if (!clr) throw new CloneError(ERR.noClr);
  const n = Math.min(CELLS, clr.length >> 1);
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
  if (!lvl.lteName) throw new CloneError(ERR.noLte);
  const lte = await data(lvl.lteName);
  if (!lte) throw new CloneError(ERR.noLte);
  track.lte = new Uint8Array(CELLS * 7);
  track.lte.set(lte.subarray(0, CELLS * 7));
  if (lvl.waterHeight !== null) track.waterLevel4 = lvl.waterHeight;

  // The situation file, through the shared reader.
  const parsed = parseMtmSit(sitBytes, sitPath.slice(sitPath.lastIndexOf("\\") + 1));
  if (parsed.trackName === null) throw new CloneError(ERR.badSit);
  const sit = traxxSitFromParsed(parsed);
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
