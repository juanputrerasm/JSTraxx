/*
  Special > Lighting (Traxx 1.7.2: CTrackPOD::BuildLighting, BakeEngineLighting and
  CTrackPODTerrain::GetEngineY0 / FillLteFlat).

    BuildLighting  the sun vector and the ambient go into the .LVL values verbatim (track.sun's
                   vector and shadowIntensity; the boss light is kept), and the light plane
                   (.LTE, 7 bytes a cell) is rebaked: each cell's ground byte is the engine's own
                   classic ground light, l0 = (lightCalcDiffuse(approxGroundNormal) - 0x100) >> 4
                   (engine-light.ts), from the heights the engine loads; the other six bytes 0.
                   Nothing is applied after it: the old Dark / Bright / Alt. bias / Shadow
                   settings, the 8..255 clamp and the ground-box and object shadows are gone, as
                   in Traxx 1.7.2, so the .LTE equals what the engine computes (smooth terrain
                   then adds no correction).
    GetEngineY0    what the engine loads into groundArray[z][x].y0, v >> 1 at each 32 ft corner:
                   Classic 8-bit 128 * raw, Classic 16-bit h16 >> 1, Spline and Full Map the 8 ft
                   surface at (4x, 4z) >> 1.
    FillLteFlat    the flat fill a new or reset track starts with (ground 0xed).

  The grid is N x N (track format version 6: 256 or 512 cells), wrapping at N; a 32-bit version 6
  store gives y0 = v >> 1 the same way (an arithmetic shift, as the engine's int).
*/
import type { TxxTrack } from "../traxx/txx.ts";
import { cellsOf } from "../traxx/world.ts";
import { cornerV, getSurface } from "../traxx/surface.ts";
import type { Terrain16 } from "../traxx/terrain16.ts";
import { engineBakeGround, TRAXX_DEFAULT_SUN, TRAXX_DEFAULT_AMBIENT, type SunVector } from "./engine-light.ts";

/** The ground byte a new or reset track's light plane holds (CTrackPODTerrain: FillLteFlat(0xed)). */
export const LTE_FLAT_LEVEL = 0xed;

/** The boss light a track without a recorded sun gets (the CTrackPOD constructor's sunpos and sunintens). */
const DEFAULT_BOSS = { position: [32000, -46333, 0] as [number, number, number], intensity: 64000 };

/** OnEditLighting's starting values: the track's LVL sun and ambient, or Traxx's defaults. */
export function trackLighting(track: Pick<TxxTrack, "sun">): { sun: [number, number, number]; ambient: number } {
  const s = track.sun;
  return s ? { sun: [s.vector[0], s.vector[1], s.vector[2]], ambient: s.shadowIntensity } : { sun: [...TRAXX_DEFAULT_SUN], ambient: TRAXX_DEFAULT_AMBIENT };
}

/** FillLteFlat: every cell's ground byte `level`, the other six 0. */
export function fillLteFlat(cells: number, level = LTE_FLAT_LEVEL): Uint8Array {
  const lte = new Uint8Array(cells * 7);
  for (let c = 0; c < cells; c++) lte[c * 7] = level;
  return lte;
}

/** GetEngineY0: the engine's y0 at every 32 ft corner, z * N + x. */
export function engineY0(t: Terrain16): Int32Array {
  const n = cellsOf(t), fn = 4 * n;
  const y0 = new Int32Array(n * n);
  const s = getSurface(t);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      // A Spline with no surface falls back to the coarse corners, which the spline passes through.
      y0[z * n + x] = (s ? s[4 * z * fn + 4 * x]! : cornerV(t, x, z)) >> 1;
    }
  }
  return y0;
}

/** BakeEngineLighting: the ground bytes for this sun and ambient (z * N + x), into `out` when given. */
export function bakeEngineLighting(t: Terrain16, sun: SunVector, ambient: number, out?: Uint8Array): Uint8Array {
  const n = cellsOf(t);
  return engineBakeGround(engineY0(t), sun, ambient, out, n);
}

/**
  BuildLighting(sun, ambient): the LVL values written verbatim, the light plane rebaked. With
  unchanged values this rebakes the same .LTE.
*/
export function buildLighting(track: TxxTrack, sun: SunVector, ambient: number): void {
  const boss = track.sun ?? DEFAULT_BOSS;
  track.sun = {
    vector: [sun[0]!, sun[1]!, sun[2]!], shadowIntensity: ambient,
    position: [boss.position[0], boss.position[1], boss.position[2]], intensity: boss.intensity,
  };
  const ground = bakeEngineLighting(track, sun, ambient);
  const lte = new Uint8Array(ground.length * 7);
  for (let c = 0; c < ground.length; c++) lte[c * 7] = ground[c]!;
  track.lte = lte;
}
