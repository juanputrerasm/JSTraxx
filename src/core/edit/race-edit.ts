/*
  The editor side of the race rules (Traxx 1.8.2, TraxxViewEdit.cpp, TraxxView.cpp, TraxxFrame.cpp,
  TraxxViewDisplay.cpp, ObjectPropertiesDlg.cpp): what the dialogs, the paste, Set Type and the
  overlay do with checkpoint copies, lanes and lead-ins. The model setters and the pure helpers
  (SetTrackType, SetRaceRules, SetLeadIn, CpxRenumber, CpxFreeLane, CpxFormatLabel...) are
  core/traxx/race-rules.ts; this is the view's half, ported 1:1.

    renumberCheckpoints   RenumberCheckpoints: the type-6 boxes sorted among their own positions
    countCheckpointSlots  CountCheckpointSlots
    resetRaceRulesOfBoxes ResetRaceRulesOfBoxes: rules switched off
    joinSlot              JoinSlot (static in TraxxViewEdit.cpp)
    makeMainRoute         MakeMainRoute (static in TraxxViewEdit.cpp)
    applyCheckpointRace   ApplyObjectProperties' checkpoint block, rules off and on
    objectRaceContext     ObjectDialogContext
    checkpointRolePreview CObjectPropertiesDlg::UpdateRaceRows' Role text
    pasteCheckpoint       OnObjectPaste's checkpoint block
    applyTrackRules       OnViewComponents' Type and race rules block
    courseLaneTrack, courseBarTexts, courseLines, pickLeadIn
                          CourseLaneTrack, RefreshCourseBar, OverlayCourse's passes, OnLeadIn
    checkpointRaceLabels, checkpointShowsArrow
                          OverlayCheckpoints' labels and its arrow rule

  JSTraxx keeps the boxes as a list, not Traxx's fixed array; box identity stands for Traxx's
  pointers, so a box found again after a renumber is found by identity (indexOf).
*/
import {
  CPX_MAX_BOXES, CPX_MAX_COPIES, CPX_MAX_SLOTS, TRACKTYPE_CIRCUIT, TRACKTYPE_DRAG, TRACKTYPE_RALLY, TRACKTYPE_RUMBLE,
  cpxFormatLabel, cpxFreeLane, cpxMainCopyIndex, cpxRankSlots, cpxRenumber, cpxRoleForSlot, getLeadIn, setLeadIn, setRaceRules, setTrackType,
  type RaceTrack,
} from "../traxx/race-rules.ts";
import { CPX_SPLIT_ANY, CPX_SPLIT_LANE, CPX_SPLIT_NONE, RACERULES_DRAG, RACERULES_NONE, RACERULES_PARALLEL, RACERULES_RACE, type RaceRules } from "../traxx/race-types.ts";
import type { TraxxBox } from "../traxx/sit.ts";
import { checkpointWantsArrow } from "../view/arrows.ts";

const CP = 6;

/** MaxCheckpointsText: "Max. 100 Checkpoints!", from CPX_MAX_SLOTS. */
export const MAX_CHECKPOINTS_TEXT = `Max. ${CPX_MAX_SLOTS} Checkpoints!`;
export const MAX_COPIES_TEXT = "Max. 8 copies of one checkpoint!";

/**
  RenumberCheckpoints: the type-6 boxes keep the positions they occupy; the boxes are re-sorted
  among those positions by (sequence, lane, where they were) and numbered: every box its own
  number (unique, the rules off) or the distinct numbers compacted to 0..k-1 (copies keep sharing
  one). Returns how many numbers there are. The caller carries its selection by identity.
*/
export function renumberCheckpoints(boxes: TraxxBox[], unique: boolean): number {
  const at: number[] = [];
  boxes.forEach((b, i) => { if (b.type === CP) at.push(i); });
  if (!at.length) return 0;
  const cps = at.map((i) => boxes[i]!);
  const { count, order, newseq } = cpxRenumber(cps.map((b) => b.checkpointSeq), cps.map((b) => b.cpLane), unique);
  at.forEach((pos, k) => {
    boxes[pos] = cps[order[k]!]!;
    boxes[pos]!.checkpointSeq = newseq[k]!;
  });
  return count;
}

/** CountCheckpointSlots: the distinct sequence numbers among the type-6 boxes. */
export function countCheckpointSlots(boxes: readonly TraxxBox[]): number {
  const seen = new Set<number>();
  for (const b of boxes) if (b.type === CP) seen.add(b.checkpointSeq);
  return seen.size;
}

/** The number of type-6 boxes. */
export function countCheckpointBoxes(boxes: readonly TraxxBox[]): number {
  let n = 0;
  for (const b of boxes) if (b.type === CP) n++;
  return n;
}

/**
  ResetRaceRulesOfBoxes: every box loses its split and lane, then the checkpoints are numbered
  one each again, in the order they were (copies become separate checkpoints). Traxx then clears
  the multi selection (ClearObjSel); the caller does.
*/
export function resetRaceRulesOfBoxes(boxes: TraxxBox[]): void {
  for (const b of boxes) {
    b.cpSplit = CPX_SPLIT_NONE;
    b.cpLane = 0;
  }
  renumberCheckpoints(boxes, true);
}

/**
  JoinSlot: `me` has just joined the slot of the other boxes on its number; the slot's split goes
  on every copy. A per-lane slot with one other copy that has no lane yet gives it the lane `me`
  did not take. `copies`: how many other boxes are on the number.
*/
export function joinSlot(boxes: readonly TraxxBox[], me: TraxxBox, copies: number): void {
  for (const other of boxes) {
    if (other === me || other.type !== CP || other.checkpointSeq !== me.checkpointSeq) continue;
    other.cpSplit = me.cpSplit;
    if (me.cpSplit === CPX_SPLIT_LANE && copies === 1 && other.cpLane !== 1 && other.cpLane !== 2) other.cpLane = 3 - me.cpLane;
    else if (me.cpSplit !== CPX_SPLIT_LANE) other.cpLane = 0;
  }
}

/**
  MakeMainRoute: move `me` ahead of the other copies of its slot (the first box of a slot is the
  main copy, the one the AI follows; only the order says it). The type-6 boxes keep their
  positions and the boxes are permuted among them; the slot's boxes before `me` slide down one
  place each. Returns the new index of `me`, or -1 (not a checkpoint, or the slot's boxes not
  contiguous: the order is left alone).
*/
export function makeMainRoute(boxes: TraxxBox[], me: TraxxBox | null): number {
  if (!me || me.type !== CP) return -1;
  const pos: number[] = [];
  boxes.forEach((b, i) => { if (b.type === CP) pos.push(i); });
  const cps = pos.map((i) => boxes[i]!);
  const mypos = cps.indexOf(me);
  const firstslot = cpxMainCopyIndex(cps.map((b) => b.checkpointSeq), me.checkpointSeq);
  if (mypos < 0 || firstslot < 0) return -1;
  let k = mypos;
  for (; k > firstslot; k--) {
    if (cps[k - 1]!.checkpointSeq === me.checkpointSeq) cps[k] = cps[k - 1]!;
    else break;
  }
  if (k !== firstslot) return -1;
  cps[firstslot] = me;
  pos.forEach((p, i) => { boxes[p] = cps[i]!; });
  return boxes.indexOf(me);
}

/** The race-rules part of the Object Properties fields (m_cpsplit, m_cplane, m_cpmain, m_cpmainedit). */
export interface CheckpointRaceFields {
  /** The Sequence box. */
  checkpoint: number;
  /** IDC_CPSPLIT's index: CPX_SPLIT_NONE / ANY / LANE. */
  cpSplit: number;
  /** IDC_CPLANE's index: 0 is lane 1, 1 is lane 2. */
  cpLane: number;
  /** "Main route (AI follows this one)" ticked. */
  cpMain: boolean;
  /** The tick was clicked since the last load (m_cpmainedit). */
  cpMainEdit: boolean;
}

/**
  ApplyObjectProperties' checkpoint block, for `me` (already type 6, its other fields applied).
  wascp / oldseq: whether it was a checkpoint before this Apply, and its number then (a box moving
  INTO a slot is told from one staying in it). Returns the messages (d->Say), in order.

  Rules off: the classic rule, every checkpoint its own number. The others at or above the typed
  number move up; over 100 the box becomes type 0 ("Max. 100 Checkpoints!"); renumbered unique.

  Rules on: the numbers are slots. A split other than None naming another checkpoint's number
  JOINS that slot and bumps nobody (JoinSlot); anything else takes the number and bumps the others.
  Caps: a new slot past 100, or a 9th copy, turns the box into type 0 with the message. Renumbered
  with copies sharing a number; then the main route: ticked, this copy goes first among its slot's
  copies; otherwise the slot's old main copy stays main (unticking alone does nothing).
*/
export function applyCheckpointRace(boxes: TraxxBox[], mode: number, me: TraxxBox, f: CheckpointRaceFields, wascp: boolean, oldseq: number): string[] {
  const messages: string[] = [];
  me.checkpointSeq = f.checkpoint;
  if (mode === RACERULES_NONE) {
    me.cpSplit = CPX_SPLIT_NONE;
    me.cpLane = 0;
    let seq = 1;
    for (const b of boxes) {
      if (b === me || b.type !== CP) continue;
      if (b.checkpointSeq >= me.checkpointSeq) b.checkpointSeq++;
      seq++;
    }
    if (seq > CPX_MAX_SLOTS) {
      me.type = 0;
      messages.push(MAX_CHECKPOINTS_TEXT);
    }
    renumberCheckpoints(boxes, true);
    return messages;
  }

  let split = f.cpSplit;
  if (split < CPX_SPLIT_NONE || split > CPX_SPLIT_LANE) split = CPX_SPLIT_NONE;
  if (mode === RACERULES_RACE && split === CPX_SPLIT_LANE) split = CPX_SPLIT_ANY;   // no per-lane copies on a circuit
  const lane = split === CPX_SPLIT_LANE ? f.cpLane + 1 : 0;
  let copies = 0;
  const others = new Set<number>();
  for (const b of boxes) {
    if (b === me || b.type !== CP) continue;
    if (b.checkpointSeq === me.checkpointSeq) copies++;
    others.add(b.checkpointSeq);
  }
  const slots = others.size;
  const join = split !== CPX_SPLIT_NONE && copies > 0;
  // The slot's main copy now (the first box in order), so joining it never changes the main route.
  let prevmain: TraxxBox | null = null;
  if (join) {
    prevmain = boxes.find((b) => b.type === CP && b.checkpointSeq === me.checkpointSeq && (b !== me || (wascp && oldseq === me.checkpointSeq))) ?? null;
  }
  if (!join && slots + 1 > CPX_MAX_SLOTS) {
    me.type = 0;
    messages.push(MAX_CHECKPOINTS_TEXT);
  } else if (join && copies + 1 > CPX_MAX_COPIES) {
    me.type = 0;
    messages.push(MAX_COPIES_TEXT);
  } else {
    me.cpSplit = split;
    me.cpLane = lane;
    if (join) joinSlot(boxes, me, copies);
    else for (const b of boxes) if (b !== me && b.type === CP && b.checkpointSeq >= me.checkpointSeq) b.checkpointSeq++;
  }
  if (me.type !== CP) {
    me.cpSplit = CPX_SPLIT_NONE;
    me.cpLane = 0;
  }
  renumberCheckpoints(boxes, false);
  if (f.cpMainEdit && f.cpMain && me.type === CP && me.cpSplit === CPX_SPLIT_ANY) makeMainRoute(boxes, me);
  else if (prevmain && me.type === CP && me.cpSplit === CPX_SPLIT_ANY) makeMainRoute(boxes, prevmain);
  return messages;
}

/** ObjectDialogContext: the race rules and the OTHER checkpoints' numbers, and the Main route tick. */
export interface ObjectRaceContext {
  mode: number;
  /** The other type-6 boxes' numbers, in box order (at most CPX_MAX_BOXES). */
  othersSeq: number[];
  /** The box sits in an any-copy slot of 2+ copies: the tick is offered (cpmainavail). */
  mainAvail: boolean;
  /** ...and it is the slot's first box (m_cpmain). */
  main: boolean;
}

export function objectRaceContext(boxes: readonly TraxxBox[], mode: number, box: TraxxBox): ObjectRaceContext {
  const othersSeq: number[] = [];
  for (const b of boxes) if (b !== box && b.type === CP && othersSeq.length < CPX_MAX_BOXES) othersSeq.push(b.checkpointSeq);
  let mainAvail = false, main = false;
  if (mode !== RACERULES_NONE && box.type === CP && box.cpSplit === CPX_SPLIT_ANY) {
    const seqs: number[] = [];
    let copies = 0, mine = -1;
    for (const b of boxes) {
      if (b.type !== CP) continue;
      if (b === box) mine = seqs.length;
      if (b.checkpointSeq === box.checkpointSeq) copies++;
      seqs.push(b.checkpointSeq);
    }
    mainAvail = copies >= 2;
    main = mainAvail && mine >= 0 && cpxMainCopyIndex(seqs, box.checkpointSeq) === mine;
  }
  return { mode, othersSeq, mainAvail, main };
}

/** The Role names, by CPX_ROLE_* (UpdateRaceRows). */
export const CP_ROLE_NAMES = ["", "Pre-stage", "Stage", "Launch", "Finish", "Gate"] as const;

/** GetDlgItemInt(..., TRUE): a signed whole number, or null when the box does not read as one. */
export function dlgItemInt(text: string): number | null {
  if (!/^\s*[-+]?\d+\s*$/.test(text)) return null;
  return Math.trunc(Number(text));
}

/**
  UpdateRaceRows' Role: what the checkpoint WOULD be for the Sequence typed, which is what Apply
  will do with it. Its rank is the count of distinct other numbers below the typed one; a split
  other than None on a number in use joins that slot and adds none. "" when the box does not read
  as a number.
*/
export function checkpointRolePreview(mode: number, othersSeq: readonly number[], typed: number | null, split: number): string {
  if (typed === null) return "";
  if (split < CPX_SPLIT_NONE || split > CPX_SPLIT_LANE) split = CPX_SPLIT_NONE;
  let below = 0, distinct = 0, join = false;
  const seen = new Set<number>();
  for (const s of othersSeq) {
    if (seen.has(s)) continue;
    seen.add(s);
    distinct++;
    if (s < typed) below++;
    else if (s === typed) join = split !== CPX_SPLIT_NONE;
  }
  const total = distinct + (join ? 0 : 1);
  const role = cpxRoleForSlot(mode, below, total);
  return `${CP_ROLE_NAMES[role]} (checkpoint ${below + 1} of ${total})`;
}

/**
  OnObjectPaste's checkpoint block, for the pasted box (a copy of the clipboard's, its seq, split and
  lane kept). In RACE a per-lane split becomes any-copy. Without race rules, or with split None, it is
  a checkpoint of its own, last in the order; with a split it keeps its number and joins that slot
  (on a per-lane join it takes the free lane, CpxFreeLane). The caps: rules off and over 100
  checkpoints, a 9th copy, a new slot past 100; any of them turns the box into type 0. Then
  renumbered (unique with the rules off); for an any-copy join the old main copy stays main.
  Returns the message, or null.
*/
export function pasteCheckpoint(boxes: TraxxBox[], mode: number, pasted: TraxxBox): string | null {
  if (pasted.type !== CP) return null;
  let message: string | null = null;
  if (mode === RACERULES_RACE && pasted.cpSplit === CPX_SPLIT_LANE) {
    pasted.cpSplit = CPX_SPLIT_ANY;
    pasted.cpLane = 0;
  }
  const own = mode === RACERULES_NONE || pasted.cpSplit === CPX_SPLIT_NONE;
  let copies = 0;
  let prevmain: TraxxBox | null = null;
  if (own) {
    pasted.checkpointSeq = 1000;
    pasted.cpSplit = CPX_SPLIT_NONE;
    pasted.cpLane = 0;
  } else {
    for (const b of boxes) {
      if (b === pasted || b.type !== CP || b.checkpointSeq !== pasted.checkpointSeq) continue;
      prevmain ??= b;   // the slot's main copy: the first one, the pasted box excluded
      copies++;
    }
  }
  if (mode === RACERULES_NONE) {
    if (countCheckpointBoxes(boxes) > CPX_MAX_SLOTS) { message = MAX_CHECKPOINTS_TEXT; pasted.type = 0; }
  } else if (copies + 1 > CPX_MAX_COPIES) {
    message = MAX_COPIES_TEXT;
    pasted.type = 0;
  } else if (copies === 0 && countCheckpointSlots(boxes) > CPX_MAX_SLOTS) {
    message = MAX_CHECKPOINTS_TEXT;
    pasted.type = 0;
  }
  if (pasted.type === CP) {
    if (!own && copies > 0) {
      // Copy a lane-1 box and paste: the copy takes the free lane, so it comes out as lane 2.
      if (pasted.cpSplit === CPX_SPLIT_LANE) {
        const lanes: number[] = [];
        for (const b of boxes) {
          if (lanes.length >= CPX_MAX_COPIES) break;
          if (b !== pasted && b.type === CP && b.checkpointSeq === pasted.checkpointSeq) lanes.push(b.cpLane);
        }
        pasted.cpLane = cpxFreeLane(lanes, pasted.cpLane);
      }
      joinSlot(boxes, pasted, copies);
    }
    renumberCheckpoints(boxes, mode === RACERULES_NONE);
    // The pasted box may sit earlier than the slot's copies: the old main stays main.
    if (prevmain && copies > 0 && pasted.cpSplit === CPX_SPLIT_ANY) makeMainRoute(boxes, prevmain);
  } else {
    pasted.cpSplit = CPX_SPLIT_NONE;
    pasted.cpLane = 0;
  }
  return message;
}

/** The Track Components choice of type and rules (m_tracktype 0..4, m_racerules, m_splitcp, m_looped). */
export interface TrackRulesChoice {
  /** 0 Circuit, 1 Rally, 2 Rumble, 3 Drag, 4 Parallel. */
  typeIndex: number;
  /** "New-style drag (race rules)". */
  newDrag: boolean;
  /** "Split checkpoints (new builds only)". */
  splitCp: boolean;
  /** "Looped course (laps chosen in the game menu)". */
  looped: boolean;
}

/** The radio order's track types (Circuit, Rally, Rumble, Drag); Parallel is a Circuit with the rules. */
const RADIO_TYPES = [TRACKTYPE_CIRCUIT, TRACKTYPE_RALLY, TRACKTYPE_RUMBLE, TRACKTYPE_DRAG];

/** OnViewComponents' fill: the radios and tickboxes for a track. */
export function trackRulesChoiceOf(trackType: number, rules: RaceRules): TrackRulesChoice {
  let typeIndex = Math.max(0, RADIO_TYPES.indexOf(trackType));
  let newDrag = false;
  if (rules.mode === RACERULES_PARALLEL) typeIndex = 4;
  else if (rules.mode === RACERULES_DRAG) { typeIndex = 3; newDrag = true; }
  return { typeIndex, newDrag, splitCp: rules.mode === RACERULES_RACE, looped: rules.mode === RACERULES_DRAG && rules.laps === 0 };
}

/**
  CTraxxComponentsDlg::UpdateRaceRows: Circuit or Rally shows Split checkpoints (enabled) where
  New-style drag is; any other type shows New-style drag, enabled only with Drag; Looped is enabled
  only for Drag with New-style drag; nothing is enabled view-only.
*/
export function componentsRaceRows(typeIndex: number, newDrag: boolean, viewOnly: boolean): { splitShown: boolean; splitEnabled: boolean; dragShown: boolean; dragEnabled: boolean; loopedEnabled: boolean } {
  const drag = typeIndex === 3;
  const circuit = typeIndex === 0 || typeIndex === 1;
  return { splitShown: circuit, splitEnabled: circuit && !viewOnly, dragShown: !circuit, dragEnabled: drag && !viewOnly, loopedEnabled: drag && newDrag && !viewOnly };
}

/**
  OnViewComponents' OK for the Type and the rules. Parallel and a new-style drag are race rules and
  SetRaceRules sets the type itself (an any-copy split survives); every other choice is
  SetTrackType then SetRaceRules (split checkpoints, or the rules off). Going into RACE, every
  per-lane box becomes any-copy. Rules going off: ResetRaceRulesOfBoxes, and when the boxes are
  then over 100 the note. `wallsGo`: the rules are no longer DRAG or PARALLEL (an open Wall window
  closes as OK); `rulesOff`: the boxes were reset (Traxx clears the multi selection).
*/
export function applyTrackRules(track: RaceTrack, rules: RaceRules, c: TrackRulesChoice): { note: string | null; wallsGo: boolean; rulesOff: boolean } {
  const oldrules = rules.mode;
  let newrules = RACERULES_NONE;
  if (c.typeIndex === 4) newrules = RACERULES_PARALLEL;
  else if (c.typeIndex === 3 && c.newDrag) newrules = RACERULES_DRAG;
  else if ((c.typeIndex === 0 || c.typeIndex === 1) && c.splitCp) newrules = RACERULES_RACE;
  if (newrules === RACERULES_DRAG || newrules === RACERULES_PARALLEL) {
    setRaceRules(track, rules, newrules, newrules === RACERULES_DRAG && c.looped ? 0 : 1);
  } else {
    const type = RADIO_TYPES[c.typeIndex];
    if (type !== undefined) setTrackType(track, rules, type);
    setRaceRules(track, rules, newrules, 1);
  }
  if (newrules === RACERULES_RACE && oldrules !== RACERULES_RACE) {
    for (const b of track.boxes) if (b.cpSplit === CPX_SPLIT_LANE) { b.cpSplit = CPX_SPLIT_ANY; b.cpLane = 0; }
  }
  let note: string | null = null;
  const rulesOff = oldrules !== RACERULES_NONE && newrules === RACERULES_NONE;
  if (rulesOff) {
    resetRaceRulesOfBoxes(track.boxes);
    const ncp = countCheckpointBoxes(track.boxes);
    if (ncp > CPX_MAX_SLOTS) note = `The track has ${ncp} checkpoints, over the ${CPX_MAX_SLOTS} the game can hold. Write POD will refuse until some are removed.`;
  }
  return { note, wallsGo: newrules !== RACERULES_DRAG && newrules !== RACERULES_PARALLEL, rulesOff };
}

// ---- Courses (TraxxView.h CourseLaneTrack, TraxxFrame.cpp RefreshCourseBar / OnLeadIn, OverlayCourse) ----

/** CourseLaneTrack: a drag (old or new style) or a Parallel track; course 0 is Lane 1 and course 1 Lane 2. */
export function courseLaneTrack(trackType: number, mode: number): boolean {
  return trackType === TRACKTYPE_DRAG || mode === RACERULES_PARALLEL;
}

/** RefreshCourseBar's texts: the five radios and the tickbox. */
export function courseBarTexts(lanes: boolean): { radios: string[]; always: string } {
  return {
    radios: [lanes ? "Lane 1" : "Main (0)", lanes ? "Lane 2" : "1", "2", "3", "4"],
    always: lanes ? "Always show lanes" : "Always show main",
  };
}

/** COURSE_LANE2_INDEX: Lane 2 is drawn in the track's own palette entry 253 (the game's map colour). */
export const COURSE_LANE2_INDEX = 253;
/** COURSE_LANE_SELECTED: the selected extra line on a lane track. */
export const COURSE_LANE_SELECTED: readonly [number, number, number] = [0, 200, 0];

/** One pass of OverlayCourse / DrawCourseMarkers. */
export interface CourseLine {
  /** The course drawn: 0 main (Lane 1), 1..4 the extended courses. */
  which: number;
  colour: "main" | "lane2" | "selected" | "magenta";
  /** The cyan joins are drawn (course 0, and Lane 2 on a lane track). */
  joins: boolean;
  /** The line's name under its first segment's index: "Lane 1", "Lane 2", "Lead-in -> Lane N" or "". */
  label: string;
}

/**
  OverlayCourse's passes. Lane tracks: Lane 1 (red) and Lane 2 (palette 253), both while "Always
  show lanes" is ticked, else the selected one only; the selected extra line 2..4 green, named
  "Lead-in -> Lane %d%s" when it is a lead-in (" (rules off)" when the rules are NONE or RACE).
  Other tracks: the main red (when selected or "Always show main") and the selected extra magenta.
*/
export function courseLines(trackType: number, rules: RaceRules, whichcourse: number, always: boolean): CourseLine[] {
  const lanes = courseLaneTrack(trackType, rules.mode);
  const out: CourseLine[] = [];
  if (lanes) {
    if (always || whichcourse === 0) out.push({ which: 0, colour: "main", joins: true, label: "Lane 1" });
    if (always || whichcourse === 1) out.push({ which: 1, colour: "lane2", joins: true, label: "Lane 2" });
    if (whichcourse >= 2) {
      const lead = getLeadIn(rules, whichcourse);
      const off = rules.mode === RACERULES_NONE || rules.mode === RACERULES_RACE;
      out.push({ which: whichcourse, colour: "selected", joins: false, label: lead >= 0 ? `Lead-in -> Lane ${lead + 1}${off ? " (rules off)" : ""}` : "" });
    }
  } else {
    if (!(whichcourse > 0 && !always)) out.push({ which: 0, colour: "main", joins: true, label: "" });
    if (whichcourse >= 1) out.push({ which: whichcourse, colour: "magenta", joins: false, label: "" });
  }
  return out;
}

/**
  OnLeadIn: course 2..4 leads to Lane 1, Lane 2 or nothing (`cur` is the combo's index: 0 None, 1
  Lane 1, 2 Lane 2). Without new-style drag or Parallel only None is taken (to clear a stale
  lead-in). Returns whether the rules changed and the status text.
*/
export function pickLeadIn(rules: RaceRules, course: number, cur: number): { changed: boolean; status: string } {
  if (cur < 0 || course < 2 || cur - 1 === getLeadIn(rules, course)) return { changed: false, status: "" };
  if (rules.mode !== RACERULES_DRAG && rules.mode !== RACERULES_PARALLEL && cur !== 0) return { changed: false, status: "Lead-ins need new-style drag or Parallel race rules." };
  const result = setLeadIn(rules, course, cur - 1);
  if (result === 0) return { changed: false, status: "" };
  return { changed: true, status: result === 2 ? `Lane ${cur}'s lead-in moved here from another course.` : "" };
}

// ---- The checkpoint overlay (OverlayCheckpoints) ----

/**
  The labels of the type-6 boxes in box order with the rules on: CpxFormatLabel of the ranked slot
  and its role, with "*" on the main copy of an any-copy slot of 2+ copies (the first in box
  order), if it fits the 16-byte buffer. Null with the rules off ("CP %02d" by box count).
*/
export function checkpointRaceLabels(boxes: readonly TraxxBox[], mode: number): string[] | null {
  if (mode === RACERULES_NONE) return null;
  const cps = boxes.filter((b) => b.type === CP).slice(0, CPX_MAX_BOXES);
  const { count, slot } = cpxRankSlots(cps.map((b) => ({ seq: b.checkpointSeq })));
  const cnt = new Array<number>(count).fill(0), first = new Array<number>(count).fill(-1);
  slot.forEach((s, k) => { cnt[s]!++; if (first[s]! < 0) first[s] = k; });
  return cps.map((b, k) => {
    const s = slot[k]!;
    let label = cpxFormatLabel(s, cpxRoleForSlot(mode, s, count), b.cpSplit, b.cpLane, 16);
    if (cnt[s]! >= 2 && first[s] === k && b.cpSplit === CPX_SPLIT_ANY && label.length < 15) label += "*";
    return label;
  });
}

/** OverlayCheckpoints' arrow: a model-less checkpoint, with the rules on, or by CheckpointWantsArrow (Rumble none, Drag the first four). */
export function checkpointShowsArrow(trackType: number, mode: number, n: number): boolean {
  return mode !== RACERULES_NONE || checkpointWantsArrow(trackType, n);
}
