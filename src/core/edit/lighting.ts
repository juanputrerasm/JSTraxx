/*
  Special > Lighting (CTrackPOD::BuildLighting and CTrackPODTerrain::BuildLte): the light plane
  (LTE, 7 bytes a cell, the ground light first) rebuilt from the terrain.

    BuildLte       each cell lit by its normal (summed from the four neighbours, wrapping) and
                   the sun: noon takes the vertical alone, N/E/S/W add the slope towards it;
                   light = min + (max - min) * that, kept in 8..255; the other six bytes 0
    altitude bias  lower ground darker: 65536 - bias * (maxz - z)^2 / 100, in 1/65536
    shadows        noon: a cell under a neighbouring ground box; else up to 16 cells toward the
                   sun, a terrain point rising 12 a step above it or a ground box in reach
    object shadows static objects (mass < 1, not checkpoint, train or ramp) wider than 32 units
                   darken a patch of cells on the side away from the sun, at two thirds strength

  The sun vector and shadow intensity for the .LVL are set too.
*/
import type { TxxTrack } from "../traxx/txx.ts";
import { TRAXX_BOX_RAMP } from "../traxx/sit.ts";

export interface LightingSettings {
  minLight: number;
  maxLight: number;
  /** 0 noon, 1 N, 2 E, 3 S, 4 W. */
  sun: number;
  altBias: number;
  shadow: number;
}

const SUN_VECTORS: [number, number, number][] = [[0, -64000, 0], [0, -46333, -46333], [-46333, -46333, 0], [0, -46333, 46333], [46333, -46333, 0]];

/** OnEditLighting: which sun position a track's vector is, for the dialog. */
export function sunPosition(vector: readonly number[]): number {
  if (Math.abs(vector[0]!) < 1000 && Math.abs(vector[2]!) < 1000) return 0;
  if (vector[2]! < 0) return 1;
  if (vector[0]! < 0) return 2;
  if (vector[2]! > 0) return 3;
  return 4;
}

const clampLight = (v: number) => (v > 255 ? 255 : v < 8 ? 8 : v);

/** BuildLte: the ground light from the terrain alone. */
export function buildLte(raw: Uint8Array, minLte: number, maxLte: number, sun: number): Uint8Array {
  const lte = new Uint8Array(65536 * 7);
  if (minLte === maxLte) {
    for (let c = 0; c < 65536; c++) lte[c * 7] = minLte;
    return lte;
  }
  const f32 = Math.fround;
  for (let j = 0; j < 256; j++) {
    const jj = j << 8, y0 = j << 6;
    for (let i = 0; i < 256; i++) {
      const x0 = i << 6, z0 = raw[i + jj]!;
      // The four neighbours in turn: west, south, east, north, back to west.
      const pts: [number, number, number][] = [
        [x0 - 64, y0, raw[((i - 1) & 255) + jj]!],
        [x0, y0 + 64, raw[i + ((jj + 256) & 0xff00)]!],
        [x0 + 64, y0, raw[((i + 1) & 255) + jj]!],
        [x0, y0 - 64, raw[i + ((jj - 256) & 0xff00)]!],
        [x0 - 64, y0, raw[((i - 1) & 255) + jj]!],
      ];
      let nx = 0, ny = 0, nz = 0;
      for (let k = 0; k < 4; k++) {
        const [x1, y1, z1] = pts[k]!, [x2, y2, z2] = pts[k + 1]!;
        nx += (y1 - y0) * (z2 - z0) - (y2 - y0) * (z1 - z0);
        ny += (x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0);
        nz += (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      }
      const length = f32(Math.sqrt(nx * nx + ny * ny + nz * nz));
      let vert = f32(Math.abs(nz) / length);
      if (sun === 1) vert = f32(vert + f32(ny / length));
      else if (sun === 2) vert = f32(vert - f32(nx / length));
      else if (sun === 3) vert = f32(vert - f32(ny / length));
      else if (sun === 4) vert = f32(vert + f32(nx / length));
      lte[(i + jj) * 7] = clampLight(minLte + Math.trunc(f32((maxLte - minLte) * vert)));
    }
  }
  return lte;
}

/** BuildRA01CL0's lower-height grid. */
function groundBoxLower(track: TxxTrack): Uint8Array {
  const ra0 = new Uint8Array(65536);
  for (const g of track.groundBoxes) {
    for (let y = g.y; y < g.y + Math.max(1, g.h); y++) for (let x = g.x; x < g.x + Math.max(1, g.w); x++) ra0[(x & 255) + ((y & 255) << 8)] = g.lower;
  }
  return ra0;
}

/**
  BuildLighting onto the track: its light plane and sun. `modelVertices` gives a model's raw
  vertices (x, north, up, in model units) by the name boxes record, or null.
*/
export function buildLighting(track: TxxTrack, s: LightingSettings, modelVertices: (name: string) => Int32Array | null): void {
  const sunVec = SUN_VECTORS[s.sun] ?? SUN_VECTORS[0]!;
  track.sun = { ...(track.sun ?? { position: [32000, -46333, 0], intensity: 64000 }), vector: [...sunVec], shadowIntensity: 2 * s.maxLight * (100 - s.shadow) };
  const raw = track.heights;
  const lte = buildLte(raw, s.minLight, s.maxLight, s.sun);
  const ra0 = groundBoxLower(track);
  const ground = (c: number) => lte[c * 7]!;
  const setGround = (c: number, v: number) => { lte[c * 7] = v; };

  if (s.altBias > 0) {
    let maxz = 0;
    for (let c = 0; c < 65536; c++) if (raw[c]! > maxz) maxz = raw[c]!;
    const zscale = new Int32Array(256);
    for (let nz = 0; nz < 256; nz++) zscale[nz] = 65536 - Math.trunc((s.altBias * (maxz - nz) * (maxz - nz)) / 100);
    for (let c = 0; c < 65536; c++) setGround(c, clampLight((zscale[raw[c]!]! * ground(c)) >> 16));
  }

  if (s.shadow > 0) {
    const sx = s.sun === 2 ? 1 : s.sun === 4 ? -1 : 0;
    const sy = s.sun === 1 ? 1 : s.sun === 3 ? -1 : 0;
    const darken = (c: number) => setGround(c, clampLight(Math.trunc(((100 - s.shadow) * ground(c)) / 100)));
    for (let j = 0; j < 256; j++) {
      const jj = j << 8;
      for (let i = 0; i < 256; i++) {
        let z0 = raw[i + jj]!;
        if (s.sun === 0) {
          const bot = z0;
          if (ra0[i + jj]! > bot || ra0[i + ((jj - 256) & 0xff00)]! > bot || ra0[((i - 1) & 255) + jj]! > bot || ra0[((i - 1) & 255) + ((jj - 256) & 0xff00)]! > bot) darken(i + jj);
          continue;
        }
        let u = i, v = j, vv = jj;
        for (let d = 0; d < 16; d++) {
          const bot = z0;
          const top = z0 >= 250 ? 255 : (z0 + 12) & 255;
          const r = [ra0[u + vv]!, ra0[u + ((vv - 256) & 0xff00)]!, ra0[((u - 1) & 255) + vv]!, ra0[((u - 1) & 255) + ((vv - 256) & 0xff00)]!];
          if ((z0 += 12) >= 255) break;
          u += sx; v += sy; vv = v << 8;
          if (u < 0 || u > 255 || v < 0 || v > 255) break;
          if (raw[u + vv]! > z0 || r.some((h) => h > bot && h <= top)) { darken(i + jj); break; }
        }
      }
    }

    // Shadows from static objects.
    for (const box of track.boxes) {
      if (!(box.mass < 1) || box.type === 6 || box.type === 10 || box.type === TRAXX_BOX_RAMP || !box.modelName) continue;
      const verts = modelVertices(box.modelName);
      if (!verts || !verts.length) continue;
      let minx = 10000, maxx = -10000, miny = 10000, maxy = -10000, minz = 10000, maxz = -10000;
      for (let k = 0; k + 2 < verts.length; k += 3) {
        const x = verts[k]!, y = verts[k + 1]!, z = verts[k + 2]!;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (z < minz) minz = z; if (z > maxz) maxz = z;
      }
      let vcoverage = maxz - minz;
      let hcoverage = box.type === 8 || box.type === 9
        ? Math.max(maxx - minx, maxy - miny)
        : s.sun === 1 || s.sun === 3 ? maxx - minx : s.sun === 2 || s.sun === 4 ? maxy - miny : Math.trunc((maxx - minx + (maxy - miny)) / 2);
      hcoverage >>= 6;
      vcoverage >>= 6;
      const ci = Math.trunc((box.ipos[0] + 31) / 64) & 255;
      const cj = Math.trunc((box.ipos[1] + 31) / 64) & 255;
      if (hcoverage < 32) continue;
      hcoverage = Math.trunc((hcoverage + 15) / 64);
      vcoverage = Math.trunc(vcoverage / 64);
      let istart = ci - Math.trunc(hcoverage / 2), iend = ci + Math.trunc(hcoverage / 2);
      let jstart = cj - Math.trunc(hcoverage / 2), jend = cj + hcoverage;
      if (s.sun === 1) { jstart = cj - vcoverage; jend = cj; }
      else if (s.sun === 2) { istart = ci - vcoverage; iend = ci; }
      else if (s.sun === 3) { jstart = cj; jend = cj + vcoverage; }
      else if (s.sun === 4) { istart = ci; iend = ci + vcoverage; }
      for (let j = jstart; j <= jend; j++) {
        const jj = j << 8;
        for (let i = istart; i <= iend; i++) {
          const c = (i & 255) + (jj & 0xff00);
          setGround(c, clampLight(Math.trunc(((100 - Math.trunc((2 * s.shadow) / 3)) * ground(c)) / 100)));
        }
      }
    }
  }
  track.lte = lte;
}
