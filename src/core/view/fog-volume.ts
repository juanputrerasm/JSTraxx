/*
  A Fog object's volume in the view (Traxx/TraxxViewDisplay.cpp):

    fogVolumeCorners  FogVolumeCorners: an UPRIGHT box, footprint width x length feet centred on
                      the object's x, y, turned by its heading (psi) only, from a floor at the
                      object's height + base up `height` feet. Tilt and roll are not used: the
                      volume never leans.
    fogVolumeRing     FogVolumeRing: the footprint outline the engine's fog shader uses: the four
                      corners for round 0, else the superellipse with exponent 16 - 14*round,
                      48 points.
    fogDriftArrow     OverlayFogDrift: which way the wisps travel, on the top face, for a fog
                      with wisps and drift both above 0.
    fogVolumeAlphas   DrawFogVolumes' opacities: never invisible, however low the cap.

  Points are scene units: x, y in ipos (a world unit is 1/64), z = 3 per terrain step. A box's
  width and length are half-extents in ipos (half a foot each), so +-width ipos is width feet
  across; vertically a foot is 96 world units (TRAXX_WORLDZ_PERFOOT), 1.5 scene units.
*/
import type { TraxxBox, TraxxFog } from "../traxx/sit.ts";
import { TRAXX_BOX_FOG } from "../traxx/sit.ts";

/** TRAXXGL_FOGRING: the most points of a rounded footprint (a rectangle has 4). */
export const FOG_RING = 48;
/** TRAXX_WORLDZ_PERFOOT and TRAXX_WORLDXY_PERFOOT over the 64 world units of a scene unit. */
const Z_PER_FOOT = 96 / 64;
const XY_PER_FOOT = 128 / 64;
/** TRAXX_FOGDRIFT_COLOUR, RGB(215, 235, 255). */
export const FOG_DRIFT_COLOUR = "#d7ebff";
/** OverlayFogVolumes' pen: a fixed pale blue-grey (the software renderer's wireframe). */
export const FOG_WIRE_COLOUR = "#aabed7";

export type Vec3 = [number, number, number];
type FogBox = Pick<TraxxBox, "ipos" | "fraction" | "width" | "length" | "height" | "psi" | "theta">;

/** Eight corners, DrawBox's order: bottom ring 0..3 (--, +-, ++, -+), then the top 4..7; null with no volume. */
export function fogVolumeCorners(box: FogBox, fog: Pick<TraxxFog, "base">): Vec3[] | null {
  if (box.width <= 0 || box.length <= 0 || box.height <= 0) return null;
  const cx = box.ipos[0] + (box.fraction[0] >> 2) / 64;
  const cy = box.ipos[1] + (box.fraction[1] >> 2) / 64;
  const cz = (3 * ((box.ipos[2] << 6) + (box.fraction[2] >> 2))) / 64;
  const halfw = box.width, halfl = box.length;
  const floorz = cz + fog.base * Z_PER_FOOT;
  const topz = floorz + box.height * Z_PER_FOOT;
  const s = Math.sin(box.psi), co = Math.cos(box.psi);
  const ax = co, ay = -s; // across (the object's X)
  const bx = s, by = co; // along (the object's Z; the heading)
  const sx = [-1, 1, 1, -1], sy = [-1, -1, 1, 1];
  const c: Vec3[] = [];
  for (let i = 0; i < 4; i++) c.push([cx + sx[i]! * halfw * ax + sy[i]! * halfl * bx, cy + sx[i]! * halfw * ay + sy[i]! * halfl * by, floorz]);
  for (let i = 0; i < 4; i++) c.push([c[i]![0], c[i]![1], topz]);
  return c;
}

export interface FogRing {
  /** The footprint, x, y pairs going round once. */
  ring: [number, number][];
  floorz: number;
  topz: number;
}

/** The footprint outline at the floor and top; null with no volume. */
export function fogVolumeRing(box: FogBox, fog: Pick<TraxxFog, "base" | "round">): FogRing | null {
  const c = fogVolumeCorners(box, fog);
  if (!c) return null;
  const floorz = c[0]![2], topz = c[4]![2];
  let round = fog.round;
  if (!(round >= 0)) round = 0;
  if (round > 1) round = 1;
  if (round < 0.001) return { ring: c.slice(0, 4).map((p) => [p[0], p[1]]), floorz, topz };
  const cx = (c[0]![0] + c[2]![0]) * 0.5, cy = (c[0]![1] + c[2]![1]) * 0.5;
  const ax = (c[1]![0] - c[0]![0]) * 0.5, ay = (c[1]![1] - c[0]![1]) * 0.5;
  const bx = (c[3]![0] - c[0]![0]) * 0.5, by = (c[3]![1] - c[0]![1]) * 0.5;
  const ne = 16 - 14 * round;
  const ring: [number, number][] = [];
  for (let i = 0; i < FOG_RING; i++) {
    const t = (2 * Math.PI * i) / FOG_RING;
    const cs = Math.cos(t), sn = Math.sin(t);
    const r = 1 / Math.pow(Math.pow(Math.abs(cs), ne) + Math.pow(Math.abs(sn), ne), 1 / ne);
    const nx = r * cs, nz = r * sn;
    ring.push([cx + nx * ax + nz * bx, cy + nx * ay + nz * by]);
  }
  return { ring, floorz, topz };
}

/**
  OverlayFogShape: the outline at the floor and at the top, and verticals joining them, at every
  corner of a rectangle, at eight spaced points round a rounded one. Pairs of points.
*/
export function fogShapeLines(r: FogRing): [Vec3, Vec3][] {
  const n = r.ring.length;
  if (n < 3) return [];
  const stride = n > 4 ? Math.trunc(n / 8) : 1;
  const out: [Vec3, Vec3][] = [];
  for (let i = 0; i < n; i++) {
    const a = r.ring[i]!, b = r.ring[(i + 1) % n]!;
    out.push([[a[0], a[1], r.floorz], [b[0], b[1], r.floorz]]);
    out.push([[a[0], a[1], r.topz], [b[0], b[1], r.topz]]);
    if (i % stride === 0) out.push([[a[0], a[1], r.floorz], [a[0], a[1], r.topz]]);
  }
  return out;
}

/** DrawFogVolumes: the sides' opacity at the floor and at the top (and the top face), the edges 0.7. */
export function fogVolumeAlphas(maxop: number): { bottom: number; top: number; edge: number } {
  let cap = maxop;
  if (!(cap >= 0)) cap = 0;
  if (cap > 1) cap = 1;
  return { bottom: 0.15 + 0.3 * cap, top: 0.04 + 0.06 * cap, edge: 0.7 };
}

/** The middle of the volume (opposite corners), where a Fog is picked and labelled "FOG". */
export function fogVolumeCentre(box: FogBox, fog: Pick<TraxxFog, "base">): Vec3 | null {
  const c = fogVolumeCorners(box, fog);
  if (!c) return null;
  return [(c[0]![0] + c[6]![0]) * 0.5, (c[0]![1] + c[6]![1]) * 0.5, (c[0]![2] + c[6]![2]) * 0.5];
}

/**
  OverlayFogDrift: tail to tip and four barbs, centred on the top face. The engine's drift axis
  is the object's forward vector with the tilt kept and flattened, (0, 1) when it is flat-on.
  Length 40 % of the length, at least 20 ft. Null when there are no wisps or no drift.
*/
export function fogDriftArrow(box: FogBox, fog: Pick<TraxxFog, "base" | "wisp" | "wspeed">): [Vec3, Vec3][] | null {
  if (!(fog.wisp > 0) || !(fog.wspeed > 0)) return null;
  const c = fogVolumeCorners(box, fog);
  if (!c) return null;
  let bx = Math.sin(box.psi) * Math.cos(box.theta);
  let by = Math.cos(box.psi) * Math.cos(box.theta);
  const bl = Math.sqrt(bx * bx + by * by);
  if (bl < 1e-4) { bx = 0; by = 1; } else { bx /= bl; by /= bl; }
  const ax = by, ay = -bx;
  let len = box.length * 0.4;
  if (len < 20) len = 20;
  const back = len * 0.25, spread = len * 0.12;
  const mx = (c[4]![0] + c[6]![0]) * 0.5, my = (c[4]![1] + c[6]![1]) * 0.5, mz = c[4]![2];
  const t0 = -len * 0.5, t1 = len * 0.5, tb = t1 - back;
  const XY = XY_PER_FOOT, Z = Z_PER_FOOT;
  const pt: Vec3[] = [
    [mx + bx * t0 * XY, my + by * t0 * XY, mz],
    [mx + bx * t1 * XY, my + by * t1 * XY, mz],
    [mx + bx * tb * XY + ax * spread * XY, my + by * tb * XY + ay * spread * XY, mz],
    [mx + bx * tb * XY - ax * spread * XY, my + by * tb * XY - ay * spread * XY, mz],
    [mx + bx * tb * XY, my + by * tb * XY, mz + spread * Z],
    [mx + bx * tb * XY, my + by * tb * XY, mz - spread * Z],
  ];
  return [[0, 1], [1, 2], [1, 3], [1, 4], [1, 5]].map(([a, b]) => [pt[a!]!, pt[b!]!]);
}

/**
  The preview contract (SetFogPreview / EffectiveFog): a dialog's working copy stands in for the
  box's own fog, with "is it a Fog" from its Type field; any other box uses its own.
*/
export interface FogPreview { box: TraxxBox; fog: TraxxFog; isFog: boolean }
export function effectiveFog(box: TraxxBox, preview: FogPreview | null): { fog: TraxxFog; isFog: boolean } {
  if (preview && preview.box === box) return { fog: preview.fog, isFog: preview.isFog };
  return { fog: box.fog, isFog: box.type === TRAXX_BOX_FOG };
}
