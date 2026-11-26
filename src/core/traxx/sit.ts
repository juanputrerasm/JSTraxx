/*
  The .SIT as Traxx keeps it (Traxx 1.6.7, TrackPOD/TrackPODFile.cpp: CTrackPOD::ParseSITFile
  and WriteSITFile).

  OpenPhotex parses and writes the file (parseMtmSit, writeMtm2Sit). This module holds what is
  Traxx's own: the fields Traxx keeps, in Traxx's units, and the values and number format it
  writes, so a track saved here is the file Traxx would write.

  Traxx 1.7's 'F' fog block (a type 14 box's two lines after its '@' sound block) is not read or
  written by OpenPhotex yet: sitFogLines reads it out of the text by OpenPhotex's own record
  spans, and writeTraxxSit puts it into OpenPhotex's output where the 'L' block would go.

  Units (Include/TrackPOD.h): ipos x and y are half SIT units (2 per foot), with a 1/256-step
  fraction per axis on objects; ipos z is SIT height / 2 (one terrain step). A SIT triplet is
  (x, height, y). Object velocities are kept east, north, up.

  What Traxx writes with fixed values, so what a SIT loses on its first save:
    - the longitude/latitude, fly-by, announcer and description lines, and the race state;
    - the track length (the course's 5000);
    - each segment's ctype, cspeed_type, cdec_point, cspeed and lastentry (1,0 and 30,0,0), and
      every course_direction (0);
    - a modelled box's sizes (64, 64, 20).

  One deliberate difference: Traxx's View POD passes over the box sounds ("@sound effect
  entries"), which costs nothing there because a viewed POD is never saved. A POD imported
  here becomes an editable track, so the sounds are kept.
*/
import { parseMtmSit } from "../../vendor/openphotex/mtm/sit.js";
import type { MtmSit, SitBox, SitCourse, SitCourseSegment } from "../../vendor/openphotex/mtm/sit.js";
import { writeMtm2Sit } from "../../vendor/openphotex/mtm/write.js";
import type { Mtm2Sit, Mtm2SitCourseSegment, Mtm2SitTruck, SitTriple } from "../../vendor/openphotex/mtm/write.js";
import { cAtof, cAtoi, cFixed, cTrunc, f32 } from "./cformat.ts";

export const TRAXX_BOX_RAMP = 99;
export const TRAXX_BOX_CRUSH = 98;
export const TRAXX_BOX_CHECKPOINT = 6;
export const TRAXX_BOX_LIGHT = 12;
/** BOXTYPE_FOG (Traxx 1.7, Include/TrackPODBox.h): a fog volume, its properties in the .SIT 'F' block. */
export const TRAXX_BOX_FOG = 14;
/** MAXNPODFOGS: the tools' cap on fog objects = the engine's 64 fog slots, shared with waterfall mist (Traxx 1.8.0, 35b087b; was 50). */
export const TRAXX_MAX_FOGS = 64;
/** MAXNPODBOXES: ramps, boxes and top-crush cars share one array of this size. */
export const TRAXX_MAX_BOXES = 4096;
/**
  Track format version 6's placed objects (openmtm2.github.io/proposals/track-format-v6.md 14):
  16,384, four times MAXNPODBOXES. JSTraxx's own; a track that is not version 6 keeps Traxx's 4096.
*/
export const V6_MAX_BOXES = 16384;
export const TRAXX_EXT_COURSES = 4;
/** POD1_TRACK_STEM_MAX: the longest stem Traxx takes from the .LVL name. */
export const TRAXX_TRACK_STEM_MAX = 20;
const TRACKNAMELEN = 32;
const TRUCKNAMELEN = 20;
const BOXNAMELEN = 32;
const BOXSOUNDNAMELEN = 64;
/** sizeof(logo_bmp_name): POD1_NAME_MAX - 3 + 1. */
const UI_BMP_NAME_SIZE = 29;

/** A CP3 track light's authored properties (TrackBoxLight, Include/TrackPODBox.h). */
export interface TraxxLight {
  radius: number;
  heightOffset: number;
  r: number;
  g: number;
  b: number;
  glowMode: number;
  glowRadius: number;
  coneLength: number;
  coneRimRadius: number;
  coneBaseRadius: number;
  bright: number;
  aimOffset: number;
  /**
    allwx (Traxx 1.8.0, a114974): the engine's 13th 'L' field, 0 / 1. 1 = this light's glow and
    cone draw in every weather (stadium lights); the ground pool keeps the weather rule and glow
    mode 0 still draws nothing. LIGHTDEF_ALLWX 0, which an absent field means.
  */
  allWx: number;
}

const LIGHT_KEYS = ["radius", "heightOffset", "r", "g", "b", "glowMode", "glowRadius", "coneLength",
  "coneRimRadius", "coneBaseRadius", "bright", "aimOffset"] as const;

/** LIGHTDEF_*: the engine's defaults, which a type 12 box without an `L` block carries. */
export function traxxLightDefaults(): TraxxLight {
  return {
    radius: 64, heightOffset: 8, r: 1, g: 1, b: 1, glowMode: 0, glowRadius: 6,
    coneLength: 125, coneRimRadius: 10, coneBaseRadius: 3.5, bright: 1, aimOffset: 0, allWx: 0,
  };
}

/**
  A fog volume's authored properties (TrackBoxFog, Include/TrackPODBox.h), in the engine's
  field order. Every box carries one, as every box carries a light; only a Fog writes it out.
  Feet, colours 0..1, wmask one bit per weather (511 = all nine).
*/
export interface TraxxFog {
  w: number;
  l: number;
  h: number;
  base: number;
  vis: number;
  r: number;
  g: number;
  b: number;
  half: number;
  edge: number;
  top: number;
  maxop: number;
  wmask: number;
  round: number;
  wisp: number;
  wsize: number;
  wspeed: number;
  bot: number;
}

/** The 'F' data line's fields, in order (wmask is the one int). */
export const FOG_KEYS = ["w", "l", "h", "base", "vis", "r", "g", "b", "half", "edge", "top", "maxop", "wmask",
  "round", "wisp", "wsize", "wspeed", "bot"] as const;

/** FogDefaults: what a new object, or a box retyped to Fog, starts with (FOGDEF_*, round and wisp FOGNEW_*). */
export function traxxFogDefaults(): TraxxFog {
  return {
    w: 0, l: 0, h: 0, base: 0, vis: 300, r: f32(0.75), g: f32(0.78), b: f32(0.82), half: 8, edge: 20, top: 5, maxop: 1,
    wmask: 511, round: 1, wisp: 0.5, wsize: 40, wspeed: 3, bot: 0,
  };
}

/** FogEngineDefaults: what a missing field means to the engine, the rectangular wisp-free look. */
export function traxxFogEngineDefaults(): TraxxFog {
  return { ...traxxFogDefaults(), round: 0, wisp: 0, bot: 0 };
}

/** ClampFog: the Fog dialog's ranges, NaN-safe (a NaN lands on the low end). */
export function clampTraxxFog(fog: TraxxFog): void {
  const clamp = (key: Exclude<keyof TraxxFog, "wmask">, lo: number, hi: number) => {
    let v = fog[key];
    if (!(v >= lo)) v = lo;
    if (v > hi) v = hi;
    fog[key] = f32(v);
  };
  clamp("w", 0, 100000); clamp("l", 0, 100000); clamp("h", 0, 100000);
  clamp("base", -10000, 10000);
  clamp("vis", 1, 100000);
  clamp("r", 0, 1); clamp("g", 0, 1); clamp("b", 0, 1);
  clamp("half", 0, 100000); clamp("edge", 0, 100000); clamp("top", 0, 100000);
  clamp("maxop", 0, 1);
  clamp("round", 0, 1); clamp("wisp", 0, 1);
  clamp("wsize", 1, 100000); clamp("wspeed", 0, 100000);
  clamp("bot", 0, 100000);
}

/** A CTrackPODBox: a ramp (type 99), a box, or a top-crush car (type 98). */
export interface TraxxBox {
  type: number;
  flags: number;
  priority: number;
  /** x, y in half SIT units, z in terrain steps. */
  ipos: [number, number, number];
  /** xfraction, yfraction, zfraction: 1/256 of an ipos step, 0..255. */
  fraction: [number, number, number];
  theta: number;
  phi: number;
  psi: number;
  /** Sizes of a box or ramp without a model, as whole SIT units. */
  length: number;
  width: number;
  height: number;
  mass: number;
  /** East, north, up. */
  bvel: [number, number, number];
  p: number;
  q: number;
  r: number;
  /** The model (a top crush's base), "" for none. */
  modelName: string;
  /** A top crush's cab model, "" for none. */
  crushName: string;
  /** A top crush's cab offset from ipos, in SIT units: x, north, up. */
  crush: [number, number, number];
  soundImpact: string;
  soundCont: string;
  light: TraxxLight;
  /** Fog properties (Traxx 1.7): written to the .SIT for a type 14 box, and to a V12+ .TXX for every box. */
  fog: TraxxFog;
  /** Pass order among the checkpoints (type 6); 0 on every other box, as Traxx leaves it. */
  checkpointSeq: number;
  /** Traxx 1.8.2 (.TXX V21 cp_split): the checkpoint's split, CPX_SPLIT_NONE / ANY / LANE (race-types.ts); 0 on other boxes. */
  cpSplit: number;
  /** .TXX V21 cp_lane: 1 or 2 for a per-lane copy, else 0. */
  cpLane: number;
  /** height_above_gnd: kept in the .TXX, re-derived from the terrain when a track is opened. */
  heightAboveGround: number;
}

export function traxxBoxDefaults(): TraxxBox {
  return {
    type: 0, flags: 0, priority: 0, ipos: [8192, 8192, 100], fraction: [0, 0, 0],
    theta: 0, phi: 0, psi: 0, length: 64, width: 64, height: 20, mass: 0,
    bvel: [0, 0, 0], p: 0, q: 0, r: 0, modelName: "", crushName: "", crush: [0, 0, 0],
    soundImpact: "NULL.WAV", soundCont: "NULL.WAV", light: traxxLightDefaults(), fog: traxxFogDefaults(), checkpointSeq: 0,
    cpSplit: 0, cpLane: 0, heightAboveGround: 0,
  };
}

/** A CTrackPODTruck. Slot 0 is the "Your Truck" record, 1..8 the grid. */
export interface TraxxTruck {
  name: string;
  /** x, y in half SIT units, z in terrain steps. */
  ipos: [number, number, number];
  theta: number;
  phi: number;
  psi: number;
  /** The course this truck follows, 0..4. */
  course: number;
}

export function traxxTruckDefaults(): TraxxTruck {
  return { name: "", ipos: [8192, 8192, 100], theta: 0, phi: 0, psi: 0, course: 0 };
}

/** A TrackCourseSegment: one stored straight, in whole ipos steps. */
export interface TraxxCourseSegment {
  cstart: [number, number, number];
  cend: [number, number, number];
  speedLimit: number;
  trackWidth: number;
}

export interface TraxxArena {
  /** The arena's grid placement and footprint (the stadium's x, z, sx, sz). */
  x: number;
  y: number;
  sx: number;
  sy: number;
}

export interface TraxxSit {
  /** The track stem, from the .LVL name on line 0 ("" when the archive has no such .LVL). */
  prefix: string;
  trackName: string;
  localeName: string;
  /** The UI bitmap names Traxx preserves, without the UI\ folder ("" to derive one; see traxxUiBitmapName). */
  logoBmpName: string;
  mapBmpName: string;
  trackType: number;
  /** MTM2_ONLY: the track has the ambient/weather line. Writes that line and the MTM2 stadium form. */
  mtm2Only: boolean;
  ambientSound: number;
  weatherMask: number;
  /** CTrackPODCourse::track_length; Traxx never changes it from 5000. */
  trackLength: number;
  /** Nine trucks: slot 0 and the eight grid vehicles. */
  trucks: TraxxTruck[];
  /** Ramps, boxes and top-crush cars in Traxx's array order. */
  boxes: TraxxBox[];
  cylinderCount: number;
  /** The *** Cylinders *** records, verbatim, each line ending CRLF. */
  cylinderRaw: string;
  course: TraxxCourseSegment[];
  /** The four extended courses; null where the slot is empty. */
  extendedCourses: (TraxxCourseSegment[] | null)[];
  /** Set when the track is an arena: the backdrop model is then the stadium. */
  arena: TraxxArena | null;
  /** The backdrop (or stadium) model, "" for none. */
  backdropName: string;
  /** The backdrop block's other models, after the first (none for an arena). */
  extraBackdrops: string[];
  /** Records past the 4096-object array (sit_objects_dropped), or past a .SI3's 16,384. */
  objectsDropped: number;
  /** What the parser found that does not add up, such as a section declaring more records than it holds. */
  warnings: string[];
}

export function traxxSitDefaults(): TraxxSit {
  return {
    prefix: "", trackName: "", localeName: "", logoBmpName: "", mapBmpName: "",
    trackType: 0, mtm2Only: false, ambientSound: 0, weatherMask: 0, trackLength: 5000,
    trucks: Array.from({ length: 9 }, traxxTruckDefaults), boxes: [], cylinderCount: 0, cylinderRaw: "",
    course: [], extendedCourses: [null, null, null, null], arena: null, backdropName: "", extraBackdrops: [],
    objectsDropped: 0, warnings: [],
  };
}

/**
  Pod1SitToIpos: a SIT coordinate into an ipos step and its 1/256 fraction, wrapped into the world.
  `world` is the world's side in ipos: 16384 (256 cells), or 64 N for a track format version 6
  world of N cells (spec section 8.4: a negative position is wrapped by +W).
*/
export function traxxSitToIpos(sit: number, world = 16384): [number, number] {
  const scaled = 2 * sit;
  const whole = Math.floor(scaled);
  let i = whole | 0;
  let fraction = cTrunc((scaled - whole) * 256 + 0.5);
  if (fraction > 255) { fraction = 0; i++; }
  if (i < 0) i += world;
  return [i, fraction];
}

/** Pod1SignedSplit: any value into floor() and a 0..255 fraction, negatives included. */
export function traxxSignedSplit(value: number): [number, number] {
  const whole = Math.floor(value);
  let i = whole | 0;
  let fraction = cTrunc((value - whole) * 256 + 0.5);
  if (fraction > 255) { fraction = 0; i++; }
  return [i, fraction];
}

/** Pod1IposToSit. */
export function traxxIposToSit(ipos: number, fraction: number): number {
  return (ipos + fraction / 256) / 2;
}

/**
 * UIBitmapName: the name a preserved UI bitmap keeps, or `<stem>S.BMP` (logo) / `<stem>L.BMP`
 * (map) for a track that has none.
 */
export function traxxUiBitmapName(preserved: string, stem: string, suffix: "S" | "L"): string {
  return (preserved || `${stem}${suffix}.BMP`).slice(0, UI_BMP_NAME_SIZE - 1);
}

export interface ReadTraxxSitOptions {
  /**
   * Whether the archive holds an entry by this name (upper case; matched on the part after the
   * folder unless the name has one). Traxx takes the stem, preserves a UI bitmap name and
   * accepts an arena or backdrop only when the entry is there; for a UI bitmap, answer true
   * when its HD sibling is there as well. Without it, every entry exists.
   */
  hasEntry?: (name: string) => boolean;
  /**
   * The situation file itself, for the 'F' fog blocks OpenPhotex's reader does not keep
   * (ParseSITFile's trailing-block loop). Without it every Fog gets the engine's defaults.
   */
  text?: Uint8Array | string;
  /**
   * The world's cells a side: 256 (absent), or a .SI3 track's worldCells (track format version 6,
   * spec section 8.4). Negative positions are wrapped by the world's side; parse the SIT with
   * OpenPhotex's parseMtmSit(bytes, title, { worldFt: 32 * cells }) to match.
   */
  worldCells?: number;
  /** The objects kept, the rest counted in objectsDropped: TRAXX_MAX_BOXES (absent), or V6_MAX_BOXES for a .SI3. */
  maxBoxes?: number;
}

/** Read a .SIT into Traxx's model. */
export function readTraxxSit(bytes: Uint8Array | string, title = "", options: ReadTraxxSitOptions = {}): TraxxSit {
  return traxxSitFromParsed(parseMtmSit(bytes, title, { worldFt: 32 * (options.worldCells ?? 256) }), { text: bytes, ...options });
}

/** OpenPhotex's reading of a SIT, as Traxx keeps it. */
export function traxxSitFromParsed(parsed: MtmSit, options: ReadTraxxSitOptions = {}): TraxxSit {
  const hasEntry = options.hasEntry ?? (() => true);
  const world = 64 * (options.worldCells ?? 256);
  const sit = traxxSitDefaults();
  sit.warnings = [...parsed.warnings];

  const lvl = parsed.lvlName.replace(/\//g, "\\");
  if (hasEntry(lvl)) sit.prefix = lvl.split(".")[0].slice(0, TRAXX_TRACK_STEM_MAX);
  // Cut to Traxx's field, then trimmed as OpenPhotex trims what it reads, so a second trip keeps the same name.
  sit.trackName = fit(parsed.trackName ?? "", TRACKNAMELEN - 1);
  sit.localeName = fit(parsed.localeName ?? "", TRACKNAMELEN - 1);
  const uiName = (name: string | null) => {
    const upper = stripUiFolder(asciiUpper(name ?? ""));
    return upper && hasEntry(upper) ? upper.slice(0, UI_BMP_NAME_SIZE - 1) : "";
  };
  sit.logoBmpName = uiName(parsed.logoBmp);
  sit.mapBmpName = uiName(parsed.mapBmp);
  sit.trackType = parsed.trackTypeCode ?? 0;
  sit.mtm2Only = parsed.ambientSound !== null;
  sit.ambientSound = parsed.ambientSound ?? 0;
  sit.weatherMask = parsed.weatherMask ?? 0;

  // Slot 0 is the "Your Truck" record; the grid fills 1..8 and a ninth vehicle has nowhere to go.
  const grid = parsed.trucks.filter((t) => !t.playerSlot);
  const player = parsed.trucks.find((t) => t.playerSlot);
  const slots = [player ?? null, ...grid.slice(0, 8)];
  slots.forEach((source, slot) => {
    if (!source) return;
    const truck = sit.trucks[slot];
    const [x, height, y] = source.positionFt ?? [0, 0, 0];
    truck.name = fit(source.name, TRUCKNAMELEN - 1);
    truck.ipos = [traxxSitToIpos(x, world)[0], traxxSitToIpos(y, world)[0], cTrunc(cTrunc(height) / 2)];
    truck.theta = f32(source.theta);
    truck.phi = f32(source.phi);
    truck.psi = f32(source.psi);
    truck.course = slot === 0 ? 0 : (source.courseToFollow ?? 0);
  });

  // Ramps, boxes, then one record per top-crush car. Each box record's 'F' block, if any, is
  // read out of the text by the same record spans (only the Boxes section has them).
  const fog = options.text !== undefined ? sitFogLines(options.text) : null;
  parsed.boxes.forEach((source, i) => {
    if (source.type === TRAXX_BOX_CRUSH) return;
    const box = boxFrom(source, world);
    const lines = fog && i >= fog.ramps ? fog.boxes[i - fog.ramps] ?? [] : [];
    applyFogBlocks(box, lines);
    sit.boxes.push(box);
  });
  parsed.topCrush.forEach((car) => {
    const box = traxxBoxDefaults();
    const [cfx, cfz, cfy] = car.positionFt.map(f32);
    const [c2x, c2z, c2y] = car.position2Ft.map(f32);
    [box.ipos[0], box.fraction[0]] = traxxSitToIpos(cfx, world);
    [box.ipos[2], box.fraction[2]] = traxxSignedSplit(f32(cfz / 2));
    [box.ipos[1], box.fraction[1]] = traxxSitToIpos(cfy, world);
    box.crush = [f32(c2x - cfx), f32(c2y - cfy), f32(c2z - cfz)];
    box.theta = f32(car.theta); box.phi = f32(car.phi); box.psi = f32(car.psi);
    box.modelName = modelName(car.modelName);
    box.crushName = modelName(car.cabModelName);
    box.mass = f32(car.mass);
    box.bvel = [f32(car.bvel[0]), f32(car.bvel[2]), f32(car.bvel[1])];
    [box.p, box.q, box.r] = car.rates.map(f32);
    box.type = TRAXX_BOX_CRUSH;
    sit.boxes.push(box);
  });
  const maxBoxes = options.maxBoxes ?? TRAXX_MAX_BOXES;
  if (sit.boxes.length > maxBoxes) {
    sit.objectsDropped = sit.boxes.length - maxBoxes;
    sit.boxes.length = maxBoxes;
  }

  if (parsed.cylinders) {
    sit.cylinderCount = parsed.cylinders.count;
    sit.cylinderRaw = parsed.cylinders.lines.map((line) => `${line}\r\n`).join("");
  }

  sit.course = parsed.primaryCourse?.segments.map((seg) => segmentFrom(seg, world)) ?? [];
  parsed.extendedCourses.forEach((course: SitCourse, i) => {
    const slot = course.slot ?? i;
    if (slot < TRAXX_EXT_COURSES && course.segments.length) sit.extendedCourses[slot] = course.segments.map((seg) => segmentFrom(seg, world));
  });

  if (parsed.arena && hasEntry(parsed.arena.modelName)) {
    const { x, y, sx, sy } = parsed.arena.placed ? parsed.arena : { x: 127, y: 127, sx: 18, sy: 18 };
    sit.arena = { x, y, sx, sy };
    sit.backdropName = parsed.arena.modelName;
  } else {
    // Traxx takes the first, when its model is there. The rest are kept by name, found or not,
    // so the block goes back out as it came in.
    const [backdrop, ...more] = parsed.backdropModelNames ?? [];
    if (backdrop && hasEntry(backdrop)) sit.backdropName = backdrop;
    if (sit.backdropName) sit.extraBackdrops = more.filter((n) => n.trim() !== "" && n.toLowerCase() !== "none");
  }
  return sit;
}

function boxFrom(source: SitBox, world = 16384): TraxxBox {
  const box = traxxBoxDefaults();
  const [x, height, y] = source.positionFt ?? [0, 0, 0];
  [box.ipos[0], box.fraction[0]] = traxxSitToIpos(x, world);
  [box.ipos[2], box.fraction[2]] = traxxSignedSplit(f32(f32(height) / 2));
  [box.ipos[1], box.fraction[1]] = traxxSitToIpos(y, world);
  box.theta = f32(source.theta); box.phi = f32(source.phi); box.psi = f32(source.psi);
  box.modelName = modelName(source.modelName);
  if (!box.modelName && source.sizeFt) [box.length, box.width, box.height] = source.sizeFt.map(cTrunc);
  box.mass = f32(source.mass);
  const bvel = source.bvel ?? [0, 0, 0];
  box.bvel = [f32(bvel[0]), f32(bvel[2]), f32(bvel[1])];
  [box.p, box.q, box.r] = (source.rates ?? [0, 0, 0]).map(f32);
  box.type = source.type;
  if (source.type !== TRAXX_BOX_RAMP) {
    box.flags = source.flags;
    box.priority = source.priority ?? 0;
    if (source.type === TRAXX_BOX_CHECKPOINT) box.checkpointSeq = Math.max(0, source.checkpointSequence);
    box.soundImpact = (source.hitSound ?? "NULL.WAV").slice(0, BOXSOUNDNAMELEN - 1);
    box.soundCont = (source.loopSound ?? "NULL.WAV").slice(0, BOXSOUNDNAMELEN - 1);
    // Fields in order until the line runs out; the rest keep the engine's defaults.
    source.lightFields?.slice(0, LIGHT_KEYS.length).forEach((value, i) => {
      const key = LIGHT_KEYS[i];
      box.light[key] = key === "glowMode" ? cTrunc(value) : f32(value);
    });
    // ParseSITFile / CloneFromSIT (Traxx 1.8.0): the thirteenth field, atoi(...) != 0; absent = LIGHTDEF_ALLWX.
    const allWx = source.lightFields?.[LIGHT_KEYS.length];
    if (allWx !== undefined) box.light.allWx = cTrunc(allWx) !== 0 ? 1 : 0;
  }
  return box;
}

/** The text one byte per character, so a writer's output can be edited and put back unchanged. */
function byteText(input: Uint8Array | string): string {
  if (typeof input === "string") return input;
  let out = "";
  for (let i = 0; i < input.length; i += 8192) out += String.fromCharCode(...input.subarray(i, i + 8192));
  return out;
}

/** The record spans OpenPhotex reads a section by: count, then records opened by "********" lines. */
function sectionRecords(lines: readonly string[], header: string): { start: number; end: number }[] {
  const section = lines.indexOf(header);
  if (section < 0 || section + 1 >= lines.length) return [];
  const count = cAtoi(lines[section + 1]);
  let sectionEnd = section + 2;
  while (sectionEnd < lines.length && !/^\*\*\* \S/.test(lines[sectionEnd])) sectionEnd++;
  let present = 0;
  for (let i = section + 2; i < sectionEnd; i++) if (lines[i].startsWith("********")) present++;
  const next = (from: number) => { for (let i = Math.max(0, from); i < lines.length; i++) if (lines[i].startsWith("********")) return i; return -1; };
  const out: { start: number; end: number }[] = [];
  let cursor = section + 2;
  for (let i = 0; i < Math.min(count, present); i++) {
    cursor = next(cursor);
    if (cursor < 0) break;
    const end = next(cursor + 1);
    out.push({ start: cursor, end: end >= 0 ? end : lines.length });
    cursor++;
  }
  return out;
}

/**
  ParseSITFile's trailing blocks: after a box's priority value, every line up to the next one
  starting with '*'; a line starting "Ffog" is followed by its data line. For each Boxes record,
  the data lines of its 'F' blocks in order (a hand edit can have two; the later one wins), and
  how many Ramps records come before the boxes in OpenPhotex's list.
*/
export function sitFogLines(input: Uint8Array | string): { ramps: number; boxes: string[][] } {
  const lines = byteText(input).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const ramps = sectionRecords(lines, "*** Ramps ***").length;
  const boxes = sectionRecords(lines, "*** Boxes ***").map(({ start, end }) => {
    const out: string[] = [];
    let i = start + 1;
    while (i < end && !lines[i].startsWith("priority")) i++;
    for (i += 2; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("*")) break;
      if (line.startsWith("Ffog")) { out.push(lines[i + 1] ?? ""); i++; }
    }
    return out;
  });
  return { ramps, boxes };
}

/**
  The fog part of ParseSITFile for one box: a Fog starts from the engine's defaults; an 'F'
  block on any other box (a hand edit) also resets to them first. Fields are read tolerantly, in
  order, until the line runs out of commas; a model-less Fog takes a positive w, l, h back as its
  own size. Every box is clamped afterwards (ClampFog).
*/
export function applyFogBlocks(box: TraxxBox, dataLines: readonly string[]): void {
  if (box.type === TRAXX_BOX_FOG) box.fog = traxxFogEngineDefaults();
  for (const line of dataLines) {
    if (box.type !== TRAXX_BOX_FOG) box.fog = traxxFogEngineDefaults();
    const fields = line.split(",");
    const fog = box.fog;
    for (let k = 0; k < fields.length && k < FOG_KEYS.length; k++) {
      const key = FOG_KEYS[k];
      if (key === "wmask") fog.wmask = cAtoi(fields[k]);
      else fog[key] = f32(cAtof(fields[k]));
      if (k === 2 && box.type === TRAXX_BOX_FOG && !box.modelName && fog.w > 0 && fog.l > 0 && fog.h > 0) {
        box.width = cTrunc(f32(fog.w + 0.5));
        box.length = cTrunc(f32(fog.l + 0.5));
        box.height = cTrunc(f32(fog.h + 0.5));
      }
    }
  }
  clampTraxxFog(box.fog);
}

/**
  WriteSITFile's 'F' block, for a Fog only, where the 'L' block would go (right after the '@'
  sound block): the header, then twelve %f, the weather mask %d and five %f. A model-less Fog
  writes its own width, length and height as w, l, h.
*/
export function traxxFogLines(box: TraxxBox): [string, string] {
  const fog = box.fog;
  const model = box.modelName !== "";
  const values = FOG_KEYS.map((key) => {
    if (key === "wmask") return String(fog.wmask | 0);
    if (!model && key === "w") return float(box.width);
    if (!model && key === "l") return float(box.length);
    if (!model && key === "h") return float(box.height);
    return float(fog[key]);
  });
  return ["Ffog w,l,h,base,vis,r,g,b,half,edge,top,maxOp,wmask,round,wisp,wsize,wspd,bot", values.join(",")];
}

/** The 'F' blocks put into OpenPhotex's output: after the k-th box's "@sound effect entries" and its three lines. */
function insertFogBlocks(bytes: Uint8Array, boxes: readonly TraxxBox[]): Uint8Array {
  if (!boxes.some((b) => b.type === TRAXX_BOX_FOG)) return bytes;
  const lines = byteText(bytes).split("\r\n");
  let at = lines.indexOf("*** Boxes ***");
  if (at < 0) return bytes;
  const out = lines.slice(0, at);
  for (const box of boxes) {
    const sound = lines.indexOf("@sound effect entries", at);
    if (sound < 0) break;
    out.push(...lines.slice(at, sound + 4));
    at = sound + 4;
    if (box.type === TRAXX_BOX_FOG) out.push(...traxxFogLines(box));
  }
  out.push(...lines.slice(at));
  const text = out.join("\r\n");
  const result = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) result[i] = text.charCodeAt(i);
  return result;
}

function segmentFrom(source: SitCourseSegment, world = 16384): TraxxCourseSegment {
  const point = ([x, height, y]: [number, number, number]): [number, number, number] =>
    [traxxSitToIpos(x, world)[0], traxxSitToIpos(y, world)[0], cTrunc(cTrunc(height) / 2)];
  return {
    cstart: point(source.startFt), cend: point(source.endFt),
    speedLimit: cTrunc(source.speedLimit), trackWidth: cTrunc(source.trackWidth),
  };
}

/** Model names upper case, as Traxx keeps them, and within its 31 characters. */
function modelName(name: string): string {
  return asciiUpper(name).replace(/\//g, "\\").slice(0, BOXNAMELEN - 1);
}

export interface WriteTraxxSitOptions {
  /**
   * The name for the "Track Map .BMP file" line in place of the derived one: Traxx writes the
   * map bitmap's own contents there when the track uses a stock icon (its buffer then holds the
   * icon's name rather than a BMP).
   */
  stockMapIcon?: string;
}

/** Write a .SIT exactly as Traxx's WriteSITFile does. */
export function writeTraxxSit(sit: TraxxSit, options: WriteTraxxSitOptions = {}): Uint8Array {
  // OpenPhotex writes the 'L' block; the 'F' block is put in after it, in the same place.
  const boxes = sit.boxes.filter((b) => b.type !== TRAXX_BOX_RAMP && b.type !== TRAXX_BOX_CRUSH);
  return insertFogBlocks(writeMtm2Sit(traxxSitToMtm2(sit, options)), boxes);
}

/** Traxx's model as OpenPhotex's SIT writer takes it, with every value in Traxx's format. */
export function traxxSitToMtm2(sit: TraxxSit, options: WriteTraxxSitOptions = {}): Mtm2Sit {
  const trucks = Array.from({ length: 9 }, (_, i) => sit.trucks[i] ?? traxxTruckDefaults());
  const truck = (t: TraxxTruck, course: number): Mtm2SitTruck => ({
    truckFile: t.name,
    position: triple(f32(t.ipos[0]) / 2, 2 * f32(t.ipos[2]), f32(t.ipos[1]) / 2),
    orient: triple(t.theta, t.phi, t.psi),
    courseToFollow: course,
  });
  const position = (box: TraxxBox) => triple(
    traxxIposToSit(box.ipos[0], box.fraction[0]), objectHeight(box), traxxIposToSit(box.ipos[1], box.fraction[1]));
  const shape = (box: TraxxBox) => (box.modelName
    ? { modelName: shortName(box.modelName) }
    : { extents: triple(box.length, box.width, box.height) });
  const motion = (box: TraxxBox) => ({
    mass: float(box.mass), bvel: triple(box.bvel[0], box.bvel[2], box.bvel[1]), rates: triple(box.p, box.q, box.r),
  });
  const segments = (course: readonly TraxxCourseSegment[]): Mtm2SitCourseSegment[] => course.map((seg) => ({
    types: "1,0",
    start: triple(f32(seg.cstart[0]) / 2, 2 * f32(seg.cstart[2]), f32(seg.cstart[1]) / 2),
    end: triple(f32(seg.cend[0]) / 2, 2 * f32(seg.cend[2]), f32(seg.cend[1]) / 2),
    speeds: "30.000000,0.000000,0",
    speedLimit: float(seg.speedLimit), trackWidth: float(seg.trackWidth),
  }));
  const arena = sit.arena && sit.backdropName ? sit.arena : null;

  return {
    lvlName: `${sit.prefix}.lvl`, trackName: sit.trackName, localeName: sit.localeName, longitudeLatitude: "7947984,7947988",
    pictureBmp: traxxUiBitmapName(sit.logoBmpName, sit.prefix, "S"),
    iconBmp: options.stockMapIcon ?? traxxUiBitmapName(sit.mapBmpName, sit.prefix, "L"),
    flyByAvi: "Sonic", announcerWav: "Track", descriptionTxt: "0,0", raceType: sit.trackType, redbookTrack: 2,
    ambientLine: sit.mtm2Only, ambientSound: sit.ambientSound, trackLength: float(sit.trackLength), weatherMask: sit.weatherMask,
    raceTimes: "0.000000,0.000000,0.000000",
    yourTruck: truck(trucks[0], 0),
    vehicles: trucks.slice(1).map((t) => truck(t, t.course)),
    ramps: sit.boxes.filter((b) => b.type === TRAXX_BOX_RAMP).map((b) => ({
      position: position(b), orient: triple(b.theta, b.phi, b.psi), ...shape(b), ...motion(b),
    })),
    boxes: sit.boxes.filter((b) => b.type !== TRAXX_BOX_RAMP && b.type !== TRAXX_BOX_CRUSH).map((b) => ({
      position: position(b), orient: triple(b.theta, b.phi, b.psi), ...shape(b), ...motion(b),
      type: b.type, flags: b.flags, priority: b.priority, hitSound: b.soundImpact, loopSound: b.soundCont,
      light: b.type === TRAXX_BOX_LIGHT
        // WriteSITFile (Traxx 1.8.0): always the 13-field line, "%d" for allwx ? 1 : 0, so OpenPhotex
        // writes the engine's 78-character SIT_LIGHT_HEADER.
        ? [...LIGHT_KEYS.map((key) => (key === "glowMode" ? String(cTrunc(b.light[key])) : float(b.light[key]))),
          b.light.allWx ? "1" : "0"]
        : undefined,
    })),
    cylinders: { count: sit.cylinderCount, lines: sit.cylinderRaw ? sit.cylinderRaw.replace(/\r\n$/, "").split("\r\n") : [] },
    topCrush: sit.boxes.filter((b) => b.type === TRAXX_BOX_CRUSH).map((b) => {
      const fx = f32(traxxIposToSit(b.ipos[0], b.fraction[0]));
      const fy = f32(traxxIposToSit(b.ipos[1], b.fraction[1]));
      const fz = objectHeight(b);
      return {
        position: triple(fx, fz, fy),
        position2: triple(f32(fx + f32(b.crush[0])), f32(fz + f32(b.crush[2])), f32(fy + f32(b.crush[1]))),
        orient: triple(b.theta, b.phi, b.psi),
        modelName: b.modelName ? shortName(b.modelName) : "NULL", cabModelName: b.crushName ? shortName(b.crushName) : "NULL",
        ...motion(b),
      };
    }),
    course: segments(sit.course),
    extendedCourses: sit.extendedCourses.slice(0, TRAXX_EXT_COURSES).map((c) => (c ? segments(c) : null)),
    stadium: arena
      ? { placed: sit.mtm2Only, flag: 1, x: arena.x, z: arena.y, sx: arena.sx, sz: arena.sy, modelName: sit.backdropName }
      : undefined,
    backdrop: { modelNames: !arena && sit.backdropName ? [sit.backdropName, ...sit.extraBackdrops] : [] },
  };
}

/** fz = 2.0f*(float)ipos[2] + (float)zfraction/128.0f, in float arithmetic. */
function objectHeight(box: TraxxBox): number {
  return f32(f32(2 * f32(box.ipos[2])) + f32(f32(box.fraction[2]) / 128));
}

/** "%.6f" of a C float. */
function float(value: number): string {
  return cFixed(f32(value));
}

/** FLOAT_TRIPLET_FORMAT, "%.6f,%.6f,%.6f", of three floats. */
function triple(a: number, b: number, c: number): SitTriple {
  return [float(a), float(b), float(c)];
}

/** The .SIT names a model without its folder. */
function shortName(name: string): string {
  const slash = name.search(/[\\/]/);
  return slash >= 0 ? name.slice(slash + 1) : name;
}

function stripUiFolder(name: string): string {
  return /^UI[\\/]/.test(name) ? name.slice(3) : name;
}

/** A name cut to a fixed C field, without the trailing blanks a reader would trim. */
function fit(name: string, length: number): string {
  return name.slice(0, length).trimEnd();
}

/** _strupr in the C locale: ASCII letters only. */
function asciiUpper(text: string): string {
  return text.replace(/[a-z]+/g, (s) => s.toUpperCase());
}
