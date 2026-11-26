/*
  The Write POD pre-flight, its pure half (Traxx 1.8.0: 3a51350, 13507dc, 66f5784, c40b430;
  Traxx/PodPreflight.h/.cpp). Everything the game engine will silently drop, overflow or crash
  on. The game shows its players no load warnings at all, so this list is the only warning an
  author gets. Engine 8071a7e keeps the first N of most caps and skips the rest; older engines
  overflow or crash there; every check keeps its level for both.

  ERROR = the engine (or an older one) crashes, exits, overflows memory, or drops content.
  WARN = content is silently dropped or clamped.

  Pure: plain inputs (PfInput) in, a list out. preflight-gather.ts fills the input from a
  document; the Write POD command shows the list. Also here: the engine's 64 shared fog slots
  (EngineFog.cpp EngineFogSlotOverflow), which the Waterfall window and View > Statistics share.

  Traxx origin/main (1.8.2-beta): the race rules (CheckRaceRules, CheckWalls, CheckLeadIns), the engine's 100
  checkpoints (603e219; slots with the rules on, boxes with them off) and the more-than-20 warning (bb921f2), and a
  version 6 track's 16,384 objects (1c882a4). No looped-course distance check (removed upstream, 22d3ec6).
*/
import { cpxRankSlots, cpxSortForExport, cpxValidate } from "./race-rules.ts";
import { RACERULES_DRAG, RACERULES_NONE, RACERULES_PARALLEL } from "./race-types.ts";
import { WALL_MAX_EXPORT_POINTS, WALL_MAX_EXPORT_TOTAL } from "./walls.ts";

export const PF_WARN = 1;
export const PF_ERROR = 2;
const PF_TEXTLEN = 480;
export const PF_MAXITEMS = 96;

/* The limits, from section 5 of the engine handover. */
export const PF_MAX_RAMPS = 100;
/** Engine MAX_CHECKPOINTS (core\\sim.h, 603e219); it was 20. */
export const PF_MAX_CHECKPOINTS = 100;
/** Retail MTM2 and builds before 603e219 hold 20; more is exported as .SI2 and warned. */
export const PF_RETAIL_CHECKPOINTS = 20;
export const PF_MAX_MOVERS = 103;
export const PF_MAX_CRUSH = 100;
export const PF_MAX_LIGHTS = 128;
export const PF_LIGHT_RAD_MIN = 1.0;
export const PF_LIGHT_RAD_MAX = 4095.0;
export const PF_MAX_SCENERY = 4608;
export const PF_SAFE_SCENERY = 4509;
/** A version 6 track (.SI3): MAX_PLACED_BOXES_V6, with 4096 slots of ground-box headroom (MAX_BOX_LIST 20480). */
export const PF_MAX_SCENERY_V6 = 16384;
export const PF_SAFE_SCENERY_V6 = 16384;
/** Race rules walls: one authored stretch longer than this is refused. */
export const PF_WALL_MAX_STRETCH_FT = 4096;
/** Race rules: the engine credits a crossing only when the front wheel hub (~3 ft up) is inside the box's height band. */
export const PF_MIN_CHECKPOINT_HEIGHT_FT = 8;
export const PF_MAX_LOOPSOUNDS = 30;
export const PF_MAX_COURSES = 5;
export const PF_MAX_SEGMENTS = 249;
export const PF_MAX_MODELNAME = 62;
export const PF_MAX_WAVNAME = 63;
export const PF_MAX_MENUNAME = 78;
export const PF_MAX_LVLTOKEN = 39;
export const PF_MAX_TEX = 4096;
export const PF_MAX_STEM = 18;
export const PF_POD_ENTRY = 31;
export const PF_HD_MAX = 2048;
export const PF_HD_TRUECOLOUR_MIN = 128;
export const PF_MASK_MAX = 16384;
export const PF_ANI_MAX_ENTRIES = 64;
export const PF_ANI_MAX_FRAMES = 8;
export const PF_ANI_MAX_NAME = 15;

export const PF_BOX_CHECKPOINT = 6;
export const PF_BOX_TRAIN = 10;
export const PF_BOX_LIGHT = 12;
export const PF_BOX_MOVING = 13;
export const PF_BOX_FOG = 14;
export const PF_BOX_CRUSH = 98;
export const PF_BOX_RAMP = 99;

export const PF_HD_NONE = 0;
export const PF_HD_OK = 1;
export const PF_HD_NOHEADER = 2;
export const PF_HD_NOBODY = 3;

/** ENGINEFOG_SLOTS: 64 fog volumes per track, fog boxes first, then waterfall mist. */
export const ENGINEFOG_SLOTS = 64;

export interface PfBox {
  /** 1-based slot number, as the author counts them. */
  index: number;
  type: number;
  /** The model's name without its folder, or null for a model-less box. */
  model: string | null;
  sndImpact: string | null;
  sndCont: string | null;
  /** The 'L' block's rad (lights only). */
  lightRad: number;
  /** PF_BOX_CHECKPOINT only: checkpoint_seq, cp_split, cp_lane (race rules). */
  seq?: number;
  split?: number;
  lane?: number;
  /** The box uses a model (its height is the model's, which Traxx does not know). */
  hasModel?: boolean;
  /** The "length,width,height" height WriteSITFile prints, in feet (model-less boxes). */
  heightFt?: number;
}

/** One authored wall, as the .CPX export will see it (PfWall). */
export interface PfWall {
  name: string;
  /** Authored points. */
  npoints: number;
  closed: boolean;
  /** 1/256 ft. */
  thickness: number;
  height: number;
  /** Points CTrackPODWalls::Export makes on a flat ground: 0 under 2 points, -1 over the per-wall cap. */
  exportCount: number;
  /** The longest straight distance from one authored point to the next (closing stretch too). */
  maxStretchFt: number;
  /** An exported point is outside 0..N*32 ft (ExportOutOfWorld). */
  outOfWorld: boolean;
}

export interface PfTex {
  /** The pod name, e.g. ART\GRASS.RAW. */
  name: string;
  w: number;
  h: number;
  /** The ground type; non-zero means a .TTY line. */
  type: number;
  hdstate: number;
  hdw: number;
  hdh: number;
  /** The .RAW + .ACT pair goes into the pod. */
  legacyWritten: boolean;
  /** A model texture (a missing one falls back to RUSTPLAT.RAW); else a terrain texture. */
  model: boolean;
}

export interface PfAni {
  period: number;
  nframes: number;
  /** The longest frame name, extension included. */
  longestName: number;
  /** The first frame's name, for the message. */
  name: string | null;
}

export interface PfMap {
  suffix: string;
  /** Length of the extension with its dot (".PNG" = 4). */
  extlen: number;
  dimsKnown: boolean;
  w: number;
  h: number;
}

export interface PfInput {
  stem: string | null;
  trackName: string | null;
  box: readonly PfBox[];
  /** RACERULES_*: non-zero counts checkpoint slots, not boxes. Absent: none. */
  raceRules?: number;
  /** The track's walls; they reach the pod only with drag or Parallel rules on. */
  wall?: readonly PfWall[];
  /** The world size N (256 or 512) for the wall text; absent = 256. */
  worldCells?: number;
  /** A version 6 track (.SI3): the scenery cap is PF_*_SCENERY_V6. */
  isV6?: boolean;
  /** Per course: the Lane (1 or 2) it is a lead-in for, 0 = not a lead-in. */
  leadinLane?: readonly number[];
  /** Segments in the main course and the four extended ones. */
  nCourseSeg: readonly number[];
  /** Waterfalls with a sound (PodPreflightFallHasSound). */
  nFallSounds: number;
  /** An arena: the engine adds a looping crowd.wav. */
  stadium: boolean;
  /** Per waterfall in file order: the mist volumes it registers (MistLandings), or null. */
  mistLandings: readonly number[] | null;
  weatherWritten: boolean;
  weatherMask: number;
  bgmChecked: boolean;
  /** The BGM name when the music is a stock one, else null. */
  stockBgm: string | null;
  /** The .TEX count: highest slot + 1. */
  texCount: number;
  tex: readonly PfTex[];
  ani: readonly PfAni[];
  map: readonly PfMap[];
}

export interface PfItem { level: number; text: string }

export interface PfList {
  /** Items held, errors first. */
  item: PfItem[];
  /** Found, including any that did not fit. */
  nerr: number;
  nwarn: number;
  /** Found but past PF_MAXITEMS. */
  dropped: number;
}

/** An empty PfInput (a clean track says nothing). */
export function pfEmptyInput(): PfInput {
  return {
    stem: null, trackName: null, box: [], nCourseSeg: [0, 0, 0, 0, 0], nFallSounds: 0, stadium: false, mistLandings: null,
    weatherWritten: false, weatherMask: 0, bgmChecked: false, stockBgm: null, texCount: 0, tex: [], ani: [], map: [],
  };
}

function add(l: PfList, level: number, text: string): void {
  if (level === PF_ERROR) l.nerr++; else l.nwarn++;
  if (l.item.length >= PF_MAXITEMS) { l.dropped++; return; }
  l.item.push({ level, text: text.slice(0, PF_TEXTLEN - 1) });
}

/* A run of names that share one verdict, said once: "A, B, C and 12 more". */
const AGG_SHOW = 4;
const AGG_NAMELEN = 48;
const AGG_TEXTCAP = AGG_SHOW * (AGG_NAMELEN + 2) + 32;

class Agg {
  n = 0;
  name: string[] = [];
  add(name: string | null): void {
    if (this.n < AGG_SHOW) this.name.push((name ?? "?").slice(0, AGG_NAMELEN - 1));
    this.n++;
  }
  text(): string {
    const shown = Math.min(this.n, AGG_SHOW);
    let out = "";
    for (let i = 0; i < shown; i++) {
      out += `${i > 0 ? ", " : ""}${this.name[i]}`;
      if (out.length >= AGG_TEXTCAP - 1) break;
    }
    if (this.n > shown && out.length < AGG_TEXTCAP - 24) out += ` and ${this.n - shown} more`;
    return out.slice(0, AGG_TEXTCAP - 1);
  }
}

/** "%.0f" of a C float. */
const f0 = (v: number) => String(Math.round(v));

/** "Object #12 (BARREL.BIN)": the way the author counts the boxes. */
function boxLabel(b: PfBox): string {
  return b.model ? `Object #${b.index} (${b.model.slice(0, 40)})` : `Object #${b.index}`;
}

function hasSound(s: string | null): boolean {
  return Boolean(s) && s!.toUpperCase() !== "NULL.WAV";
}

/* .SIT, section 5.1. */
function checkBoxes(inp: PfInput, out: PfList): void {
  let nramps = 0, ncheck = 0, nchecktype = 0, nmovers = 0, ncrush = 0, nlights = 0, nscenery = 0, nloop = 0;
  const lowrad = new Agg(), highrad = new Agg(), longmodel = new Agg(), longwav = new Agg();
  for (const b of inp.box) {
    const label = boxLabel(b);
    if (b.type === PF_BOX_RAMP) nramps++;
    else if (b.type === PF_BOX_CRUSH) ncrush++;
    else nscenery++;
    if (b.type === PF_BOX_CHECKPOINT) { ncheck++; nchecktype++; }
    if (b.type === PF_BOX_TRAIN || b.type === PF_BOX_MOVING) nmovers++;
    if (b.type === PF_BOX_LIGHT) {
      nlights++;
      const rad = Math.fround(b.lightRad);
      if (rad < PF_LIGHT_RAD_MIN) lowrad.add(label);
      else if (rad > PF_LIGHT_RAD_MAX) highrad.add(label);
    }
    if (b.model && b.model.length > PF_MAX_MODELNAME) longmodel.add(label);
    if ((b.sndImpact && b.sndImpact.length > PF_MAX_WAVNAME) || (b.sndCont && b.sndCont.length > PF_MAX_WAVNAME)) longwav.add(label);
    if (hasSound(b.sndCont) && b.type !== PF_BOX_RAMP && b.type !== PF_BOX_CRUSH) nloop++;
  }
  if (nramps > PF_MAX_RAMPS) {
    add(out, PF_ERROR, `Ramps: ${nramps}, the most the game can hold is ${PF_MAX_RAMPS}. `
      + `The game keeps the first ${PF_MAX_RAMPS} and ignores the rest (older game versions overrun their ramp list).`);
  }
  // With race rules on, the engine's list holds one entry per checkpoint (slot), however many boxes copy it.
  if ((inp.raceRules ?? RACERULES_NONE) !== RACERULES_NONE) {
    const cin = raceBoxes(inp);
    ncheck = cin.length > 0 ? cpxRankSlots(cin.map((c) => c.cin)).count : 0;
  }
  // Checkpoints: the engine holds MAX_CHECKPOINTS (100) and quits on load past that ("Too many checkpoints").
  if (ncheck > PF_MAX_CHECKPOINTS) {
    add(out, PF_ERROR, `Checkpoints: ${ncheck}, the most the game can hold is ${PF_MAX_CHECKPOINTS}. `
      + "The game refuses the next one and quits on load with \"Too many checkpoints\" (older game versions "
      + `hold only ${PF_RETAIL_CHECKPOINTS}, and first write the 21st past the end of their list and overrun memory).`);
  }
  // More than the 20 retail holds, boxes counted (copies too): Write POD makes it a .SI2 so retail never lists it.
  if (nchecktype > PF_RETAIL_CHECKPOINTS) {
    add(out, PF_WARN, `This track has ${nchecktype} checkpoint boxes (more than ${PF_RETAIL_CHECKPOINTS}). Only new builds can load it: `
      + "retail MTM2 won't list it, older community builds refuse it, and builds before 2026-11-15 "
      + "may crash on it.");
  }
  if (nmovers > PF_MAX_MOVERS) {
    add(out, PF_ERROR, `Moving objects (Train and Moving): ${nmovers}, the most the game can hold is ${PF_MAX_MOVERS}. `
      + "Past that the game quits on load with \"Too many trains\".");
  }
  // A v6 track keeps 16384 and its box list has 4096 slots of headroom.
  if (inp.isV6) {
    if (nscenery > PF_SAFE_SCENERY_V6) {
      add(out, PF_ERROR, `Objects: ${nscenery} (ramps and top-crush not counted). A version 6 track holds ${PF_MAX_SCENERY_V6} objects; the `
        + `game keeps the first ${PF_MAX_SCENERY_V6} and drops the rest. Stay at ${PF_SAFE_SCENERY_V6} or fewer.`);
    }
  } else if (nscenery > PF_SAFE_SCENERY) {
    add(out, PF_ERROR, `Objects: ${nscenery} (ramps and top-crush not counted). The game keeps the first ${PF_MAX_SCENERY} and drops `
      + `the rest, and about 99 more ground boxes are added every frame, so from ${PF_SAFE_SCENERY + 1} up it can quit mid-race `
      + `with "Have mark increase box count". Stay at ${PF_SAFE_SCENERY} or fewer.`);
  }
  if (ncrush > PF_MAX_CRUSH) add(out, PF_WARN, `Top-crush objects: ${ncrush}. The game keeps the first ${PF_MAX_CRUSH} and drops the rest.`);
  if (nlights > PF_MAX_LIGHTS) add(out, PF_WARN, `Lights: ${nlights}. The game keeps ${PF_MAX_LIGHTS} and drops the rest.`);
  if (lowrad.n > 0) {
    add(out, PF_ERROR, `Light radius under ${f0(PF_LIGHT_RAD_MIN)} ft: ${lowrad.text()}. The game reads the radius as a whole number `
      + "with no lower limit. The game now gives such a light no pool (older game versions divide by it).");
  }
  if (highrad.n > 0) {
    add(out, PF_WARN, `Light radius over ${f0(PF_LIGHT_RAD_MAX)} ft: ${highrad.text()}. The game clamps it to ${f0(PF_LIGHT_RAD_MAX)}.`);
  }
  if (longmodel.n > 0) {
    add(out, PF_ERROR, `Model name over ${PF_MAX_MODELNAME} characters: ${longmodel.text()}. The game reads ${PF_MAX_MODELNAME + 1}, leaves the rest in the file `
      + "and every later field of the situation file is read out of step.");
  }
  if (longwav.n > 0) {
    add(out, PF_ERROR, `Sound file name over ${PF_MAX_WAVNAME} characters: ${longwav.text()}. The game cuts it to fit its 80 byte `
      + "buffer (older game versions overrun that stack buffer).");
  }
  const loops = nloop + inp.nFallSounds + (inp.stadium ? 1 : 0);
  if (loops > PF_MAX_LOOPSOUNDS) {
    add(out, PF_WARN, `Looping sounds: ${loops} (${nloop} on objects, ${inp.nFallSounds} on waterfalls${inp.stadium ? ", 1 stadium crowd" : ""}). The game plays ${PF_MAX_LOOPSOUNDS}. `
      + "The rest are silent: the objects in file order first, then the stadium crowd, then the "
      + "waterfalls nearest the start.");
  }
}

/* Race rules: the checkpoint map, in the order Save exports it (RaceBoxes). */

/** The type-6 boxes in .SIT order, at most CPX_MAX_BOXES + 1, sorted the way Save sorts them, each with its PfBox. */
function raceBoxes(inp: PfInput): { cin: { seq: number; split: number; lane: number }; src: PfBox }[] {
  const items: { seq: number; split: number; lane: number; src: PfBox }[] = [];
  for (const b of inp.box) {
    if (items.length >= 801) break;
    if (b.type === PF_BOX_CHECKPOINT) items.push({ seq: b.seq ?? 0, split: b.split ?? 0, lane: b.lane ?? 0, src: b });
  }
  cpxSortForExport(items);
  return items.map((i) => ({ cin: { seq: i.seq, split: i.split, lane: i.lane }, src: i.src }));
}

/** Walls, lead-ins and the checkpoint height check belong to new-style drag and Parallel (not split checkpoints). */
function dragStyleRules(inp: PfInput): boolean {
  return inp.raceRules === RACERULES_DRAG || inp.raceRules === RACERULES_PARALLEL;
}

/** "%.1f" of a C float. */
const f1 = (v: number) => Math.fround(v).toFixed(1);

function checkRaceRules(inp: PfInput, out: PfList): void {
  if ((inp.raceRules ?? RACERULES_NONE) === RACERULES_NONE) return;
  const err = cpxValidate(inp.raceRules!, raceBoxes(inp).map((c) => c.cin));
  if (err !== null) add(out, PF_ERROR, `Race rules: ${err}`);
  // A plain checkpoint box shorter than a truck is crossed without being counted; a box with a model is skipped.
  if (dragStyleRules(inp)) {
    for (const b of inp.box) {
      if (b.type === PF_BOX_CHECKPOINT && !b.hasModel && Math.fround(b.heightFt ?? 0) < PF_MIN_CHECKPOINT_HEIGHT_FT) {
        add(out, PF_WARN, `Checkpoint box ${b.index} is ${f1(b.heightFt ?? 0)} ft tall; race-rules checkpoints should be at least `
          + `${f0(PF_MIN_CHECKPOINT_HEIGHT_FT)} ft (a truck's height) or trucks may pass without being counted.`);
      }
    }
  }
}

/* Lead-ins: an empty lead-in or lane course is written anyway (the engine copes), so only a warning. */
function checkLeadIns(inp: PfInput, out: PfList): void {
  let any = false;
  for (let c = 0; c < PF_MAX_COURSES; c++) {
    const lane = inp.leadinLane?.[c] ?? 0;
    if (lane !== 1 && lane !== 2) continue;
    any = true;
    if (!dragStyleRules(inp)) continue;
    if ((inp.nCourseSeg[c] ?? 0) <= 0) add(out, PF_WARN, `Course ${c} is a lead-in but has no segments.`);
    else if ((inp.nCourseSeg[lane - 1] ?? 0) <= 0) add(out, PF_WARN, `Course ${c} is a lead-in for Lane ${lane}, but Lane ${lane}'s course has no segments.`);
  }
  if (any && !dragStyleRules(inp)) add(out, PF_WARN, "Lead-ins are only used on new-style drag and Parallel tracks; they will not be in the pod.");
}

/* Walls: with drag or Parallel rules off nothing is exported (a warning); on, each defect the export refuses is an error. */
function checkWalls(inp: PfInput, out: PfList): void {
  const walls = inp.wall ?? [];
  if (walls.length <= 0) return;
  if (!dragStyleRules(inp)) {
    add(out, PF_WARN, `Walls are only exported on new-style drag or Parallel tracks; this track's ${walls.length} walls will not be in the pod.`);
    return;
  }
  let total = 0;
  for (const w of walls) {
    const nm = w.name ?? "";
    if (w.npoints < 2) add(out, PF_ERROR, `Wall "${nm}" has ${w.npoints} point(s); a wall needs at least 2.`);
    else if (w.closed && w.npoints < 3) add(out, PF_ERROR, `Wall "${nm}" is closed with ${w.npoints} points; a closed wall needs at least 3.`);
    else if (w.exportCount >= 0 && w.exportCount < (w.closed ? 3 : 2)) add(out, PF_ERROR, `Wall "${nm}" has fewer than ${w.closed ? 3 : 2} distinct points; points on the same spot count once.`);
    if (w.thickness <= 0) add(out, PF_ERROR, `Wall "${nm}" has no thickness; it must be greater than 0.`);
    if (w.height <= 0) add(out, PF_ERROR, `Wall "${nm}" has no height; it must be greater than 0.`);
    if (w.maxStretchFt > PF_WALL_MAX_STRETCH_FT) add(out, PF_ERROR, `Wall "${nm}" has a stretch of ${String(Math.round(w.maxStretchFt))} ft; the longest allowed is ${f0(PF_WALL_MAX_STRETCH_FT)} ft.`);
    if (w.outOfWorld) add(out, PF_ERROR, `Wall "${nm}" goes outside the world (0 to ${((inp.worldCells ?? 0) > 0 ? inp.worldCells! : 256) * 32} ft)`);
    if (w.exportCount < 0) add(out, PF_ERROR, `Wall "${nm}" needs more than ${WALL_MAX_EXPORT_POINTS} points once subdivided (the most one wall can have); shorten it or split it.`);
    else total += w.exportCount;
  }
  if (total > WALL_MAX_EXPORT_TOTAL) add(out, PF_ERROR, `The walls need ${total} points in all once subdivided; one pod holds at most ${WALL_MAX_EXPORT_TOTAL}.`);
}

/**
  EngineFogSlotOverflow: `nfogs` fog boxes, `landings[f]` the mist volumes fall f registers (0 for
  one the engine never registers). Registration: the fog boxes, then stream 0 of every fall, then
  stream 1... Returns how many mist volumes do not fit, the total mist (each fall at most 4), and
  the first `maxList` dropped (0-based fall, 0-based stream) in registration order.
*/
export function engineFogSlotOverflow(nfogs: number, landings: readonly number[], maxList = Infinity): { dropped: number; totalMist: number; list: { fall: number; stream: number }[] } {
  let slots = ENGINEFOG_SLOTS - nfogs, reg = 0, dropped = 0, total = 0;
  if (slots < 0) slots = 0;
  for (const l of landings) if (l > 0) total += l > 4 ? 4 : l;
  const list: { fall: number; stream: number }[] = [];
  for (let li = 0; li < 4; li++) {
    for (let f = 0; f < landings.length; f++) {
      if (li < landings[f]!) {
        reg++;
        if (reg > slots) {
          if (dropped < maxList) list.push({ fall: f, stream: li });
          dropped++;
        }
      }
    }
  }
  return { dropped, totalMist: total, list };
}

/* Fog slots: 64 per track, shared by the fog boxes (first) and one mist volume per waterfall landing (last). */
function checkFogSlots(inp: PfInput, out: PfList): void {
  if (!inp.mistLandings || inp.mistLandings.length <= 0) return;
  const nfogs = inp.box.filter((b) => b.type === PF_BOX_FOG).length;
  const r = engineFogSlotOverflow(nfogs, inp.mistLandings, AGG_SHOW);
  if (r.dropped <= 0) return;
  const lost = new Agg();
  for (const d of r.list) lost.add(`Waterfall ${d.fall + 1} stream ${d.stream + 1} mist`);
  lost.n = r.dropped;
  const total = r.totalMist;
  add(out, PF_WARN, `Fog slots: ${nfogs} fog volume${nfogs === 1 ? "" : "s"} + ${total} waterfall mist volume${total === 1 ? "" : "s"} = ${nfogs + total}, but the game has ${ENGINEFOG_SLOTS}. `
    + `The game drops the mist that does not fit (mist registers after the fog volumes): ${lost.text()}.`);
}

function checkCourse(inp: PfInput, out: PfList): void {
  const which = ["Main course", "Extended course 1", "Extended course 2", "Extended course 3", "Extended course 4"];
  for (let c = 0; c < PF_MAX_COURSES; c++) {
    const n = inp.nCourseSeg[c] ?? 0;
    if (n > PF_MAX_SEGMENTS) {
      add(out, PF_ERROR, `${which[c]}: ${n} segments, the most the game can hold is ${PF_MAX_SEGMENTS}. `
        + `The game keeps the first ${PF_MAX_SEGMENTS} segments and ignores the rest (older game versions store two entries `
        + "per segment in a 500 entry list with no check and overrun it).");
    }
  }
}

function checkNames(inp: PfInput, out: PfList): void {
  if (inp.trackName && inp.trackName.length > PF_MAX_MENUNAME) {
    add(out, PF_ERROR, `Track name is ${inp.trackName.length} characters; the game's menu can hold ${PF_MAX_MENUNAME}. `
      + "The game cuts it to fit its 80 byte buffer (older game versions overrun that buffer).");
  }
  if (inp.stem && inp.stem.length > PF_MAX_STEM) {
    add(out, PF_WARN, `Track file name "${inp.stem}" is ${inp.stem.length} characters. The tools hold to ${PF_MAX_STEM} so that `
      + `ART\\<name>_MASK.PNG, _WDTL and _WMSK fit a ${PF_POD_ENTRY} character pod entry; a longer name makes `
      + "those maps impossible to pack.");
  }
}

/* .LVL, section 5.2. */
function checkLevel(inp: PfInput, out: PfList): void {
  if (inp.weatherWritten && (inp.weatherMask & 0x1ff) === 0) {
    add(out, PF_ERROR, "Weather: no weather is ticked. The game quits on load with \"Bad weather mask\". Tick at least one.");
  }
  const bgm = inp.stockBgm;
  if (inp.bgmChecked && bgm !== null) {
    const dot = bgm.lastIndexOf(".");
    if (dot < 0) add(out, PF_ERROR, `Music "${bgm}" has no file extension. The game quits on load with "Bad level music".`);
    else {
      const ext = bgm.slice(dot).toLowerCase();
      if (ext !== ".wav" && ext !== ".mp3" && ext !== ".ogg") {
        add(out, PF_WARN, `Music "${bgm}" is not a .wav, .mp3 or .ogg file. The game plays its default track instead.`);
      }
    }
    // c40b430: a spaced name shifts every later line on every engine; an over-long one is cut (the wrong file).
    if (bgm.includes(" ")) {
      add(out, PF_ERROR, `Music name "${bgm}" has a space. The level file reads each name as one word, so `
        + "every later line of it is read out of step.");
    } else if (bgm.length > PF_MAX_LVLTOKEN) {
      add(out, PF_ERROR, `Music name "${bgm}" is over ${PF_MAX_LVLTOKEN} characters. The game cuts it, so it looks for `
        + "the wrong file (older game versions read every later line of the level file out of step).");
    }
  }
}

/* Textures and maps, sections 5.2 / 5.3. */
const rawLenOk = (bytes: number) => bytes === 1024 || bytes === 4096 || bytes === 65536;

function checkTextures(inp: PfInput, out: PfList): void {
  if (inp.texCount > PF_MAX_TEX) {
    add(out, PF_ERROR, `Terrain textures: ${inp.texCount}, the most the game can hold is ${PF_MAX_TEX}. `
      + `The game keeps the first ${PF_MAX_TEX} and ignores the rest (older game versions overrun their texture table).`);
  }
  const badlen = new Agg(), nobody = new Agg(), nohdr = new Agg(), rust = new Agg(), big = new Agg(), nonsq = new Agg(), small = new Agg(), lower = new Agg();
  for (const t of inp.tex) {
    if (t.legacyWritten && t.hdstate !== PF_HD_OK && !rawLenOk(t.w * t.h)) badlen.add(t.name);
    if (!t.legacyWritten && t.hdstate === PF_HD_NOBODY) nobody.add(t.name);
    if (!t.legacyWritten && t.hdstate === PF_HD_NOHEADER) (t.model ? rust : nohdr).add(t.name);
    if (t.hdstate === PF_HD_OK) {
      if (t.hdw > PF_HD_MAX || t.hdh > PF_HD_MAX) big.add(t.name);
      if (t.hdw !== t.hdh) nonsq.add(t.name);
      if (Math.max(t.hdw, t.hdh) < PF_HD_TRUECOLOUR_MIN) small.add(t.name);
    }
    if (t.type !== 0 && t.name && /[a-z]/.test(t.name)) lower.add(t.name);
  }
  if (badlen.n > 0) {
    add(out, PF_ERROR, `Texture size: ${badlen.text()}. A legacy .RAW must be exactly 1024, 4096 or 65536 bytes `
      + "(32, 64 or 256 pixels square) and there is no HD file to use instead. "
      + "The game quits on load with \"Bad texture size\".");
  }
  if (nobody.n > 0) {
    add(out, PF_ERROR, `HD texture will not read: ${nobody.text()}. Its .RAW is being left out of the pod and the game `
      + "has nothing else to use, so it quits on load with \"Unable to open texture\". "
      + "Replace the .PNG/.TGA or turn off Omit the legacy fallback.");
  }
  if (nohdr.n > 0) {
    add(out, PF_ERROR, `HD texture file will not read: ${nohdr.text()}. Its .RAW is being left out of the pod, so the game `
      + "finds no usable art for this terrain texture and quits with \"Unable to open texture\". "
      + "Replace the .PNG/.TGA or turn off Omit the legacy fallback.");
  }
  if (rust.n > 0) {
    add(out, PF_WARN, `HD model texture file will not read: ${rust.text()}. Its .RAW is being left out of the pod, so the `
      + "game shows its RUSTPLAT.RAW placeholder instead.");
  }
  if (big.n > 0) add(out, PF_WARN, `HD texture over ${PF_HD_MAX} pixels: ${big.text()}. The game resamples it down to ${PF_HD_MAX}.`);
  if (nonsq.n > 0) add(out, PF_WARN, `HD texture not square: ${nonsq.text()}. The game stretches it to a square power of two.`);
  if (small.n > 0) {
    add(out, PF_WARN, `HD texture under ${PF_HD_TRUECOLOUR_MIN} pixels: ${small.text()}. The game does not treat art this small as true `
      + "colour; it is boxed into the 8-bit palette.");
  }
  if (lower.n > 0) {
    add(out, PF_WARN, `Ground type set on a lower case texture name: ${lower.text()}. The game looks the name up in `
      + "upper case, so the ground type is silently ignored.");
  }
}

function checkMaps(inp: PfInput, out: PfList): void {
  const stemlen = inp.stem ? inp.stem.length : 0;
  for (const m of inp.map) {
    const entry = 4 + stemlen + m.suffix.length + m.extlen;
    const mask = m.suffix.toUpperCase() === "_MASK" || m.suffix.toUpperCase() === "_WMSK";
    if (entry > PF_POD_ENTRY) {
      add(out, PF_ERROR, `Map ART\\${inp.stem ?? ""}${m.suffix} is ${entry} characters long, a pod entry holds ${PF_POD_ENTRY}. It cannot be packed `
        + "and would be left out of the pod. Shorten the track file name.");
    }
    if (mask && m.dimsKnown && (m.w > PF_MASK_MAX || m.h > PF_MASK_MAX)) {
      add(out, PF_WARN, `Map ${m.suffix} is ${m.w}x${m.h}. The engine has no limit but the graphics card cannot create a `
        + `texture over ${PF_MASK_MAX} pixels, so the mask silently does nothing.`);
    }
  }
}

function checkAnimations(inp: PfInput, out: PfList): void {
  const zero = new Agg(), noframes = new Agg(), many = new Agg(), longname = new Agg();
  if (inp.ani.length > PF_ANI_MAX_ENTRIES) add(out, PF_ERROR, `Animated textures: ${inp.ani.length}, the most the game can hold is ${PF_ANI_MAX_ENTRIES}.`);
  inp.ani.forEach((a, i) => {
    const label = `#${i + 1} ${a.name ?? "?"}`.slice(0, AGG_NAMELEN - 1);
    if (a.period <= 0) zero.add(label);
    if (a.nframes < 1) noframes.add(label);
    else if (a.nframes > PF_ANI_MAX_FRAMES) many.add(label);
    if (a.longestName > PF_ANI_MAX_NAME) longname.add(label);
  });
  if (zero.n > 0) {
    add(out, PF_ERROR, `Animated texture with no frame time: ${zero.text()}. The game skips it, so it does not animate `
      + "(older game versions divide by it and crash).");
  }
  if (noframes.n > 0) {
    add(out, PF_ERROR, `Animated texture with no frames: ${noframes.text()}. The game skips it, so it does not animate `
      + "(older game versions read past the end of their list).");
  }
  if (many.n > 0) add(out, PF_ERROR, `Animated texture with more than ${PF_ANI_MAX_FRAMES} frames: ${many.text()}. The game holds ${PF_ANI_MAX_FRAMES}.`);
  if (longname.n > 0) {
    add(out, PF_ERROR, `Animation frame name over ${PF_ANI_MAX_NAME} characters including the extension: ${longname.text()}. `
      + `The game's name field holds ${PF_ANI_MAX_NAME}.`);
  }
}

/* Rules shared with the gatherer. */

/** FALLFLAG_SOUND. */
export const PF_FALLFLAG_SOUND = 0x0004;

/** PodPreflightFallHasSound: the sound flag on AND a stem. */
export function podPreflightFallHasSound(flags: number, sound: string | null): boolean {
  return (flags & PF_FALLFLAG_SOUND) !== 0 && Boolean(sound);
}

/** PodPreflightLegacyWritten: no HD file, or neither omitting nor a texture that failed to load. */
export function podPreflightLegacyWritten(hasHD: boolean, omitFallback: boolean, bad: boolean): boolean {
  return !hasHD || (!omitFallback && !bad);
}

/** PodPreflightCheck: every check; errors first, each group in the order found. */
export function podPreflightCheck(inp: PfInput): PfList {
  const out: PfList = { item: [], nerr: 0, nwarn: 0, dropped: 0 };
  checkBoxes(inp, out);
  checkRaceRules(inp, out);
  checkWalls(inp, out);
  checkLeadIns(inp, out);
  checkFogSlots(inp, out);
  checkCourse(inp, out);
  checkNames(inp, out);
  checkLevel(inp, out);
  checkTextures(inp, out);
  checkMaps(inp, out);
  checkAnimations(inp, out);
  out.item = [...out.item.filter((i) => i.level === PF_ERROR), ...out.item.filter((i) => i.level !== PF_ERROR)];
  return out;
}

/** PodPreflightFormat: the list as one block of text (each item then a blank line), for the dialog. */
export function podPreflightFormat(list: PfList): string {
  let text = "";
  for (const i of list.item) text += `${i.level === PF_ERROR ? "ERROR  " : "Warning  "}${i.text}\r\n\r\n`;
  if (list.dropped > 0) text += `(${list.dropped} more not listed)\r\n`;
  return text;
}

/** PodPreflightDlg's header line. */
export function podPreflightHeader(list: PfList): string {
  if (list.nerr > 0) {
    return `The game engine would crash, quit or overrun memory on this track (${list.nerr} problem${list.nerr === 1 ? "" : "s"}). `
      + "The game shows its players no load warnings at all, so this is the only warning you will get."
      + (list.nwarn > 0 ? " Warnings follow the errors." : "");
  }
  return `The game engine will silently drop or change some of this track's content (${list.nwarn} warning${list.nwarn === 1 ? "" : "s"}). `
    + "The game shows its players no load warnings at all, so this is the only warning you will get. The pod will be written.";
}

/** PodPreflightDlg's caption. */
export function podPreflightTitle(list: PfList): string {
  return list.nerr > 0 ? "Write POD - problems found" : "Write POD - warnings";
}
