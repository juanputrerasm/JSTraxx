/*
  The ground points the spillway notches and the waterfalls' lip checks read (Traxx 1.7.1,
  TrackPOD/TrackPODLakes.cpp: PointStep, PointLevel, HeightLevel, LevelUnit; Include/TrackPODLakes.h
  LAKE_LIP_*). Kept apart from lakes.ts so falls.ts can use them without importing the lakes.

  A lattice of the ground's points: tile (tx, tz) owns points S*tx .. S*tx + S on each axis, S =
  PointStep: 1 on Classic 8 / 16-bit (the 4 corners), 4 on Spline and Full Map (the 25 fine
  points). Neighbouring tiles share the points on their common edge.
*/
import type { LakeGround } from "./surface.ts";

/** LAKE_MAX_HEIGHT (water units). */
export const LAKE_MAX_HEIGHT = 4 * 255 + 3;

/** Lip edges of a notch tile, one bit per tile edge (SetNotches' lipedges). */
export const LAKE_LIP_N = 0x01; // the edge on the tile's z = tz side
export const LAKE_LIP_E = 0x02; // x = tx + 1
export const LAKE_LIP_S = 0x04; // z = tz + 1
export const LAKE_LIP_W = 0x08; // x = tx
/** A diagonal notch / lake pair's one shared vertex, the corner of the notch tile facing the lake tile. */
export const LAKE_LIP_NW = 0x10; // the corner (tx, tz)
export const LAKE_LIP_NE = 0x20; // (tx + 1, tz)
export const LAKE_LIP_SE = 0x40; // (tx + 1, tz + 1)
export const LAKE_LIP_SW = 0x80; // (tx, tz + 1)

/** PointStep: 1 on Classic 8 / 16-bit, 4 on the fine modes, 0 when the ground cannot give points. */
export function pointStep(g: LakeGround): number {
  if (g.raw) return 1;
  if (g.pointU && (g.step ?? 0) >= 1) return g.step!;
  return 0;
}

/** PointLevel: lattice point (px, pz) in HeightLevel units (4 * raw on Classic 8-bit, u on the surface). */
export function pointLevel(g: LakeGround, px: number, pz: number): number {
  if (g.raw) return 4 * g.raw[(px & 255) + ((pz & 255) << 8)]!;
  if (!g.pointU) return 0;
  return g.pointU(px, pz);
}

/** LevelOf / HeightLevel: H in the ground's units (h on Classic 8-bit; 32 * h, clamped to -1..1024 first, on the surface). */
export function heightLevel(g: LakeGround, h: number): number {
  if (g.raw) return h;
  if (h < -1) h = -1;
  if (h > LAKE_MAX_HEIGHT + 1) h = LAKE_MAX_HEIGHT + 1;
  return 32 * h;
}

/** LevelUnit: the HeightLevel of one water unit. */
export function levelUnit(g: LakeGround): number {
  return g.raw ? 1 : 32;
}
