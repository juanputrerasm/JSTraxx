/*
  Snap to ground on the drive surface (Traxx 1.7, e4e034d and 0acc316).

  On a 16-bit, Spline or Full Map track the ground under a point has a 1/256 step fraction of
  its own (GroundAt), so:

    - an object's zfraction (fraction[2]) is its ABSOLUTE fraction, and its height above the
      ground is the difference of the two (z * 256 + zfrac) totals (CTrackPOD::BoxHeightPairOf);
    - re-grounding a box goes in two halves round whatever changes it: BoxHeightPairLoad before
      its x / y move (the pair from where it IS), BoxHeightPairStore after (the ground there plus
      the pair, written back as ipos[2] and an absolute zfraction);
    - the camera, the light pools and Adjust Heights' placed points keep the ground's fraction.

  Classic 8-bit keeps the old whole-step InterpolateRawAtPoint everywhere. Functions take a
  track (any Terrain16), or a bare 8-bit height array, which is always Classic 8-bit.
*/
import type { TraxxBox } from "./sit.ts";
import type { Terrain16 } from "./terrain16.ts";
import { TERRAINMODE_CLASSIC8 } from "./terrain16.ts";
import { interpolateRawAtPoint } from "./terrain.ts";
import { groundAt } from "./surface.ts";

/** What a ground rule reads: a track, or the 8-bit heights of a Classic 8-bit one. */
export type Ground = Uint8Array | Terrain16;

/** The track's drive surface applies (16-bit, Spline, Full Map); null on Classic 8-bit. */
export function surfaceTrack(g: Ground): Terrain16 | null {
  if (g instanceof Uint8Array) return null;
  // A record without a mode (an older caller's) is Classic 8-bit.
  return !g.terrainMode || g.terrainMode === TERRAINMODE_CLASSIC8 ? null : g;
}

function raw(g: Ground): Uint8Array {
  return g instanceof Uint8Array ? g : g.heights;
}

/** GroundAt as one total: z * 256 + zfrac, in 1/256 step. */
export function groundTotal(t: Terrain16, ix: number, iy: number, ixf = 0, iyf = 0): number {
  const { z, zfrac } = groundAt(t, ix, iy, ixf, iyf);
  return z * 256 + zfrac;
}

/** CTrackPOD::BoxHeightPairOf (non-classic): the height above the ground, floored steps and 0..255. */
export function boxHeightPairOf(t: Terrain16, b: TraxxBox): [number, number] {
  const total = b.ipos[2] * 256 + b.fraction[2] - groundTotal(t, b.ipos[0], b.ipos[1], b.fraction[0], b.fraction[1]);
  return [total >> 8, total & 255];
}

/** CTrackPOD::BoxHeightPairLoad: nothing on Classic 8-bit; else the pair from where the box is. */
export function boxHeightPairLoad(g: Ground, b: TraxxBox): void {
  const t = surfaceTrack(g);
  if (!t) return;
  [b.heightAboveGround, b.fraction[2]] = boxHeightPairOf(t, b);
}

/**
  CTrackPOD::BoxHeightPairStore: the box at the ground under it plus (height_above_gnd,
  zfraction). Classic 8-bit: ipos[2] = InterpolateRawAtPoint + height, zfraction untouched.
*/
export function boxHeightPairStore(g: Ground, b: TraxxBox): void {
  const t = surfaceTrack(g);
  if (!t) {
    b.ipos[2] = interpolateRawAtPoint(raw(g), b.ipos[0], b.ipos[1]) + b.heightAboveGround;
    return;
  }
  const total = groundTotal(t, b.ipos[0], b.ipos[1], b.fraction[0], b.fraction[1]) + b.heightAboveGround * 256 + b.fraction[2];
  b.ipos[2] = total >> 8;
  b.fraction[2] = total & 255;
}

/**
  The height a dialog shows (ObjectPropertiesDlg::OnInitDialog, GroupFieldTexts): the stored
  pair on Classic 8-bit, BoxHeightPairOf elsewhere, as hag + frac / 256 in float.
*/
export function boxHeightShown(g: Ground | null, b: TraxxBox): number {
  const t = g ? surfaceTrack(g) : null;
  const [hag, frac] = t ? boxHeightPairOf(t, b) : [b.heightAboveGround, b.fraction[2]];
  return Math.fround(hag + frac / 256);
}

/**
  DeriveBoxHeightsAboveGround's non-classic branch: the height is the floored difference of the
  totals; ipos[2] and zfraction stay the box's absolute position.
*/
export function deriveBoxHeightOnSurface(t: Terrain16, b: TraxxBox): void {
  b.heightAboveGround = boxHeightPairOf(t, b)[0];
}

/**
  The camera's ground (CTraxxView::OnUpdate, NavigationTick), in steps: InterpolateRawAtPoint
  on Classic 8-bit, else (z * 256 + zfrac) / 256. The camera takes floor(ALTITUDESCALE x this),
  which is Traxx's (ALTITUDESCALE * (z * 256 + zfrac)) >> 8 exactly (a 1/256 is a binary fraction).
*/
export function cameraGround(g: Ground, x: number, y: number): number {
  const t = surfaceTrack(g);
  if (!t) return interpolateRawAtPoint(raw(g), x, y);
  return groundTotal(t, x, y) / 256;
}

/**
  LightGroundZ (TraxxViewDisplay.cpp), in scene z (Traxx's world z / 64): ALTITUDESCALE x the
  whole step on Classic 8-bit; ALTITUDESCALE x ((z * 256 + zfrac) >> 2) world units elsewhere.
*/
export function lightGroundZ(g: Ground, x: number, y: number, altitudeScale: number): number {
  const t = surfaceTrack(g);
  if (!t) return altitudeScale * interpolateRawAtPoint(raw(g), x, y);
  return (altitudeScale * (groundTotal(t, x, y) >> 2)) / 64;
}

/**
  A placed point for Adjust Terrain Heights (CollectPlacedPoints, PlacedPoint): an object
  carries its x / y fractions and its zfraction; a truck start or a course end has neither.
*/
export interface PlacedPoint {
  ipos: [number, number, number];
  /** An object's fraction: x / y sample the ground, z takes the shift. */
  fraction?: [number, number, number];
}

/** CollectPlacedPoints: the ground under the point before the change (whole steps, or a 1/256 total). */
export function placedGround(g: Ground, p: PlacedPoint): number {
  const t = surfaceTrack(g);
  if (!t) return interpolateRawAtPoint(raw(g), p.ipos[0], p.ipos[1]);
  return groundTotal(t, p.ipos[0], p.ipos[1], p.fraction?.[0] ?? 0, p.fraction?.[1] ?? 0);
}

/**
  ShiftPlacedPoints: the point moved by the change in ground beneath it. An object takes the
  1/256 delta into z and zfraction exactly; a truck start or checkpoint takes the nearest whole
  step, rounded so that Adjust then its undo telescopes (0acc316).
*/
export function shiftPlaced(g: Ground, p: PlacedPoint, before: number): void {
  const t = surfaceTrack(g);
  if (!t) {
    p.ipos[2] += interpolateRawAtPoint(raw(g), p.ipos[0], p.ipos[1]) - before;
    return;
  }
  const now = groundTotal(t, p.ipos[0], p.ipos[1], p.fraction?.[0] ?? 0, p.fraction?.[1] ?? 0);
  if (p.fraction) {
    const total = p.ipos[2] * 256 + p.fraction[2] + (now - before);
    p.ipos[2] = total >> 8;
    p.fraction[2] = total & 255;
  } else p.ipos[2] += ((now + 128) >> 8) - ((before + 128) >> 8);
}

/**
  OnObjectCopy: what the clipboard keeps. Non-classic: the HEIGHT above the ground (floor and
  0..255) in height_above_gnd and zfraction, since the box's own zfraction is absolute there.
*/
export function copyForClipboard(g: Ground, b: TraxxBox): TraxxBox {
  const c = structuredClone(b);
  const t = surfaceTrack(g);
  if (t) [c.heightAboveGround, c.fraction[2]] = boxHeightPairOf(t, b);
  return c;
}
