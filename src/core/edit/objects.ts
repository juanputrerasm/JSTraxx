/*
  Object editing (Traxx/TraxxViewEdit.cpp, Object editing). Objects are TraxxBoxes: x, y in
  ipos with 1/256 fractions, z in whole steps with its fraction, angles in radians.

  Traxx keeps objects in a fixed array with free slots and fills the first free one on insert;
  JSTraxx keeps a list, so a new object goes at the end.
*/
import type { TrackDocument } from "../doc/document.ts";
import type { TxxTrack } from "../traxx/txx.ts";
import { traxxBoxDefaults, traxxSignedSplit, TRAXX_BOX_CRUSH, TRAXX_BOX_FOG, TRAXX_BOX_LIGHT, TRAXX_BOX_RAMP, TRAXX_MAX_FOGS, type TraxxBox } from "../traxx/sit.ts";
import { boxHeightPairLoad, boxHeightPairStore, surfaceTrack, type Ground } from "../traxx/box-ground.ts";
import { heightLimit, tallHeights, type HasTrackKind } from "../traxx/track-kind.ts";
import { countCheckpointSlots, pasteCheckpoint, renumberCheckpoints } from "./race-edit.ts";
import { CPX_SPLIT_NONE, RACERULES_NONE } from "../traxx/race-types.ts";
import { CPX_MAX_SLOTS } from "../traxx/race-rules.ts";

export const MAX_OBJECTS = 4096;
export const TYPE_TRAIN = 10;
export const TYPE_MOVING = 13;
export const CHECKPOINT = 6;

/*
  The Type list (IDC_TYPECOMBO, ObjectPropertiesDlg.h): indices 0..14 are the engine's box types
  (Traxx 1.7 added Fog at 14), then Ramp and Top-Crush, pushed from 14/15 to 15/16.
*/
export const OBJECT_TYPE_NAMES = ["Default", "Sign", "Barricade", "Tree", "Cone", "Vehicle", "Checkpoint", "No collide", "No collide (facing)", "Collide (facing)", "Train", "Post", "Light", "Moving", "Fog", "Ramp", "Top-Crush"];
export const TYPEIDX_FOG = 14;
export const TYPEIDX_RAMP = 15;
export const TYPEIDX_CRUSH = 16;

export function typeToIndex(type: number): number {
  if (type === TRAXX_BOX_RAMP) return TYPEIDX_RAMP;
  if (type === TRAXX_BOX_CRUSH) return TYPEIDX_CRUSH;
  return type < 0 || type > TYPEIDX_FOG ? 0 : type;
}

export function indexToType(index: number): number {
  if (index === TYPEIDX_RAMP) return TRAXX_BOX_RAMP;
  if (index === TYPEIDX_CRUSH) return TRAXX_BOX_CRUSH;
  return index < 0 || index > TYPEIDX_FOG ? 0 : index;
}

const moves = (t: number) => t === TYPE_TRAIN || t === TYPE_MOVING;

/* The engine's budgets (BoxTypeBudgetGroup / Cap): 100 checkpoints (CPX_MAX_SLOTS, Traxx 1.8.2; it was 20), 100 ramps, 100 top crush, 100 Train + Moving together, 100 lights, 64 fogs (Traxx 1.8.0). */
export function budgetGroup(type: number): number {
  if (type === CHECKPOINT) return 1;
  if (type === TRAXX_BOX_RAMP) return 2;
  if (type === TRAXX_BOX_CRUSH) return 3;
  if (moves(type)) return 4;
  if (type === TRAXX_BOX_LIGHT) return 5;
  if (type === TRAXX_BOX_FOG) return 6;
  return 0;
}

/** A group's cap; `max` the document's object limit (v6.ts objectLimit: 4096, or 16,384 for version 6). */
export function budgetCap(group: number, max = MAX_OBJECTS): number {
  return [max, CPX_MAX_SLOTS, 100, 100, 100, 100, TRAXX_MAX_FOGS][group] ?? max;
}

/**
  OnObjectInsert: a default box on the ground point (whole ipos, steps truncated). Null when the
  track is full: `max` objects (MAXNPODBOXES, or 16,384 for a version 6 document, v6.ts objectLimit). Traxx 1.7 (b100b6b, 0acc316): on a 16-bit, Spline or Full Map track the pick's
  z is ignored; the box takes the pick's x / y fractions and is seated on the drive surface
  (BoxHeightPairStore, its pair 0 above).
*/
export function insertObject(track: TxxTrack, at: [number, number, number], fraction: readonly [number, number, number] = [0, 0, 0], max = MAX_OBJECTS): number | null {
  if (track.boxes.length >= max) return null;
  const box = traxxBoxDefaults();
  box.ipos = [Math.trunc(at[0]), Math.trunc(at[1]), Math.trunc(at[2]) + box.heightAboveGround];
  if (surfaceTrack(track)) {
    box.fraction[0] = fraction[0];
    box.fraction[1] = fraction[1];
    boxHeightPairStore(track, box);
  }
  track.boxes.push(box);
  return track.boxes.length - 1;
}

/** OnObjectDelete. Returns a map from old to new index (-1 for deleted), for the selection. */
export function deleteObjects(track: TxxTrack, indices: readonly number[]): (i: number) => number {
  const gone = new Set(indices);
  const newIndex: number[] = [];
  let n = 0;
  track.boxes.forEach((_, i) => { newIndex[i] = gone.has(i) ? -1 : n++; });
  track.boxes = track.boxes.filter((_, i) => !gone.has(i));
  return (i) => newIndex[i] ?? -1;
}

const TWO_PI = Math.fround(2 * Math.fround(Math.PI));

/** ObjectRotate: psi by hundredths of a degree, kept in 0..2 pi. */
export function rotateObjects(boxes: TraxxBox[], hundredths: number): void {
  const inc = Math.fround(Math.fround(Math.fround(Math.PI) * Math.fround(hundredths / 100)) / 180);
  for (const b of boxes) {
    b.psi = Math.fround(b.psi + inc);
    while (b.psi < 0) b.psi = Math.fround(b.psi + TWO_PI);
    while (b.psi > TWO_PI) b.psi = Math.fround(b.psi - TWO_PI);
  }
}

/*
  ObjectMove: x and y in thousandths of an ipos, through the same split the dialog uses (never
  below 0), each object kept at its height above the ground (the pair taken where it was on the
  drive surface, BoxHeightPairLoad, then seated where it lands, BoxHeightPairStore).
*/
export function moveObjects(boxes: TraxxBox[], ground: Ground, dx: number, dy: number): void {
  for (const b of boxes) {
    boxHeightPairLoad(ground, b);
    const px = Math.max(0, b.ipos[0] + b.fraction[0] / 256 + dx / 1000);
    const py = Math.max(0, b.ipos[1] + b.fraction[1] / 256 + dy / 1000);
    [b.ipos[0], b.fraction[0]] = traxxSignedSplit(px);
    [b.ipos[1], b.fraction[1]] = traxxSignedSplit(py);
    boxHeightPairStore(ground, b);
  }
}

/** ObjectSize: width and length at least 1, height at least 0. */
export function sizeObjects(boxes: TraxxBox[], x: number, y: number, z: number): void {
  for (const b of boxes) {
    b.width = Math.max(1, b.width + x);
    b.length = Math.max(1, b.length + y);
    b.height = Math.max(0, b.height + z);
  }
}

/** ObjectTilt: phi (pitch) and theta (heading tilt) by hundredths of a degree, in 0..360. */
export function tiltObjects(boxes: TraxxBox[], pitch: number, heading: number): void {
  const wrap = (d: number) => (d < 0 ? 360 + d : d >= 360 ? d - 360 : d);
  for (const b of boxes) {
    const p = wrap(Math.floor(((b.phi * 180) / Math.PI) * 100000 + 0.5) / 100000 + pitch / 100);
    const h = wrap(Math.floor(((b.theta * 180) / Math.PI) * 100000 + 0.5) / 100000 + heading / 100);
    b.phi = Math.fround((Math.PI * p) / 180);
    b.theta = Math.fround((Math.PI * h) / 180);
  }
}

/**
  CTraxxView::ObjectHeightCap (TraxxView.cpp): an object's height above ground tops out at 500
  steps, or at the terrain's ceiling (GetHeightLimit / 256) on a Tall Heights V6 track.
*/
export function objectHeightCap(t: HasTrackKind | Ground): number {
  if (t instanceof Uint8Array) return 500;
  const k = t as HasTrackKind;
  return tallHeights(k) ? Math.trunc(heightLimit(k) / 256) : 500;
}

/** ObjectRaise: the height above the ground by hundredths of a step, at most ObjectHeightCap steps. */
export function raiseObjects(boxes: TraxxBox[], ground: Ground, hundredths: number, cap = objectHeightCap(ground)): void {
  const inc = Math.trunc(Math.fround(256 * Math.fround(hundredths / 100)));
  for (const b of boxes) {
    boxHeightPairLoad(ground, b);
    b.heightAboveGround += Math.trunc(inc / 256);
    b.fraction[2] += inc % 256;
    if (b.fraction[2] >= 256) { b.heightAboveGround++; b.fraction[2] -= 256; }
    if (b.fraction[2] < 0) { b.heightAboveGround--; b.fraction[2] += 256; }
    if (b.heightAboveGround >= cap) { b.heightAboveGround = cap; b.fraction[2] = 0; }
    boxHeightPairStore(ground, b);
  }
}

/*
  Dragging (OnMouseMove, objects mode): the anchor to the ground point at its height above the
  ground (its fractions kept), the rest of the selection by the same amount, each at its own
  height above the ground where it lands. Traxx 1.7 (b100b6b, e4e034d, 0acc316): on the drive
  surface each box's pair is taken where it was (BoxHeightPairLoad), the anchor takes the pick's
  x / y fractions, the pick's z is ignored, and each is seated where it lands (BoxHeightPairStore).
*/
export function dragObjects(track: TxxTrack, selected: readonly number[], at: [number, number, number], fraction: readonly [number, number, number] = [0, 0, 0]): void {
  const anchor = track.boxes[selected[0]];
  if (!anchor) return;
  const cx = Math.trunc(at[0]), cy = Math.trunc(at[1]);
  const dx = cx - anchor.ipos[0], dy = cy - anchor.ipos[1];
  const cz = Math.trunc(at[2]) + anchor.heightAboveGround;
  boxHeightPairLoad(track, anchor);
  anchor.ipos = [cx, cy, cz];
  if (surfaceTrack(track)) {
    anchor.fraction[0] = fraction[0];
    anchor.fraction[1] = fraction[1];
    boxHeightPairStore(track, anchor);
  }
  if (!dx && !dy) return;
  for (const i of selected.slice(1)) {
    const b = track.boxes[i];
    boxHeightPairLoad(track, b);
    b.ipos[0] = Math.max(0, b.ipos[0] + dx);
    b.ipos[1] = Math.max(0, b.ipos[1] + dy);
    boxHeightPairStore(track, b);
  }
}

/** Shift-drag: each selected object turned about its own spot, about half a degree a pixel. */
export function dragRotate(boxes: TraxxBox[], dxPixels: number): void {
  for (const b of boxes) b.psi = Math.fround(b.psi + Math.fround(0.008 * dxPixels));
}

/* ApplyBoxTypeIndex. */
export function applyTypeIndex(box: TraxxBox, index: number): void {
  if (index === TYPEIDX_RAMP) {
    // Only when the type changes: turning something into a ramp takes its model off.
    if (box.type !== TRAXX_BOX_RAMP) { box.modelName = ""; box.crushName = ""; }
    box.type = TRAXX_BOX_RAMP;
  } else if (index === TYPEIDX_CRUSH) box.type = TRAXX_BOX_CRUSH;
  else { box.crushName = ""; box.type = indexToType(index); }
}

/*
  SetTypeOfObjects: the type at `index` onto the selected objects (anchor first), within the
  type's budget; returns how many were refused, and the reordered selection. Traxx 1.8.2: the
  checkpoint cap is 100, counted in SLOTS with the race rules on (copies share one) and in boxes
  with them off; a box made a checkpoint takes a slot of its own after every existing one (1000 +
  its place in the selection, split None, no lane), one leaving type 6 loses its split and lane;
  when checkpoints come or go they are renumbered (RenumberCheckpoints: one number each with the
  rules off, copies sharing one with them on).
*/
export function setTypeOfObjects(track: TxxTrack, selected: readonly number[], index: number): { refused: number; group: number; selection: number[] } {
  const newType = indexToType(index);
  const group = budgetGroup(newType);
  const mode = track.raceRules?.mode ?? RACERULES_NONE;
  let room = budgetCap(group);
  if (group === 1 && mode !== RACERULES_NONE) room -= countCheckpointSlots(track.boxes);
  else if (group) for (const b of track.boxes) if (budgetGroup(b.type) === group) room--;
  let refused = 0, checkpoints = false;
  const chosen = selected.map((i) => track.boxes[i]);
  chosen.forEach((box, i) => {
    if (group && budgetGroup(box.type) !== group) {
      if (room <= 0) { refused++; return; }
      room--;
    }
    if ((box.type === CHECKPOINT) !== (newType === CHECKPOINT)) checkpoints = true;
    if (box.type === CHECKPOINT && newType !== CHECKPOINT) { box.cpSplit = CPX_SPLIT_NONE; box.cpLane = 0; }
    if (newType === CHECKPOINT && box.type !== CHECKPOINT) { box.checkpointSeq = 1000 + i; box.cpSplit = CPX_SPLIT_NONE; box.cpLane = 0; }
    applyTypeIndex(box, index);
  });
  if (checkpoints) renumberCheckpoints(track.boxes, mode === RACERULES_NONE);
  return { refused, group, selection: chosen.map((b) => track.boxes.indexOf(b)).filter((i) => i >= 0) };
}

/*
  ApplyObject: a model onto the selected objects. A top crush takes a keyframed model as its
  cab, any other as its base (shown only until it has a cab); everything else takes it as its
  model, set on the ground by the model's lowest point (basez: the lowest vertex or 0, less 31,
  in model units of 1/256 step). Traxx 1.7 (0acc316): on the drive surface the box is then
  seated with BoxHeightPairStore, the ground's fraction folded in.
*/
export function applyModel(boxes: TraxxBox[], model: { title: string; keyframed: boolean; baseZ: number }, ground: Ground | null = null): void {
  for (const box of boxes) {
    if (box.type === TRAXX_BOX_CRUSH && model.keyframed) { box.crushName = model.title; continue; }
    box.modelName = model.title;
    box.ipos[2] -= box.heightAboveGround;
    box.heightAboveGround = (-model.baseZ) >> 8;
    box.fraction[2] = -model.baseZ - 256 * box.heightAboveGround;
    box.ipos[2] += box.heightAboveGround;
    if (ground && surfaceTrack(ground)) boxHeightPairStore(ground, box);
  }
}

/** CTrackPODModel's basez from the raw up coordinates (word >> 1). */
export function modelBaseZ(upCoordinates: Iterable<number>): number {
  let base = 0;
  for (const z of upCoordinates) if (z < base) base = z;
  return base - 31;
}

/*
  OnObjectPaste: a new object at the ground point with everything the copy had except its
  place, and its type dropped to Default if that type's budget is full. Returns the new index
  and a message when the type was refused. Traxx 1.7 (0acc316): on the drive surface the copy's
  height (the clipboard holds the height pair, copyForClipboard) is seated on the ground here.
  Traxx 1.8.2: a pasted checkpoint is a checkpoint of its own, last, or with race rules and a split
  another copy of its slot, capped at 100 checkpoints / 8 copies (pasteCheckpoint); the
  checkpoints are renumbered, so the index returned is where the box ended up.
*/
export function pasteObject(track: TxxTrack, copy: TraxxBox, at: [number, number, number], fraction: readonly [number, number, number] = [0, 0, 0], max = MAX_OBJECTS): { index: number | null; refusal: string | null } {
  const index = insertObject(track, at, fraction, max);
  if (index === null) return { index: null, refusal: `Max. ${max} Objects!` };
  const box = track.boxes[index];
  const pos = box.ipos;
  Object.assign(box, structuredClone(copy));
  box.ipos = [pos[0], pos[1], pos[2] + copy.heightAboveGround];
  box.fraction = [copy.fraction[0], copy.fraction[1], copy.fraction[2]];
  if (surfaceTrack(track)) {
    box.ipos[2] = pos[2];
    boxHeightPairStore(track, box);
  }
  let refusal: string | null = null;
  const count = (test: (t: number) => boolean) => track.boxes.filter((b) => test(b.type)).length;
  if (copy.type === TRAXX_BOX_RAMP && count((t) => t === TRAXX_BOX_RAMP) > 100) refusal = "Max. 100 Ramps!";
  else if (copy.type === TRAXX_BOX_CRUSH && count((t) => t === TRAXX_BOX_CRUSH) > 100) refusal = "Max. 100 Top-Crush!";
  else if (moves(copy.type) && count(moves) > 100) refusal = "Max. 100 Moving objects (Train and Moving combined)!";
  else if (copy.type === TRAXX_BOX_LIGHT && count((t) => t === TRAXX_BOX_LIGHT) > 100) refusal = "Max. 100 Lights!";
  else if (copy.type === TRAXX_BOX_FOG && count((t) => t === TRAXX_BOX_FOG) > TRAXX_MAX_FOGS) refusal = `Max. ${TRAXX_MAX_FOGS} Fog objects!`;
  if (refusal) box.type = 0;
  if (box.type === CHECKPOINT) refusal = pasteCheckpoint(track.boxes, track.raceRules?.mode ?? RACERULES_NONE, box);
  return { index: track.boxes.indexOf(box), refusal };
}

/*
  Purge Unused Models (DeleteModel): a model no object draws, directly or as a frame of a
  keyframed model an object draws.
*/
export function unusedModels(track: TxxTrack, frameNamesOf: (model: string) => string[]): string[] {
  const title = (n: string) => n.toUpperCase().replace(/^MODELS\\/, "");
  const used = new Set<string>();
  for (const b of track.boxes) {
    for (const name of [b.modelName, b.crushName]) {
      if (!name) continue;
      used.add(title(name));
      for (const f of frameNamesOf(name)) used.add(title(f));
    }
  }
  for (const name of [track.backdropName, ...track.extraBackdrops]) if (name) used.add(title(name));
  return track.models.filter((m) => !used.has(title(m)));
}

/*
  DeleteModel for one model (the Models window's Cut and Cut With Objects): objects showing it
  lose their model, or with `withObjects` are deleted. Returns the object index remap, or null
  when no object went.
*/
export function removeModel(doc: TrackDocument, name: string, withObjects: boolean): ((i: number) => number) | null {
  const title = (n: string) => n.toUpperCase().replace(/^MODELS\\/, "");
  const key = title(name);
  const track = doc.track;
  const users: number[] = [];
  track.boxes.forEach((b, i) => { if (b.modelName && title(b.modelName) === key) users.push(i); });
  for (const i of users) track.boxes[i]!.modelName = "";
  track.models = track.models.filter((m) => title(m) !== key);
  doc.models = doc.models.filter((m) => title(m.name) !== key);
  return withObjects && users.length ? deleteObjects(track, users) : null;
}
