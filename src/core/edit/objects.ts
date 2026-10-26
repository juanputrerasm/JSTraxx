/*
  Object editing (Traxx/TraxxViewEdit.cpp, Object editing). Objects are TraxxBoxes: x, y in
  ipos with 1/256 fractions, z in whole steps with its fraction, angles in radians.

  Traxx keeps objects in a fixed array with free slots and fills the first free one on insert;
  JSTraxx keeps a list, so a new object goes at the end.
*/
import type { TrackDocument } from "../doc/document.ts";
import type { TxxTrack } from "../traxx/txx.ts";
import { traxxBoxDefaults, traxxSignedSplit, TRAXX_BOX_CRUSH, TRAXX_BOX_LIGHT, TRAXX_BOX_RAMP, type TraxxBox } from "../traxx/sit.ts";
import { interpolateRawAtPoint } from "../traxx/terrain.ts";

export const MAX_OBJECTS = 4096;
export const TYPE_TRAIN = 10;
export const TYPE_MOVING = 13;
export const CHECKPOINT = 6;

/* The Type list (IDC_TYPECOMBO): indices 0..13 are the engine's box types, then Ramp and Top-Crush. */
export const OBJECT_TYPE_NAMES = ["Default", "Sign", "Barricade", "Tree", "Cone", "Vehicle", "Checkpoint", "No collide", "No collide (facing)", "Collide (facing)", "Train", "Post", "Light", "Moving", "Ramp", "Top-Crush"];
export const TYPEIDX_RAMP = 14;
export const TYPEIDX_CRUSH = 15;

export function typeToIndex(type: number): number {
  if (type === TRAXX_BOX_RAMP) return TYPEIDX_RAMP;
  if (type === TRAXX_BOX_CRUSH) return TYPEIDX_CRUSH;
  return type < 0 || type > TYPE_MOVING ? 0 : type;
}

export function indexToType(index: number): number {
  if (index === TYPEIDX_RAMP) return TRAXX_BOX_RAMP;
  if (index === TYPEIDX_CRUSH) return TRAXX_BOX_CRUSH;
  return index < 0 || index > TYPE_MOVING ? 0 : index;
}

const moves = (t: number) => t === TYPE_TRAIN || t === TYPE_MOVING;

/* The engine's budgets (BoxTypeBudgetGroup / Cap): 20 checkpoints, 100 ramps, 100 top crush, 100 Train + Moving together, 100 lights. */
export function budgetGroup(type: number): number {
  if (type === CHECKPOINT) return 1;
  if (type === TRAXX_BOX_RAMP) return 2;
  if (type === TRAXX_BOX_CRUSH) return 3;
  if (moves(type)) return 4;
  if (type === TRAXX_BOX_LIGHT) return 5;
  return 0;
}

export function budgetCap(group: number): number {
  return [MAX_OBJECTS, 20, 100, 100, 100, 100][group] ?? MAX_OBJECTS;
}

/** OnObjectInsert: a default box on the ground point (whole ipos, steps truncated). Null when the track is full. */
export function insertObject(track: TxxTrack, at: [number, number, number]): number | null {
  if (track.boxes.length >= MAX_OBJECTS) return null;
  const box = traxxBoxDefaults();
  box.ipos = [Math.trunc(at[0]), Math.trunc(at[1]), Math.trunc(at[2]) + box.heightAboveGround];
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
  below 0), each object kept at its height above the ground.
*/
export function moveObjects(boxes: TraxxBox[], heights: Uint8Array, dx: number, dy: number): void {
  for (const b of boxes) {
    const px = Math.max(0, b.ipos[0] + b.fraction[0] / 256 + dx / 1000);
    const py = Math.max(0, b.ipos[1] + b.fraction[1] / 256 + dy / 1000);
    [b.ipos[0], b.fraction[0]] = traxxSignedSplit(px);
    [b.ipos[1], b.fraction[1]] = traxxSignedSplit(py);
    b.ipos[2] = interpolateRawAtPoint(heights, b.ipos[0], b.ipos[1]) + b.heightAboveGround;
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

/** ObjectRaise: the height above the ground by hundredths of a step, at most 500 steps. */
export function raiseObjects(boxes: TraxxBox[], heights: Uint8Array, hundredths: number): void {
  const inc = Math.trunc(Math.fround(256 * Math.fround(hundredths / 100)));
  for (const b of boxes) {
    b.heightAboveGround += Math.trunc(inc / 256);
    b.fraction[2] += inc % 256;
    if (b.fraction[2] >= 256) { b.heightAboveGround++; b.fraction[2] -= 256; }
    if (b.fraction[2] < 0) { b.heightAboveGround--; b.fraction[2] += 256; }
    if (b.heightAboveGround >= 500) { b.heightAboveGround = 500; b.fraction[2] = 0; }
    b.ipos[2] = interpolateRawAtPoint(heights, b.ipos[0], b.ipos[1]) + b.heightAboveGround;
  }
}

/*
  Dragging (OnMouseMove, objects mode): the anchor to the ground point at its height above the
  ground (its fractions kept), the rest of the selection by the same amount, each at its own
  height above the ground where it lands.
*/
export function dragObjects(track: TxxTrack, selected: readonly number[], at: [number, number, number]): void {
  const anchor = track.boxes[selected[0]];
  if (!anchor) return;
  const cx = Math.trunc(at[0]), cy = Math.trunc(at[1]);
  const dx = cx - anchor.ipos[0], dy = cy - anchor.ipos[1];
  anchor.ipos = [cx, cy, Math.trunc(at[2]) + anchor.heightAboveGround];
  if (!dx && !dy) return;
  for (const i of selected.slice(1)) {
    const b = track.boxes[i];
    b.ipos[0] = Math.max(0, b.ipos[0] + dx);
    b.ipos[1] = Math.max(0, b.ipos[1] + dy);
    b.ipos[2] = interpolateRawAtPoint(track.heights, b.ipos[0], b.ipos[1]) + b.heightAboveGround;
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
  type's budget; returns how many were refused, and the reordered selection. When checkpoints
  come or go, the checkpoints are put back in order of their sequence across the checkpoint
  positions (CompareCheckpoints), new ones after the existing ones in selection order.
*/
export function setTypeOfObjects(track: TxxTrack, selected: readonly number[], index: number): { refused: number; group: number; selection: number[] } {
  const newType = indexToType(index);
  const group = budgetGroup(newType);
  let room = budgetCap(group);
  if (group) for (const b of track.boxes) if (budgetGroup(b.type) === group) room--;
  let refused = 0, checkpoints = false;
  const chosen = selected.map((i) => track.boxes[i]);
  chosen.forEach((box, i) => {
    if (group && budgetGroup(box.type) !== group) {
      if (room <= 0) { refused++; return; }
      room--;
    }
    if ((box.type === CHECKPOINT) !== (newType === CHECKPOINT)) checkpoints = true;
    if (newType === CHECKPOINT && box.type !== CHECKPOINT) box.checkpointSeq = 1000 + i;
    applyTypeIndex(box, index);
  });
  if (checkpoints) {
    const slots = track.boxes.map((b, i) => (b.type === CHECKPOINT ? i : -1)).filter((i) => i >= 0).slice(0, 20);
    const sorted = slots.map((i) => track.boxes[i]).sort((a, b) => a.checkpointSeq - b.checkpointSeq);
    slots.forEach((slot, seq) => { track.boxes[slot] = sorted[seq]; sorted[seq].checkpointSeq = seq; });
  }
  return { refused, group, selection: chosen.map((b) => track.boxes.indexOf(b)).filter((i) => i >= 0) };
}

/*
  ApplyObject: a model onto the selected objects. A top crush takes a keyframed model as its
  cab, any other as its base (shown only until it has a cab); everything else takes it as its
  model, set on the ground by the model's lowest point (basez: the lowest vertex or 0, less 31,
  in model units of 1/256 step).
*/
export function applyModel(boxes: TraxxBox[], model: { title: string; keyframed: boolean; baseZ: number }): void {
  for (const box of boxes) {
    if (box.type === TRAXX_BOX_CRUSH && model.keyframed) { box.crushName = model.title; continue; }
    box.modelName = model.title;
    box.ipos[2] -= box.heightAboveGround;
    box.heightAboveGround = (-model.baseZ) >> 8;
    box.fraction[2] = -model.baseZ - 256 * box.heightAboveGround;
    box.ipos[2] += box.heightAboveGround;
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
  and a message when the type was refused.
*/
export function pasteObject(track: TxxTrack, copy: TraxxBox, at: [number, number, number]): { index: number | null; refusal: string | null } {
  const index = insertObject(track, at);
  if (index === null) return { index: null, refusal: "Max. 4096 Objects!" };
  const box = track.boxes[index];
  const pos = box.ipos;
  Object.assign(box, structuredClone(copy));
  box.ipos = [pos[0], pos[1], pos[2] + copy.heightAboveGround];
  box.fraction = [copy.fraction[0], copy.fraction[1], copy.fraction[2]];
  let refusal: string | null = null;
  const count = (test: (t: number) => boolean) => track.boxes.filter((b) => test(b.type)).length;
  if (copy.type === TRAXX_BOX_RAMP && count((t) => t === TRAXX_BOX_RAMP) > 100) refusal = "Max. 100 Ramps!";
  else if (copy.type === TRAXX_BOX_CRUSH && count((t) => t === TRAXX_BOX_CRUSH) > 100) refusal = "Max. 100 Top-Crush!";
  else if (moves(copy.type) && count(moves) > 100) refusal = "Max. 100 Moving objects (Train and Moving combined)!";
  else if (copy.type === TRAXX_BOX_LIGHT && count((t) => t === TRAXX_BOX_LIGHT) > 100) refusal = "Max. 100 Lights!";
  if (refusal) box.type = 0;
  return { index, refusal };
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
