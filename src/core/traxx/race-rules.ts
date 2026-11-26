/*
  RACE RULES (Traxx 1.8.2: Include/TrackPODRaceRules.h, TrackPOD/TrackPODRaceRules.cpp, and the
  pod's GatherCpxBoxes / ApplyRaceRulesCpx / Save in TrackPOD/TrackPODFile.cpp and SetTrackType /
  SetRaceRules / SetLeadIn in TrackPOD/TrackPOD.cpp): new-style drags (mode 1), Parallel races
  (mode 2) and split checkpoints on circuits and rallies (mode 3), written into the pod as
  WORLD\<stem>.CPX.

  OpenPhotex holds the file's bytes (readCpx / writeCpx, a neutral codec). Everything Traxx decides
  is here, ported 1:1: the slot ranking, the roles, the checks and their exact messages, the
  quantisation of the .SIT text, the export sort, the renumbering, CpxParse's rules on top of
  readCpx, the all-or-nothing apply on load, Save's build and the model setters.

  THE FINGERPRINT. Every CPBX record carries the box's position and heading as the .SIT states
  them: CpxQuantPos / CpxQuantPsi of the exact "%.6f" text WriteSITFile prints (SitBoxPositionText,
  SitBoxAnglesText: float values, so the text must come from the same floats; sitBoxCpxText). A
  pod's .CPX is applied only when the track's checkpoint boxes still match it (16 / 256 ft on
  each axis, 64 / 65536 turn on psi).

  The C++ builds messages with _vsnprintf into a 256-byte buffer, so a message is cut at 255
  characters (cpxFail); the COUR note is cut at 127 and the track's note at 399.
*/
import { readCpx, writeCpx, type Cpx, type CpxErrorCode } from "../../vendor/openphotex/mtm/cpx.js";
import {
  CPX_ROLE_FINISH, CPX_ROLE_GATE, CPX_ROLE_LAUNCH, CPX_ROLE_PRESTAGE, CPX_ROLE_STAGE, CPX_SPLIT_ANY, CPX_SPLIT_LANE, CPX_SPLIT_NONE,
  RACERULES_DRAG, RACERULES_NONE, RACERULES_PARALLEL, RACERULES_RACE, type RaceRules, type RaceRulesMode, type Wall,
} from "./race-types.ts";
import { TRAXX_BOX_CHECKPOINT, traxxIposToSit, type TraxxBox } from "./sit.ts";
import { cFixed, cAtof, f32 } from "./cformat.ts";
import {
  WALL_MAX_EXPORT_POINTS, WALL_MAX_EXPORT_TOTAL, WALL_MAX_POINTS, WALL_MAX_WALLS, WALL_NAMELEN, cInt, exportWall, pointsOutOfWorld, wallDefaults,
  type WallExportPoint, type WallGroundFn,
} from "./walls.ts";

/** The engine's MAX_CHECKPOINTS (core\sim.h, engine 603e219). */
export const CPX_MAX_SLOTS = 100;
/** Retail MTM2 and old builds hold at most this many checkpoint boxes. */
export const CPX_RETAIL_BOXES = 20;
export const CPX_MAX_COPIES = 8;
export const CPX_MAX_BOXES = CPX_MAX_SLOTS * CPX_MAX_COPIES;
export const CPX_PENALTY_MS = 5000;
export const CPX_REARM_MS = 1000;
export const CPX_MAX_COURSES = 5;

/** Track types (Include/TrackPOD.h). */
export const TRACKTYPE_DRAG = 1;
export const TRACKTYPE_CIRCUIT = 2;
export const TRACKTYPE_RALLY = 3;
export const TRACKTYPE_RUMBLE = 4;

const CPX_PI = 3.14159265358979323846;
/** sizeof(item[0].name) in a POD1 directory entry. */
const POD_ITEM_NAME_SIZE = 32;

/** CpxBoxIn: one per type-6 box, in .SIT order. */
export interface CpxBoxIn {
  /** CTrackPODBox::checkpoint_seq. */
  seq: number;
  split: number;
  lane: number;
  /** The three "%.6f" fields WriteSITFile prints: x, height, y. */
  sitpos: [string, string, string];
  /** The "%.6f" psi field. */
  sitpsi: string;
}

/** CpxBoxOut: a CPBX record as CpxParse gives it. */
export interface CpxBoxOut {
  slot: number;
  role: number;
  split: number;
  lane: number;
  groundline: number;
  fx: number;
  fy: number;
  fz: number;
  fpsi: number;
}

/**
  CpxWallIn: one wall of the WALL chunk. first / count index the EXPORTED points, wall after wall:
  first is the running sum of the counts before it. Lengths in 1/256 ft.
*/
export interface CpxWallIn {
  name: string;
  side: number;
  closed: number;
  noline: number;
  thickness: number;
  height: number;
  first: number;
  count: number;
}

/** CpxCourseIn: a lead-in (COUR record). A lead-in belongs to lane thencourse + 1. */
export interface CpxCourseIn {
  course: number;
  firstpass: number;
  thencourse: number;
}

/** CpxParsed: a .CPX as CpxParse reads it. */
export interface CpxParsed {
  mode: number;
  laps: number;
  boxes: CpxBoxOut[];
  /** Empty when the file has no WALL chunk (or one of 0 walls). */
  walls: CpxWallIn[];
  points: WallExportPoint[];
  /** The kept COUR records (first pass only); empty when absent or when the chunk had a defect. */
  courses: CpxCourseIn[];
  /** True when a COUR chunk was ignored for a defect (it never fails the parse). */
  courseBad: boolean;
  /** Why, e.g. "two lead-ins for Lane 1". */
  courseNote: string;
}

/** CpxFail: _vsnprintf into err[256], so at most 255 characters. */
function cpxFail(message: string, size = 256): string {
  return message.length > size - 1 ? message.slice(0, size - 1) : message;
}

// ---- ranking, roles, sorting ----

/** CpxRankSlots: distinct seq values ascending -> slots 0..k-1; slot[i] belongs to in[i]. */
export function cpxRankSlots(input: readonly { seq: number }[]): { count: number; slot: number[] } {
  const n = input.length;
  if (n <= 0) return { count: 0, slot: [] };
  const sorted = input.map((b) => b.seq).sort((a, b) => a - b);
  const s: number[] = [sorted[0]!];
  for (let i = 1; i < n; i++) if (sorted[i] !== s[s.length - 1]) s.push(sorted[i]!);
  const slot = input.map((b) => {
    let lo = 0, hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid]! < b.seq) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  });
  return { count: s.length, slot };
}

/** CpxRoleForSlot. Drag: 0 Pre-stage, 1 Stage, 2 Launch, last Finish, else Gate. Parallel and race: last Finish, else Gate. */
export function cpxRoleForSlot(mode: number, slot: number, nslots: number): number {
  if (mode === RACERULES_DRAG) {
    if (slot === 0) return CPX_ROLE_PRESTAGE;
    if (slot === 1) return CPX_ROLE_STAGE;
    if (slot === 2) return CPX_ROLE_LAUNCH;
  }
  if (slot === nslots - 1) return CPX_ROLE_FINISH;
  return CPX_ROLE_GATE;
}

/** CpxSortForExport: sorts in place, stable by (slot rank, lane); returns order[k] = the original index of element k. */
export function cpxSortForExport<T extends { seq: number; lane: number }>(input: T[]): number[] {
  const n = input.length;
  if (n <= 0) return [];
  const { slot } = cpxRankSlots(input);
  const idx = input.map((_, i) => i);
  // Insertion sort: stable by (slot, lane).
  for (let i = 1; i < n; i++) {
    const v = idx[i]!;
    let j = i - 1;
    while (j >= 0 && (slot[idx[j]!]! > slot[v]! || (slot[idx[j]!] === slot[v] && input[idx[j]!]!.lane > input[v]!.lane))) {
      idx[j + 1] = idx[j]!;
      j--;
    }
    idx[j + 1] = v;
  }
  const copy = input.slice();
  for (let i = 0; i < n; i++) input[i] = copy[idx[i]!]!;
  return idx;
}

/**
  CpxRenumber: the editor's renumbering. The checkpoints are given in their current box order. A
  stable sort by (seq, lane, that order) gives order[k] = the original index of the k-th box, and
  newseq[k] its new number: the rank of its seq among the distinct seqs (copies keep sharing a
  number), or k itself when unique (rules off: every box its own number). count is the number of
  distinct numbers.
*/
export function cpxRenumber(seq: readonly number[], lane: readonly number[], unique: boolean): { count: number; order: number[]; newseq: number[] } {
  const n = seq.length;
  if (n <= 0) return { count: 0, order: [], newseq: [] };
  const order = seq.map((_, i) => i);
  for (let i = 1; i < n; i++) {
    const v = order[i]!;
    let j = i - 1;
    while (j >= 0 && (seq[order[j]!]! > seq[v]! || (seq[order[j]!] === seq[v] && lane[order[j]!]! > lane[v]!))) {
      order[j + 1] = order[j]!;
      j--;
    }
    order[j + 1] = v;
  }
  const newseq: number[] = [];
  let distinct = 0;
  for (let i = 0; i < n; i++) {
    if (i === 0 || seq[order[i]!] !== seq[order[i - 1]!]) distinct++;
    newseq.push(unique ? i : distinct - 1);
  }
  return { count: unique ? n : distinct, order, newseq };
}

/** CpxFreeLane: `lane` (1 or 2) if none of the other copies has it, else the other one. Both taken: `lane` unchanged. */
export function cpxFreeLane(otherLanes: readonly number[], lane: number): number {
  let taken1 = false, taken2 = false;
  for (const l of otherLanes) {
    if (l === 1) taken1 = true;
    else if (l === 2) taken2 = true;
  }
  if (lane === 1 && !taken1) return 1;
  if (lane === 2 && !taken2) return 2;
  if (!taken1 && lane !== 1) return 1;
  if (!taken2 && lane !== 2) return 2;
  return lane;
}

/** CpxMainCopyIndex: the first index whose id is slotid (the main route, the copy the AI follows), else -1. */
export function cpxMainCopyIndex(ids: readonly number[], slotid: number): number {
  for (let i = 0; i < ids.length; i++) if (ids[i] === slotid) return i;
  return -1;
}

/** "%02d" of an int. */
function d02(v: number): string {
  const s = String(Math.abs(v));
  return v < 0 ? `-${s}` : s.padStart(2, "0");
}

/**
  CpxFormatLabel: the overlay text for a checkpoint on a race-rules track, "CP 03 FIN L2": the slot,
  the role (PS ST LA FIN G) and, for a per-lane copy only, " L1" / " L2". strncpy into a buffer of
  `size` (16 in Traxx), so at most size - 1 characters.
*/
export function cpxFormatLabel(slot: number, role: number, split: number, lane: number, size = 16): string {
  let r = "G";
  if (role === CPX_ROLE_PRESTAGE) r = "PS";
  else if (role === CPX_ROLE_STAGE) r = "ST";
  else if (role === CPX_ROLE_LAUNCH) r = "LA";
  else if (role === CPX_ROLE_FINISH) r = "FIN";
  const tmp = split === CPX_SPLIT_LANE && (lane === 1 || lane === 2) ? `CP ${d02(slot)} ${r} L${lane}` : `CP ${d02(slot)} ${r}`;
  if (size <= 0) return "";
  return tmp.slice(0, size - 1);
}

// ---- validation ----

/** CpxValidate: null if the boxes are a valid map for the mode, else the first failure (it names the checkpoint). */
export function cpxValidate(mode: number, input: readonly Pick<CpxBoxIn, "seq" | "split" | "lane">[]): string | null {
  const n = input.length;
  if (mode !== RACERULES_DRAG && mode !== RACERULES_PARALLEL && mode !== RACERULES_RACE) {
    return cpxFail(`unknown race rules mode ${mode}, so the checkpoints cannot be checked`);
  }
  if (n <= 0) return cpxFail("the track has no checkpoint boxes");
  if (n > CPX_MAX_BOXES) return cpxFail(`${n} checkpoint boxes is too many (at most ${CPX_MAX_SLOTS} slots of ${CPX_MAX_COPIES} copies)`);

  const { count: nslots, slot } = cpxRankSlots(input);
  if (nslots > CPX_MAX_SLOTS) return cpxFail(`${nslots} checkpoints is too many (at most ${CPX_MAX_SLOTS})`);

  // Rule 2: the copies of a slot are adjacent, so the slot numbers never go back.
  for (let i = 1; i < n; i++) {
    if (slot[i]! < slot[i - 1]!) return cpxFail(`checkpoint ${slot[i]! + 1}: its copies are not next to each other in the box order`);
  }

  const first = new Array<number>(nslots).fill(-1);
  const count = new Array<number>(nslots).fill(0);
  for (let i = 0; i < n; i++) {
    const s = slot[i]!;
    if (first[s]! < 0) first[s] = i;
    count[s]!++;
  }
  const noLanes = (s: number) => cpxFail(`checkpoint ${s + 1}: a race with race rules has no lanes, so a checkpoint cannot be split per lane`);

  for (let s = 0; s < nslots; s++) {
    const split = input[first[s]!]!.split;
    let lane1 = 0, lane2 = 0;
    if (mode === RACERULES_RACE && split === CPX_SPLIT_LANE) return noLanes(s);
    if (count[s]! > CPX_MAX_COPIES) return cpxFail(`checkpoint ${s + 1}: ${count[s]} copies is too many (at most ${CPX_MAX_COPIES})`);
    // Rule 3: one split for all copies.
    for (let i = first[s]!; i < first[s]! + count[s]!; i++) {
      if (input[i]!.split !== split) return cpxFail(`checkpoint ${s + 1}: its copies do not all have the same split`);
      if (mode === RACERULES_RACE && input[i]!.lane !== 0) return noLanes(s);   // every copy, not only the first
      if (input[i]!.lane === 1) lane1++;
      else if (input[i]!.lane === 2) lane2++;
    }
    // Rule 4: copies against split.
    if (split === CPX_SPLIT_NONE) {
      if (count[s] !== 1) return cpxFail(`checkpoint ${s + 1}: an unsplit checkpoint needs exactly one box`);
    } else if (split === CPX_SPLIT_ANY) {
      if (count[s]! < 2) return cpxFail(`checkpoint ${s + 1}: a split checkpoint needs two or more copies`);
    } else if (split === CPX_SPLIT_LANE) {
      if (count[s] !== 2 || lane1 !== 1 || lane2 !== 1) return cpxFail(`checkpoint ${s + 1}: per-lane split needs exactly one lane 1 and one lane 2 copy`);
    } else return cpxFail(`checkpoint ${s + 1}: unknown split ${split}`);
  }

  // Rules 5 and 6: how many slots the mode needs. The roles are fixed by position (cpxRoleForSlot).
  if (mode === RACERULES_DRAG && nslots < 4) {
    return cpxFail(`a drag needs at least 4 checkpoints (pre-stage, stage, launch, finish), this track has ${nslots}`);
  }
  // Rule 7: per-lane starts (drag).
  if (mode === RACERULES_DRAG) {
    let startsplit = 0;
    for (let s = 0; s < 3; s++) if (input[first[s]!]!.split === CPX_SPLIT_LANE) startsplit++;
    for (let s = 0; s < 3; s++) {
      if (input[first[s]!]!.split === CPX_SPLIT_ANY) {
        return cpxFail(`checkpoint ${s + 1}: a pre-stage, stage or launch checkpoint is split per lane or not split at all, never as any copy`);
      }
    }
    if (startsplit !== 0 && startsplit !== 3) return cpxFail("the pre-stage, stage and launch checkpoints must all be split per lane, or none of them");
    if (startsplit === 3) {
      for (let s = 3; s < nslots; s++) {
        if (input[first[s]!]!.split !== CPX_SPLIT_LANE) {
          return cpxFail(`checkpoint ${s + 1}: with per-lane starts every checkpoint must be split per lane, one copy for each lane`);
        }
      }
    }
  }
  return null;
}

/** The laps check CpxBuildEx and CpxParse share (both print the value). */
function lapsError(mode: number, laps: number): string | null {
  if (mode === RACERULES_DRAG ? laps !== 0 && laps !== 1 : laps !== 0) {
    return cpxFail(mode === RACERULES_DRAG
      ? `a drag's lap setting must be one run (1) or looped (0), not ${laps}`
      : mode === RACERULES_RACE
        ? `a race with race rules has no lap setting of its own (it must be 0), not ${laps}`
        : `a Parallel race's lap setting must be 0, not ${laps}`);
  }
  return null;
}

// ---- quantisers ----

/** CpxRound: half away from zero. */
function cpxRound(v: number): number {
  return v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5);
}

/** CpxQuantPos: round(strtod(field) * 256), halves away from zero. */
export function cpxQuantPos(field: string): number {
  return cInt(cpxRound(cAtof(field) * 256.0));
}

/** CpxQuantPsi: round(strtod(field) * 65536 / 2pi), wrapped into 0..65535. */
export function cpxQuantPsi(field: string): number {
  let t = cpxRound(cAtof(field) * 65536.0 / (2.0 * CPX_PI));
  t = t % 65536.0;
  if (t < 0) t += 65536.0;
  if (t >= 65536.0) t = 0;
  return cInt(t) & 0xffff;
}

/**
  SitBoxPositionText / SitBoxAnglesText (TrackPODFile.cpp): a box's .SIT fields as the .CPX
  fingerprints them, the same expressions and float casts writeTraxxSit prints (sit.ts
  traxxSitToMtm2: position() and objectHeight()):
    fz = 2.0f * (float)ipos[2] + (float)zfraction / 128.0f
    fx = (float)Pod1IposToSit(ipos[0], xfraction), fy likewise
    fields [fx, fz, fy] and psi, each "%.6f".
*/
export function sitBoxCpxText(box: Pick<TraxxBox, "ipos" | "fraction" | "psi">): { sitpos: [string, string, string]; sitpsi: string } {
  const fz = f32(f32(2 * f32(box.ipos[2])) + f32(f32(box.fraction[2]) / 128));
  const fx = f32(traxxIposToSit(box.ipos[0], box.fraction[0]));
  const fy = f32(traxxIposToSit(box.ipos[1], box.fraction[1]));
  return { sitpos: [cFixed(fx), cFixed(fz), cFixed(fy)], sitpsi: cFixed(f32(box.psi)) };
}

/** GatherCpxBoxes: the type-6 boxes in box[] order (the .SIT's order), as the .CPX wants them. */
export function gatherCpxBoxes(boxes: readonly TraxxBox[]): CpxBoxIn[] {
  const out: CpxBoxIn[] = [];
  for (const b of boxes) {
    if (b.type !== TRAXX_BOX_CHECKPOINT) continue;
    out.push({ seq: b.checkpointSeq, split: b.cpSplit, lane: b.cpLane, ...sitBoxCpxText(b) });
  }
  return out;
}

// ---- walls and lead-ins ----

/**
  CpxCheckCour: the COUR records for modes 1 and 2. null if fine, else a short note (no prefix).
  The builder (strict) also insists every record is first pass only; the reader validates every
  record the same way and then keeps only the first-pass ones.
*/
function cpxCheckCour(c: readonly CpxCourseIn[], strict: boolean): string | null {
  const nc = c.length;
  const note = (m: string) => cpxFail(m, 128);
  if (nc > CPX_MAX_COURSES) return note(`${nc} lead-ins, at most ${CPX_MAX_COURSES} courses exist`);
  for (let i = 0; i < nc; i++) {
    const r = c[i]!;
    if (r.course < 0 || r.course >= CPX_MAX_COURSES) return note(`course ${r.course} does not exist (0..${CPX_MAX_COURSES - 1})`);
    for (let j = 0; j < i; j++) if (c[j]!.course === r.course) return note(`course ${r.course} is listed twice`);
    if (r.course <= 1) return note(`course ${r.course} is Lane ${r.course + 1}'s own course and cannot be a lead-in`);
    if (strict && r.firstpass !== 1) return note(`course ${r.course} is not marked first pass only`);
    if (r.thencourse < 0 || r.thencourse > 1) return note(`course ${r.course} leads to course ${r.thencourse}, but a lead-in must lead to course 0 or 1`);
  }
  for (let i = 0; i < nc; i++) {
    const r = c[i]!;
    if (!r.firstpass) continue;
    for (let j = 0; j < i; j++) if (c[j]!.firstpass && c[j]!.thencourse === r.thencourse) return note(`two lead-ins for Lane ${r.thencourse + 1}`);
    // Defensive: with course 0 / 1 refused as a lead-in and thencourse limited to 0 / 1 this cannot fire today.
    for (let j = 0; j < nc; j++) {
      if (c[j]!.course === r.thencourse && c[j]!.firstpass) return note(`course ${r.course} leads to course ${r.thencourse}, which is itself a lead-in`);
    }
  }
  return null;
}

/** CpxWallName: the name as text, whatever its 32 bytes hold. */
function cpxWallName(name: string): string {
  return name.slice(0, WALL_NAMELEN);
}

/**
  CpxCheckWalls: the wall defects, the same for the builder and the reader. The walls' points are
  pts; wall k owns pts[first .. first + count - 1] and the ranges run on from each other. `pts`
  null is the C++'s NULL point list.
*/
function cpxCheckWalls(walls: readonly CpxWallIn[] | null, nwalls: number, pts: readonly WallExportPoint[] | null, npts: number): string | null {
  if (nwalls <= 0) return null;
  if (walls === null) return cpxFail(`${nwalls} walls were given but no wall list`);
  if (nwalls > WALL_MAX_WALLS) return cpxFail(`${nwalls} walls is too many (at most ${WALL_MAX_WALLS})`);
  if (npts < 0 || npts > WALL_MAX_EXPORT_TOTAL) return cpxFail(`${npts} wall points is too many (at most ${WALL_MAX_EXPORT_TOTAL} in all)`);
  let running = 0;
  for (let k = 0; k < nwalls; k++) {
    const w = walls[k]!;
    const nm = cpxWallName(w.name);
    if (w.count < 2) return cpxFail(`wall "${nm}": it has ${w.count} point(s), at least 2 are needed`);
    if (w.closed && w.count < 3) return cpxFail(`wall "${nm}": a closed wall needs at least 3 points, it has ${w.count}`);
    if (w.count > WALL_MAX_EXPORT_POINTS) return cpxFail(`wall "${nm}": ${w.count} points is too many (at most ${WALL_MAX_EXPORT_POINTS})`);
    if (w.side < 0 || w.side > 2) return cpxFail(`wall "${nm}": unknown side ${w.side}`);
    if (w.thickness <= 0) return cpxFail(`wall "${nm}": its thickness must be greater than 0`);
    if (w.height <= 0) return cpxFail(`wall "${nm}": its height must be greater than 0`);
    if (w.first < 0 || w.first > npts || w.count > npts - w.first || pts === null) {
      return cpxFail(`wall "${nm}": its points run past the end of the point list`);
    }
    if (w.first !== running) return cpxFail(`wall "${nm}": its points overlap another wall's or leave a gap (they must follow the previous wall's)`);
    running += w.count;
    const stretches = w.closed ? w.count : w.count - 1;
    for (let i = 0; i < stretches; i++) {
      const a = pts[w.first + i]!;
      const b = pts[w.first + ((i + 1) % w.count)]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const lim = Math.floor(Math.sqrt(dx * dx + dz * dz) / 2.0);
      if (Math.abs(a.bend) > lim) {
        return cpxFail(`wall "${nm}": the bend at point ${i + 1} is ${a.bend}, more than half its chord (${cInt(lim)}), which is the most an arc can bend`);
      }
    }
  }
  return null;
}

// ---- the image ----

export type CpxBuildResult = { ok: true; image: Uint8Array } | { ok: false; error: string };

/** CpxBuild: CpxBuildEx with no walls and no lead-ins. */
export function cpxBuild(mode: number, laps: number, input: readonly CpxBoxIn[]): CpxBuildResult {
  return cpxBuildEx(mode, laps, input);
}

/**
  CpxBuildEx: validates in Traxx's order, then builds the .CPX image in the order given (the caller
  sorts first). No walls writes 2 chunks; walls add WALL and WPNT; lead-ins add COUR, last.
  Refused, with the first failure: walls or lead-ins in mode 3, CpxValidate, the laps, the walls
  (CpxCheckWalls, then the point total), and the lead-ins ("COUR: ..."). `walls` null with a
  count is the C++'s NULL wall list (pass nwalls); `points` null its NULL point list.
*/
export function cpxBuildEx(
  mode: number, laps: number, input: readonly CpxBoxIn[],
  walls: readonly CpxWallIn[] | null = null, points: readonly WallExportPoint[] | null = null, cour: readonly CpxCourseIn[] | null = null,
  nwallsGiven?: number,
): CpxBuildResult {
  const fail = (error: string): CpxBuildResult => ({ ok: false, error });
  let nwalls = nwallsGiven ?? walls?.length ?? 0;
  if (nwalls < 0) nwalls = 0;
  const npts = points?.length ?? 0;
  const ncour = cour?.length ?? 0;
  if (nwalls > 0 && mode === 3) return fail("walls are not allowed in mode 3 (a race with race rules)");
  if (ncour > 0 && mode === 3) return fail("COUR: lead-ins are not allowed in mode 3 (a race with race rules)");
  const invalid = cpxValidate(mode, input);
  if (invalid !== null) return fail(invalid);
  const laperr = lapsError(mode, laps);
  if (laperr !== null) return fail(laperr);

  const wallerr = cpxCheckWalls(walls, nwalls, points, npts);
  if (wallerr !== null) return fail(wallerr);
  if (nwalls > 0) {
    const last = walls![nwalls - 1]!;
    if (npts !== last.first + last.count) return fail(cpxFail(`the wall points are ${npts} but the walls use ${last.first + last.count}`));
  }
  if (ncour > 0) {
    const note = cpxCheckCour(cour!, true);
    if (note !== null) return fail(cpxFail(`COUR: ${note}`));
  }

  const { count: nslots, slot } = cpxRankSlots(input);
  const image = writeCpx({
    rule: {
      mode, laps, timeoutMs: 0,   // the engine's default
      penaltyMs: mode === RACERULES_RACE ? 0 : CPX_PENALTY_MS, rearmMs: mode === RACERULES_RACE ? 0 : CPX_REARM_MS,
    },
    boxes: input.map((b, i) => {
      const role = cpxRoleForSlot(mode, slot[i]!, nslots);
      return {
        slot: slot[i]!, role, split: b.split, lane: b.split === CPX_SPLIT_LANE ? b.lane : 0,
        groundLine: mode !== RACERULES_RACE && role !== CPX_ROLE_GATE ? 1 : 0,
        psi: cpxQuantPsi(b.sitpsi), x: cpxQuantPos(b.sitpos[0]), y: cpxQuantPos(b.sitpos[1]), z: cpxQuantPos(b.sitpos[2]),
      };
    }),
    walls: nwalls > 0
      ? walls!.slice(0, nwalls).map((w) => ({
        // memcpy of 31 bytes: char[32], always ending in a 0
        name: cpxWallName(w.name).slice(0, WALL_NAMELEN - 1), first: w.first, count: w.count, side: w.side,
        flags: (w.closed ? 1 : 0) | (w.noline ? 2 : 0), thickness: w.thickness, height: w.height,
      }))
      : [],
    points: nwalls > 0 ? points!.map((p) => ({ x: p.x, z: p.z, baseY: p.baseY, bend: p.bend, above: p.above, gap: p.gap ? 1 : 0 })) : [],
    courses: ncour > 0 ? cour!.map((c) => ({ course: c.course, flags: c.firstpass ? 1 : 0, thenCourse: c.thencourse })) : [],
  });
  return { ok: true, image };
}

// ---- reading the image back ----

export type CpxParseResult = { ok: true; parsed: CpxParsed } | { ok: false; error: string };

/**
  CpxParse on top of OpenPhotex readCpx, with Traxx's rules and messages in Traxx's order. Tolerant
  like the .WTR reader: unknown chunk ids are skipped and the first of a duplicate id wins. COUR is
  judged leniently (a defect sets courseBad and a note, never fails). WALL and WPNT are refused for
  the defects the builder refuses; a WPNT without a WALL is ignored. Whatever the rules need and
  cannot be had refuses the whole file. The error reads as the end of "not applied: <err>.".
  `bytes` null is an empty pod entry ("the file is empty").
*/
export function cpxParse(bytes: Uint8Array | null): CpxParseResult {
  const fail = (error: string): CpxParseResult => ({ ok: false, error: cpxFail(error) });
  if (bytes === null) return fail("the file is empty");
  const f: Cpx = readCpx(bytes);
  const has = (code: CpxErrorCode) => f.errors.find((e) => e.code === code) ?? null;
  const present = (id: string) => f.directory.some((e) => e.id === id);

  if (has("NOT_CPX")) return fail("it is not a race-rules file");
  if (has("NEWER_MAJOR")) return fail("it was written by a newer version of the tools");
  if (has("DIRECTORY_CUT")) return fail("its chunk directory is cut short");
  if (has("NO_RULE")) return fail("it has no RULE chunk");
  if (has("NO_CPBX")) return fail("it has no CPBX chunk");
  const rv = has("RULE_VERSION");
  if (rv) return fail(`its RULE chunk is version ${rv.value}, which this version does not know`);
  const cv = has("CPBX_VERSION");
  if (cv) return fail(`its CPBX chunk is version ${cv.value}, which this version does not know`);
  if (has("RULE_CUT") || !f.rule) return fail("its RULE chunk is cut short");
  if (has("CPBX_CUT")) return fail("its CPBX chunk is cut short");

  const { mode, laps } = f.rule;
  if (mode !== RACERULES_DRAG && mode !== RACERULES_PARALLEL && mode !== RACERULES_RACE) {
    return fail(`it asks for race mode ${mode}, which this version does not know`);
  }
  if (mode === RACERULES_RACE && (present("WALL") || present("WPNT"))) {
    return fail("a race with race rules cannot carry WALL or WPNT chunks (walls are not part of a race)");
  }
  const laperr = lapsError(mode, laps);
  if (laperr !== null) return fail(laperr);
  if (mode === RACERULES_RACE && (f.rule.timeoutMs !== 0 || f.rule.penaltyMs !== 0 || f.rule.rearmMs !== 0)) {
    return fail("a race with race rules must have no time-out and no wall penalty");
  }

  const bo = has("BOXES_OVER_CAP");
  if (bo) return fail(`it has ${bo.value} checkpoint boxes, more than the ${CPX_MAX_BOXES} allowed`);
  if (has("BOX_LIST_CUT") || !f.boxes) return fail("its checkpoint map is cut short");
  if (mode === RACERULES_RACE) {
    for (let i = 0; i < f.boxes.length; i++) {
      const r = f.boxes[i]!;
      if (r.split > CPX_SPLIT_ANY || r.lane !== 0 || (r.groundLine & 1) !== 0) {
        return fail(`a race with race rules has no lanes and draws no checkpoint lines, but checkpoint box ${i + 1} has one`);
      }
    }
  }

  const parsed: CpxParsed = { mode, laps, boxes: [], walls: [], points: [], courses: [], courseBad: false, courseNote: "" };

  // CpxParseWalls: WALL and WPNT (both present, or WALL absent and WPNT ignored).
  if (present("WALL")) {
    const wv = has("WALL_VERSION");
    if (wv) return fail(`its WALL chunk is version ${wv.value}, which this version does not know`);
    if (!present("WPNT")) return fail("it has a WALL chunk but no WPNT chunk");
    const pv = has("WPNT_VERSION");
    if (pv) return fail(`its WPNT chunk is version ${pv.value}, which this version does not know`);
    if (has("WALL_CUT")) return fail("its WALL chunk is cut short");
    if (has("WPNT_CUT")) return fail("its WPNT chunk is cut short");
    const wo = has("WALLS_OVER_CAP");
    if (wo) return fail(`it has ${wo.value} walls, more than the ${WALL_MAX_WALLS} allowed`);
    if (has("WALL_LIST_CUT") || !f.walls) return fail("its wall list is cut short");
    if (f.walls.length > 0) {
      const po = has("POINTS_OVER_CAP");
      if (po) return fail(`it has ${po.value} wall points, more than the ${WALL_MAX_EXPORT_TOTAL} allowed`);
      if (has("POINT_LIST_CUT") || !f.points) return fail("its wall point list is cut short");
      const wl: CpxWallIn[] = f.walls.map((w) => ({
        name: w.name, side: w.side, closed: w.flags & 1, noline: (w.flags >> 1) & 1,
        first: w.first | 0, count: w.count, thickness: w.thickness, height: w.height,
      }));
      const pl: WallExportPoint[] = f.points.map((p) => ({ x: p.x, z: p.z, baseY: p.baseY, bend: p.bend, above: p.above, gap: p.gap & 1 }));
      const werr = cpxCheckWalls(wl, wl.length, pl, pl.length);
      if (werr !== null) return fail(werr);
      parsed.walls = wl;
      parsed.points = pl;
    }
  }

  // CpxParseCour: a defect of any kind never fails the parse.
  if (present("COUR")) {
    let note: string | null = null;
    const ov = has("COUR_VERSION"), oc = has("COURSES_OVER_CAP");
    if (ov) note = cpxFail(`its COUR chunk is version ${ov.value}, which this version does not know`, 128);
    else if (has("COUR_CUT")) note = "its COUR chunk is cut short";
    else if (oc) note = cpxFail(`${oc.value} lead-ins, at most ${CPX_MAX_COURSES} courses exist`, 128);
    else if (has("COURSE_LIST_CUT") || !f.courses) note = "its COUR record list is cut short";
    else {
      // Reserved bytes and unknown flag bits are ignored on read.
      const c: CpxCourseIn[] = f.courses.map((r) => ({ course: r.course, firstpass: r.flags & 1, thencourse: r.thenCourse }));
      note = cpxCheckCour(c, false);
      if (note === null) parsed.courses = c.filter((r) => r.firstpass);
    }
    if (note !== null) {
      parsed.courses = [];
      parsed.courseBad = true;
      parsed.courseNote = note;
    }
  }

  parsed.boxes = f.boxes.map((r) => ({
    slot: r.slot, role: r.role, split: r.split, lane: r.lane, groundline: r.groundLine & 1, fpsi: r.psi, fx: r.x, fy: r.y, fz: r.z,
  }));
  return { ok: true, parsed };
}

// ---- applying a pod's .CPX (ApplyRaceRulesCpx) ----

/** What ApplyRaceRulesCpx decides; applied to a track by applyRaceRulesCpx. */
export interface CpxApplyDecision {
  ok: boolean;
  /** racerulesnote: "" for none. Set on a refusal, and on success when the lead-ins were dropped. */
  note: string;
  mode: number;
  laps: number;
  /** Per type-6 box in box order: its new checkpoint_seq, cp_split and cp_lane (empty on a refusal). */
  boxes: { seq: number; split: number; lane: number }[];
  /** The file's walls, every exported point an authored point; null leaves the track's walls alone. */
  walls: Wall[] | null;
  /** The lead-ins to set after ClearLeadIns, in file order (none in mode 3). */
  leadIns: { course: number; thenCourse: number }[];
}

/** _snprintf into racerulesnote[400]: at most 399 characters. */
function noteText(s: string): string {
  return s.length > 399 ? s.slice(0, 399) : s;
}

/**
  ApplyRaceRulesCpx's decision (TrackPODFile.cpp), all or nothing. The file counts only if it was
  written for these very boxes: the count of type-6 boxes and every record's fingerprint (16 on
  positions, 64 on psi, the heading wrapping) must match, and the map must pass the checks an
  export makes. Roles are re-derived from the slots, never trusted. Any failure applies nothing
  and the note is "Race rules (<name>) not applied: <why>.".
  `boxes` are the track's type-6 boxes in box order (gatherCpxBoxes); `bytes` null is an empty entry.
*/
export function decideRaceRulesCpx(bytes: Uint8Array | null, name: string | null, boxes: readonly CpxBoxIn[], trackType: number): CpxApplyDecision {
  const refused = (err: string): CpxApplyDecision => ({
    ok: false, note: noteText(`Race rules (${name ?? "WORLD\\.CPX"}) not applied: ${err || "the file could not be used"}.`),
    mode: RACERULES_NONE, laps: 0, boxes: [], walls: null, leadIns: [],
  });
  const res = cpxParse(bytes);
  if (!res.ok) return refused(res.error);
  const p = res.parsed;
  const cn = boxes.length;
  if (cn !== p.boxes.length) return refused(cpxFail(`the track has ${cn} checkpoint boxes and the file describes ${p.boxes.length}`));
  for (let i = 0; i < cn; i++) {
    const dx = Math.abs(cpxQuantPos(boxes[i]!.sitpos[0]) - p.boxes[i]!.fx);
    const dy = Math.abs(cpxQuantPos(boxes[i]!.sitpos[1]) - p.boxes[i]!.fy);
    const dz = Math.abs(cpxQuantPos(boxes[i]!.sitpos[2]) - p.boxes[i]!.fz);
    let dp = Math.abs(cpxQuantPsi(boxes[i]!.sitpsi) - p.boxes[i]!.fpsi);
    if (dp > 32768) dp = 65536 - dp;   // the heading wraps
    if (dx > 16 || dy > 16 || dz > 16 || dp > 64) {
      return refused(`checkpoint box ${i + 1} is not where the file says it was (the track was changed after the rules were written)`);
    }
  }
  if (cn === 0) return refused("the file describes no checkpoints");

  const cin = p.boxes.map((b) => ({ seq: b.slot, split: b.split, lane: b.lane }));
  const invalid = cpxValidate(p.mode, cin);
  if (invalid !== null) return refused(invalid);
  const { count: nslots, slot } = cpxRankSlots(cin);
  // As strict as the engine: the slots are contiguous from 0 and non-decreasing, and only per-lane splits carry a lane.
  for (let i = 0; i < cn; i++) {
    const b = p.boxes[i]!;
    if (b.slot !== slot[i] || (b.split !== CPX_SPLIT_LANE && b.lane !== 0)) return refused(`checkpoint box ${i + 1} has a slot or lane the engine would not accept`);
  }
  for (let i = 0; i < cn; i++) {
    if (p.boxes[i]!.role !== cpxRoleForSlot(p.mode, slot[i]!, nslots)) return refused(`checkpoint box ${i + 1} has a role that does not fit its place in the map`);
  }
  // Mode 3 (split checkpoints) belongs to a Circuit or Rally, whatever the .SIT says.
  if (p.mode === RACERULES_RACE && trackType !== TRACKTYPE_CIRCUIT && trackType !== TRACKTYPE_RALLY) {
    return refused("split checkpoints need a Circuit or Rally track type");
  }

  let note = "";
  // Mode 3 never carries lead-ins (Traxx writes none); a COUR from another tool is ignored, but the author is told.
  if (p.mode === RACERULES_RACE && p.courses.length > 0) note = "This pod's lead-ins (COUR) are not kept by Traxx on circuit/rally tracks.";
  if (p.courseBad && p.mode !== RACERULES_RACE) note = noteText(`Lead-ins (COUR) not applied: ${p.courseNote || "the chunk could not be used"}.`);

  let walls: Wall[] | null = null;
  if (p.walls.length > 0) {
    // AddWall per record, the fields copied; every EXPORTED point becomes an authored point (baseY is dropped).
    walls = p.walls.slice(0, WALL_MAX_WALLS).map((cw) => {
      const w = wallDefaults(cw.name);
      w.side = cw.side;
      w.closed = cw.closed ? 1 : 0;
      w.noline = cw.noline ? 1 : 0;
      w.thickness = cw.thickness;
      w.height = cw.height;
      for (let j = 0; j < cw.count && j < WALL_MAX_POINTS; j++) {
        const e = p.points[cw.first + j]!;
        w.points.push({ x: e.x, z: e.z, bend: e.bend, above: e.above, gap: e.gap ? 1 : 0 });
      }
      return w;
    });
  }

  return {
    ok: true, note, mode: p.mode, laps: p.laps, boxes: cin, walls,
    leadIns: p.mode !== RACERULES_RACE ? p.courses.map((c) => ({ course: c.course, thenCourse: c.thencourse })) : [],
  };
}

/** The part of a track the race-rules setters touch: the .SIT model's type and boxes. */
export interface RaceTrack {
  trackType: number;
  boxes: TraxxBox[];
}

/**
  ApplyRaceRulesCpx: decide, then on success set each type-6 box's seq / split / lane, SetRaceRules,
  ClearLeadIns and the file's lead-ins, and the file's walls (replacing the track's, in place) when
  it has any. Returns the decision; its note is what Traxx shows once after open.
*/
export function applyRaceRulesCpx(track: RaceTrack, rules: RaceRules, bytes: Uint8Array | null, name: string | null): CpxApplyDecision {
  const d = decideRaceRulesCpx(bytes, name, gatherCpxBoxes(track.boxes), track.trackType);
  if (!d.ok) return d;
  let k = 0;
  for (const b of track.boxes) {
    if (b.type !== TRAXX_BOX_CHECKPOINT || k >= d.boxes.length) continue;
    b.checkpointSeq = d.boxes[k]!.seq;
    b.cpSplit = d.boxes[k]!.split;
    b.cpLane = d.boxes[k]!.lane;
    k++;
  }
  setRaceRules(track, rules, d.mode, d.laps);
  clearLeadIns(rules);
  for (const l of d.leadIns) setLeadIn(rules, l.course, l.thenCourse);
  if (d.walls) {
    rules.walls.length = 0;
    rules.walls.push(...d.walls);
  }
  return d;
}

// ---- Write POD (CTrackPOD::Save's race-rules block) ----

export interface TrackCpxOptions {
  /** The track stem; the entry is WORLD\<PREFIX>.CPX. */
  prefix: string;
  /** The ground under the walls in feet (VegGroundHeight); null exports them at 0. */
  ground: WallGroundFn | null;
  /** The world's side in feet, cells * 32 (8192 by default). */
  worldFt?: number;
  /** sizeof(item[0].name): 32. */
  itemNameSize?: number;
}

export type TrackCpxBuild =
  | {
    ok: true;
    /** WORLD\<PREFIX>.CPX, upper case. */
    name: string;
    image: Uint8Array;
    /** cslot: the box[] indices of the type-6 boxes (the first 801). */
    slots: number[];
    /** corder: after the build, box[slots[k]] becomes the old box[slots[order[k]]]. */
    order: number[];
    /** The track type the .SIT must carry: DRAG for a drag, CIRCUIT for Parallel, the author's for mode 3. */
    trackType: number;
  }
  | { ok: false; message: string };

/**
  Save's race-rules block, before anything is written: gather the type-6 boxes in .SIT order, sort,
  export the walls (only in modes 1 and 2), gather the lead-ins (not in mode 3) and build. A
  refusal is the message Traxx boxes ("Race rules: <why>", caption "Cannot build the pod") and the
  export stops. Returns null when the rules are off (no .CPX). Nothing is changed:
  commitTrackCpx applies the box permutation and the track type once the pod is to be written.
*/
export function buildTrackCpx(track: RaceTrack, rules: RaceRules, opts: TrackCpxOptions): TrackCpxBuild | null {
  if (rules.mode === RACERULES_NONE) return null;
  const refuse = (err: string): TrackCpxBuild => ({ ok: false, message: `Race rules: ${err || "the .CPX could not be built"}` });
  const worldFt = opts.worldFt ?? 8192;
  const itemNameSize = opts.itemNameSize ?? POD_ITEM_NAME_SIZE;

  const cin = gatherCpxBoxes(track.boxes).slice(0, CPX_MAX_BOXES + 1);   // one over is all CpxValidate needs to say "too many"
  const slots: number[] = [];
  for (let k = 0; k < track.boxes.length && slots.length < cin.length; k++) if (track.boxes[k]!.type === TRAXX_BOX_CHECKPOINT) slots.push(k);
  const order = cpxSortForExport(cin);
  const name = `WORLD\\${opts.prefix}.CPX`.slice(0, itemNameSize - 1).toUpperCase();

  // WALLS: exported only with new-style drag or Parallel rules on; a wall over the per-wall cap, or one
  // that takes the total over the file's cap, refuses here by name. Other defects are CpxBuildEx's.
  const cwall: CpxWallIn[] = [];
  const cwpts: WallExportPoint[] = [];
  if (rules.walls.length > 0 && rules.mode !== RACERULES_RACE) {
    for (const wl of rules.walls) {
      const room = Math.min(WALL_MAX_EXPORT_TOTAL - cwpts.length, WALL_MAX_EXPORT_POINTS);
      const np = wl.points.length;
      if (np < 2) return refuse(cpxFail(`wall "${wl.name}": it has ${np} point(s), at least 2 are needed`));   // the authored count
      if (wl.closed && np < 3) return refuse(cpxFail(`wall "${wl.name}": a closed wall needs at least 3 points, it has ${np}`));
      const e = exportWall(wl, opts.ground, room);
      if (e.count < 0) {
        return refuse(cpxFail(room < WALL_MAX_EXPORT_POINTS
          ? `wall "${wl.name}" takes the walls over the ${WALL_MAX_EXPORT_TOTAL} points one pod can hold`
          : `wall "${wl.name}" needs more than ${WALL_MAX_EXPORT_POINTS} points; shorten it or split it`));
      }
      if (e.count < (wl.closed ? 3 : 2)) return refuse(cpxFail(`wall "${wl.name}" has fewer than ${wl.closed ? 3 : 2} distinct points`));
      if (pointsOutOfWorld(e.points, e.count, worldFt)) return refuse(cpxFail(`wall "${wl.name}" goes outside the world (0 to ${worldFt} ft)`));
      cwall.push({
        name: wl.name.slice(0, WALL_NAMELEN - 1), side: wl.side, closed: wl.closed, noline: wl.noline,
        thickness: wl.thickness, height: wl.height, first: cwpts.length, count: e.count,
      });
      cwpts.push(...e.points.slice(0, e.count));
    }
  }

  if (opts.prefix.length + "WORLD\\.CPX".length >= itemNameSize) return refuse("the track name does not fit a pod entry (WORLD\\<name>.CPX)");

  // Lead-ins (courses 2..4, first pass only); none in mode 3.
  const ccour: CpxCourseIn[] = [];
  for (let k = 2; k <= 4; k++) {
    if (rules.leadinThen[k]! >= 0 && rules.mode !== RACERULES_RACE) ccour.push({ course: k, firstpass: 1, thencourse: rules.leadinThen[k]! });
  }
  const built = cpxBuildEx(rules.mode, rules.laps, cin, cwall, cwpts, ccour);
  if (!built.ok) return refuse(built.error);

  // The .SIT trackType must agree with the .CPX mode; split checkpoints leave the author's Circuit or Rally.
  let trackType = track.trackType;
  if (rules.mode === RACERULES_DRAG) trackType = TRACKTYPE_DRAG;
  else if (rules.mode === RACERULES_PARALLEL) trackType = TRACKTYPE_CIRCUIT;
  return { ok: true, name, image: built.image, slots, order, trackType };
}

/** Save's last step of the block: permute the type-6 boxes among their slots into the sorted order and force the type. */
export function commitTrackCpx(track: RaceTrack, built: Extract<TrackCpxBuild, { ok: true }>): void {
  const moved = built.slots.map((_, k) => track.boxes[built.slots[built.order[k]!]!]!);
  built.slots.forEach((s, k) => { track.boxes[s] = moved[k]!; });
  track.trackType = built.trackType;
}

// ---- the model setters (TrackPOD/TrackPOD.cpp) ----

/**
  SetTrackType: 1..4 accepted. Split checkpoints (RACE) belong to a Circuit or Rally only: a type
  that is neither turns them off with the clean-up of switching the rules off (race_laps 1, every
  box loses its split and lane, the type-6 boxes are numbered one each again in the order they
  were in: CpxRenumber unique, their pointers reordered among the type-6 positions).
*/
export function setTrackType(track: RaceTrack, rules: RaceRules, type: number): void {
  if (type === TRACKTYPE_DRAG || type === TRACKTYPE_CIRCUIT || type === TRACKTYPE_RALLY || type === TRACKTYPE_RUMBLE) track.trackType = type;
  if (rules.mode === RACERULES_RACE && track.trackType !== TRACKTYPE_CIRCUIT && track.trackType !== TRACKTYPE_RALLY) {
    rules.mode = RACERULES_NONE;
    rules.laps = 1;
    const at: number[] = [];
    for (let b = 0; b < track.boxes.length; b++) {
      const box = track.boxes[b]!;
      box.cpSplit = CPX_SPLIT_NONE;
      box.cpLane = 0;
      if (box.type === TRAXX_BOX_CHECKPOINT) at.push(b);
    }
    if (at.length > 0) {
      const cps = at.map((b) => track.boxes[b]!);
      const { order, newseq } = cpxRenumber(cps.map((b) => b.checkpointSeq), cps.map(() => 0), true);
      at.forEach((b, k) => {
        track.boxes[b] = cps[order[k]!]!;
        track.boxes[b]!.checkpointSeq = newseq[k]!;
      });
    }
  }
}

/**
  SetRaceRules: an unknown mode is ignored, and so is RACE on a track that is not a Circuit or
  Rally. Parallel and RACE force laps 0, anything else not 0 / 1 becomes 1. DRAG makes the track a
  Drag, PARALLEL a Circuit; NONE and RACE leave the type.
*/
export function setRaceRules(track: RaceTrack, rules: RaceRules, mode: number, laps: number): void {
  if (mode !== RACERULES_NONE && mode !== RACERULES_DRAG && mode !== RACERULES_PARALLEL && mode !== RACERULES_RACE) return;
  if (mode === RACERULES_RACE && track.trackType !== TRACKTYPE_CIRCUIT && track.trackType !== TRACKTYPE_RALLY) return;
  if (mode === RACERULES_PARALLEL || mode === RACERULES_RACE) laps = 0;
  else if (laps !== 0 && laps !== 1) laps = 1;
  rules.mode = mode as RaceRulesMode;
  rules.laps = laps;
  if (mode === RACERULES_DRAG) track.trackType = TRACKTYPE_DRAG;
  else if (mode === RACERULES_PARALLEL) track.trackType = TRACKTYPE_CIRCUIT;
}

/**
  SetLeadIn: course 2..4 hands over to lane course `then` (0 or 1), or -1 for none. A lane has one
  lead-in: another course leading to the same lane loses it. 0 refused, 2 when one moved, else 1.
*/
export function setLeadIn(rules: RaceRules, course: number, then: number): number {
  if (course < 2 || course > 4) return 0;
  if (then !== -1 && then !== 0 && then !== 1) return 0;
  let moved = false;
  if (then >= 0) {
    for (let c = 2; c <= 4; c++) {
      if (c !== course && rules.leadinThen[c] === then) {
        rules.leadinThen[c] = -1;
        moved = true;
      }
    }
  }
  rules.leadinThen[course] = then;
  return moved ? 2 : 1;
}

/** GetLeadIn: -1 outside 2..4. */
export function getLeadIn(rules: RaceRules, course: number): number {
  if (course < 2 || course > 4) return -1;
  return rules.leadinThen[course]!;
}

/** HasLeadIns: any of courses 2..4 has one. */
export function hasLeadIns(rules: RaceRules): boolean {
  return rules.leadinThen[2] >= 0 || rules.leadinThen[3] >= 0 || rules.leadinThen[4] >= 0;
}

export function clearLeadIns(rules: RaceRules): void {
  for (let c = 0; c < 5; c++) rules.leadinThen[c] = -1;
}
