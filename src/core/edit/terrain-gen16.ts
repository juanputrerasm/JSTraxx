/*
  Generate Terrain for the 16-bit grids (Traxx 1.7: TrackPOD/TrackPODTerrainGen.cpp TerrainGenV,
  Include/TrackPODTerrainGen.h). Classic 8-bit tracks keep generateTerrain (terrain-gen.ts), which
  is TerrainGen8: the dialog's old code, byte for byte.

  TerrainGenV makes size x size heights in v (a step is 256 v), row-major Z rows, wrapping:
    256 (CLASSIC16, SPLINE)  the same algorithms and the same rand() draws as TerrainGen8, in float
                             steps with nothing truncated, so the smoothing leaves real fractions
    1024 (FULL MAP, 8 ft)    native: Classic with positions over 0..1023 and hills 4x the cells
                             across (the same hill count, TERRAINGEN_FINE_COUNT_SCALE 1); Fractal as
                             diamond-square over 1024; the smoothing a centred, separable blur of
                             three extended boxes with the variance of the 256 passes
  v = round(steps * 256), clamped 0..65535. The float arithmetic is single precision where the C++
  uses float and double where it uses double, so a seed gives Traxx's exact heights.
*/

import { MsvcRand, type TerrainGenSettings } from "./terrain-gen.ts";

export const TERRAINGEN_CLASSIC = 0;
export const TERRAINGEN_FRACTAL = 1;
/** TERRAINGEN_FINE_COUNT_SCALE: the 1024 hill count is the 256 one times this. */
const TERRAINGEN_FINE_COUNT_SCALE = 1;

const f32 = Math.fround;

/** FractalRecurseV: FractalRecurse on any power-of-two grid, the same arithmetic and draws in the same order. */
function fractalRecurseV(fred: Float32Array, i: number, j: number, spacing: number, range: number, mask: number, shift: number, rand: MsvcRand): void {
  if (spacing < 2) return;
  const half = spacing >> 1;
  let ii = i, jj = j;
  const v1 = fred[ii + (jj << shift)]!;
  ii = (i + spacing) & mask;
  const v2 = fred[ii + (jj << shift)]!;
  jj = (j + spacing) & mask;
  const v3 = fred[ii + (jj << shift)]!;
  ii = i;
  const v4 = fred[ii + (jj << shift)]!;
  fred[i + half + ((j + half) << shift)] = f32(f32(f32(f32(f32(v1 + v2) + v3) + v4) / 4) + f32(range * ((rand.next() & 255) - 127)));
  for (let k = 0; k < 4; k++) {
    let u: number, v: number;
    switch (k) {
      case 0: u = i + half; v = j; break;
      case 1: u = i; v = j + half; break;
      case 2: u = i + spacing; v = j + half; break;
      default: u = i + half; v = j + spacing; break;
    }
    let y = v & mask;
    let x = (u - half) & mask;
    const a = fred[x + (y << shift)]!;
    x = (u + half) & mask;
    const b = fred[x + (y << shift)]!;
    x = u & mask;
    y = (v - half) & mask;
    const c = fred[x + (y << shift)]!;
    y = (v + half) & mask;
    const d = fred[x + (y << shift)]!;
    fred[(u & mask) + ((v & mask) << shift)] = f32(f32(f32(f32(f32(a + b) + c) + d) / 4) + f32(range * ((rand.next() & 255) - 127)));
  }
}

/** ClassicV: hills and valleys in float steps, each add clamped to [1, 255], nothing truncated. */
function classicV(p: TerrainGenSettings, size: number, shift: number, t: Float32Array, rand: MsvcRand): void {
  const mask = size - 1;
  const scale = size / 256;
  const smoothness = p.smoothness;
  let nhills = 40 + Math.trunc(((100 - smoothness) * 4096) / 100);
  const hillsize = (4 + Math.trunc((smoothness * 32) / 100)) * scale;
  if (scale > 1) nhills *= TERRAINGEN_FINE_COUNT_SCALE;
  t.fill(f32(p.ground));
  for (let n = 0; n < nhills; n++) {
    const x = rand.next() & mask;
    const y = rand.next() & mask;
    const w = Math.trunc((hillsize * (rand.next() & 4095)) / 4096);
    const h = Math.trunc((hillsize * (rand.next() & 4095)) / 4096);
    const hz = f32(f32(p.hillHeight * (rand.next() & 4095)) / 4096);
    const vz = f32(f32(p.valleyDepth * (rand.next() & 4095)) / 4096);
    const dz = rand.next() & 1 ? hz : -vz;
    for (let j = y; j < y + h; j++) {
      const row = (j & mask) << shift;
      for (let i = x; i < x + w; i++) {
        let value = f32(t[row + (i & mask)]! + dz);
        if (value < 1) value = 1;
        else if (value > 255) value = 255;
        t[row + (i & mask)] = value;
      }
    }
  }
}

/** FractalV: diamond-square over the whole grid with the 256 relax and range, clamped to [0, 255] steps. */
function fractalV(p: TerrainGenSettings, size: number, shift: number, t: Float32Array, rand: MsvcRand): void {
  const mask = size - 1;
  const h = (255 - p.hillHeight) / 255;
  const relax = f32(Math.pow(2, -h));
  t.fill(0);
  let spacing = size;
  let range = f32(1);
  while (spacing >= 2) {
    for (let j = 0; j < size; j += spacing) for (let i = 0; i < size; i += spacing) fractalRecurseV(t, i, j, spacing, range, mask, shift, rand);
    spacing >>= 1;
    range = f32(range * relax);
  }
  for (let k = 0; k < size * size; k++) {
    let value = f32(f32(f32(t[k]! * p.valleyDepth) / 256) + 127);
    if (value <= 0) value = 0;
    else if (value >= 255) value = 255;
    t[k] = value;
  }
}

/** BoxLine: one wrapped, centred extended-box pass along a line (weight 1 on -r..r, alpha on +-(r+1)). */
function boxLine(src: Float32Array, out: Float32Array, outOff: number, n: number, r: number, alpha: number): void {
  const mask = n - 1;
  const inv = 1.0 / (2 * r + 1 + 2.0 * alpha);
  let sum = 0.0;
  for (let d = -r; d <= r; d++) sum += src[d & mask]!;
  for (let k = 0; k < n; k++) {
    out[outOff + k] = (sum + alpha * (src[(k - r - 1) & mask]! + src[(k + r + 1) & mask]!)) * inv;
    sum += src[(k + r + 1) & mask]! - src[(k - r) & mask]!;
  }
}

/** BoxColumns: the same pass down the columns, a whole row at a time. */
function boxColumns(src: Float32Array, out: Float32Array, n: number, r: number, alpha: number, colsum: Float64Array): void {
  const mask = n - 1;
  const inv = 1.0 / (2 * r + 1 + 2.0 * alpha);
  colsum.fill(0);
  for (let d = -r; d <= r; d++) {
    const row = (d & mask) * n;
    for (let x = 0; x < n; x++) colsum[x]! += src[row + x]!;
  }
  for (let k = 0; k < n; k++) {
    const lo = ((k - r - 1) & mask) * n;
    const hi = ((k + r + 1) & mask) * n;
    const leave = ((k - r) & mask) * n;
    const dst = k * n;
    for (let x = 0; x < n; x++) {
      out[dst + x] = (colsum[x]! + alpha * (src[lo + x]! + src[hi + x]!)) * inv;
      colsum[x]! += src[hi + x]! - src[leave + x]!;
    }
  }
}

/**
  SmoothFine: the 1024 smoothing. npasses of the 256 filter are a binomial of variance npasses / 4
  coarse cells^2 per axis, 4 * npasses fine cells^2; three centred extended boxes per axis reach it.
*/
function smoothFine(t: Float32Array, n: number, npasses: number): void {
  if (npasses <= 0) return;
  const boxes = 3;
  const s = (4.0 * npasses) / boxes;
  let r = 0;
  while (((r + 1) * (r + 2)) / 3.0 <= s) r++;
  const s2 = (r * (r + 1) * (2 * r + 1)) / 6.0;
  const alpha = f32((s * (2 * r + 1) - 2.0 * s2) / (2.0 * ((r + 1) * (r + 1) - s)));
  const tmp = new Float32Array(n * n);
  const line = new Float32Array(n);
  const colsum = new Float64Array(n);
  for (let b = 0; b < boxes; b++) {
    for (let y = 0; y < n; y++) {
      line.set(t.subarray(y * n, y * n + n));
      boxLine(line, t, y * n, n, r, alpha);
    }
    boxColumns(t, tmp, n, r, alpha, colsum);
    t.set(tmp);
  }
}

/**
  TerrainGenV: the 16-bit generator. size is 256 (CLASSIC16, SPLINE) or 1024 (FULL MAP); any other
  size is refused with null, as TerrainGenV returns FALSE.
*/
export function terrainGenV(p: TerrainGenSettings, size: number): Uint16Array | null {
  let shift: number;
  if (size === 256) shift = 8;
  else if (size === 1024) shift = 10;
  else return null;
  const t = new Float32Array(size * size);
  const rand = new MsvcRand(p.seed);
  if (p.mode === TERRAINGEN_CLASSIC) classicV(p, size, shift, t, rand);
  else fractalV(p, size, shift, t, rand);
  const npasses = p.mode === TERRAINGEN_CLASSIC ? 12 + Math.trunc((30 * p.smoothness) / 100) : Math.trunc(p.smoothness / 5);
  if (size === 256) {
    // The 256 filter itself, in place and in the same order, without the >> 2 truncation.
    for (let n = 0; n < npasses; n++) {
      for (let k = 0; k < 65536; k++) t[k] = f32(f32(f32(f32(t[k]! + t[(k + 1) & 65535]!) + t[(k + 256) & 65535]!) + t[(k + 257) & 65535]!) * 0.25);
    }
  } else smoothFine(t, size, npasses);
  const out = new Uint16Array(size * size);
  for (let k = 0; k < size * size; k++) {
    let v = Math.floor(t[k]! * 256.0 + 0.5);
    if (v < 0) v = 0;
    else if (v > 65535) v = 65535;
    out[k] = v;
  }
  return out;
}

/** The grid the dialog makes for a track's mode (CTraxxView::OnEditGenTerrain's switch). */
export interface TerrainGenTarget {
  /** 256, or 1024 on a Full Map. */
  gridSize: number;
  /** Float generation (TerrainGenV) rather than TerrainGen8's bytes. */
  precise: boolean;
  /** The dialog's "For:" line (IDC_INFOTEXT). */
  forText: string;
}

/** OnEditGenTerrain: the dialog set-up for terrain mode 0..3 (CLASSIC8, CLASSIC16, SPLINE, FINE). */
export function terrainGenTarget(terrainMode: number): TerrainGenTarget {
  switch (terrainMode) {
    case 1: return { gridSize: 256, precise: true, forText: "For: 16-bit Classic (256 × 32 ft)" };
    case 2: return { gridSize: 256, precise: true, forText: "For: 16-bit Spline (256 × 32 ft)" };
    case 3: return { gridSize: 1024, precise: true, forText: "For: 16-bit Full Map (1024 × 8 ft)" };
    default: return { gridSize: 256, precise: false, forText: "For: Classic 8-bit" };
  }
}

/**
  OnGenRebuild's preview: the grey picture of a 16-bit result (v >> 8 per cell, gridSize square).
  The 8-bit generator's bytes are their own preview.
*/
export function terrainGenPreview(v: Uint16Array): Uint8Array {
  const g = new Uint8Array(v.length);
  for (let k = 0; k < v.length; k++) g[k] = v[k]! >> 8;
  return g;
}
