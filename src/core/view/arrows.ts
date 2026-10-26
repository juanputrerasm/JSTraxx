/*
  Two editor arrows drawn in an object's own space (CTraxxView::OverlayLocalArrow): tail, tip
  and four barbs, as line segments tail-tip and tip-barb. Never written to the track.

    lightArrow       OverlayLightDirection: a Light in glow mode 2 points its cone along its
                     body's +y, at its height offset; the head 15% of the length back and 8% out
    checkpointArrow  OverlayCheckpoints: a checkpoint without a model, through the gate along
                     its heading, from beyond one face to beyond the other by the half-width

  Local units are the scene's (a model's raw units / 64, so 2 a foot); objectMatrix places them.
*/
import type { TraxxBox, TraxxLight } from "../traxx/sit.ts";
import { TRACKTYPE_DRAG, TRACKTYPE_RUMBLE } from "../doc/new-track.ts";

export type LocalArrow = [number, number, number][];

export function lightArrow(light: TraxxLight): LocalArrow | null {
  if (light.glowMode !== 2 || light.coneLength <= 0) return null;
  const len = light.coneLength;
  const back = Math.max(3, len * 0.15), spread = Math.max(1.5, len * 0.08);
  const lift = Math.trunc(light.heightOffset * 128) / 64;
  const shaft = Math.trunc(len * 128) / 64, barby = Math.trunc((len - back) * 128) / 64, barb = Math.trunc(spread * 128) / 64;
  return [[0, 0, lift], [0, shaft, lift], [barb, barby, lift], [-barb, barby, lift], [0, barby, lift + barb], [0, barby, lift - barb]];
}

/** CheckpointWantsArrow: none in a rumble, the first four in a drag, all otherwise. */
export function checkpointWantsArrow(trackType: number, number: number): boolean {
  if (trackType === TRACKTYPE_RUMBLE) return false;
  if (trackType === TRACKTYPE_DRAG) return number < 4;
  return true;
}

export function checkpointArrow(box: TraxxBox): LocalArrow {
  const w = box.width > 1 ? box.width : 1;
  const reach = box.length + w, back = w / 4, spread = w / 8;
  return [[0, -reach, 0], [0, reach, 0], [spread, reach - back, 0], [-spread, reach - back, 0], [0, reach - back, spread], [0, reach - back, -spread]];
}

/** The arrow's five segments through an object matrix (column-major 4x4). */
export function arrowSegments(arrow: LocalArrow, m: readonly number[]): [[number, number, number], [number, number, number]][] {
  const at = ([x, y, z]: [number, number, number]): [number, number, number] => [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
  const p = arrow.map(at);
  return [[p[0]!, p[1]!], [p[1]!, p[2]!], [p[1]!, p[3]!], [p[1]!, p[4]!], [p[1]!, p[5]!]];
}
