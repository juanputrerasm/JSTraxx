/*
  Generate Terrain for the 16-bit grids (Traxx 1.7: TrackPOD/TrackPODTerrainGen.cpp TerrainGenV,
  Include/TrackPODTerrainGen.h). Classic 8-bit tracks keep generateTerrain (terrain-gen.ts), which
  is TerrainGen8: the dialog's old code, byte for byte.

  TerrainGenV makes size x size heights in v (a step is 256 v), row-major Z rows, wrapping (Traxx origin/main
  adds the 512 world's 512 and 2048 grids, and a v6 track's unit and ceiling):
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

/*
  ClassicV: hills and valleys in float steps. Cells per 32 ft: 1 on the coarse grids (256, 512), 4 on the fine
  ones (1024, 2048); area: how many times the 256 world's ground the grid covers (1, or 4 at 512 and 2048), so
  the hills per area stay the 256 world's. Traxx origin/main: spu is the steps per unit of ground, hill and
  valley (1 for the 256 steps; unitv / 256 on a v6 track) and lo / hi the clamp of each add, in steps (1 and
  255 as the byte code; hi is the terrain's top on a v6 track). Nothing is truncated.
*/
function classicV(p: TerrainGenSettings, size: number, shift: number, t: Float32Array, rand: MsvcRand, spu: number, lo: number, hi: number): void {
  const mask = size - 1;
  const scale = size >= 1024 ? 4 : 1;
  const area = size >= 1024 ? (size / 1024) * (size / 1024) : (size / 256) * (size / 256);
  const smoothness = p.smoothness;
  let nhills = 40 + Math.trunc(((100 - smoothness) * 4096) / 100);
  const hillsize = (4 + Math.trunc((smoothness * 32) / 100)) * scale;
  if (scale > 1) nhills *= TERRAINGEN_FINE_COUNT_SCALE;
  nhills *= area;
  const ground = f32(p.ground * spu), hillmax = f32(p.hillHeight * spu), valleymax = f32(p.valleyDepth * spu);
  t.fill(ground);
  for (let n = 0; n < nhills; n++) {
    const x = rand.next() & mask;
    const y = rand.next() & mask;
    const w = Math.trunc((hillsize * (rand.next() & 4095)) / 4096);
    const h = Math.trunc((hillsize * (rand.next() & 4095)) / 4096);
    const hz = f32(f32(hillmax * (rand.next() & 4095)) / 4096);
    const vz = f32(f32(valleymax * (rand.next() & 4095)) / 4096);
    const dz = rand.next() & 1 ? hz : -vz;
    for (let j = y; j < y + h; j++) {
      const row = (j & mask) << shift;
      for (let i = x; i < x + w; i++) {
        let value = f32(t[row + (i & mask)]! + dz);
        if (value < lo) value = lo;
        else if (value > hi) value = hi;
        t[row + (i & mask)] = value;
      }
    }
  }
}

/*
  FractalV: diamond-square over the whole grid with the 256 relax and range, clamped to [0, 255] steps.
  hillpos: the range on the 0..255 scale (the hill slider itself for the 256 steps); sc stretches the result
  (1 for the 256 steps, hmax / 65535 on a tall terrain).
*/
function fractalV(p: TerrainGenSettings, size: number, shift: number, t: Float32Array, rand: MsvcRand, hillpos: number, sc: number): void {
  const mask = size - 1;
  const h = (255 - hillpos) / 255;
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
    t[k] = f32(value * sc);
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
  TerrainGenV: the 16-bit generator. size is 256 or 512 (CLASSIC16, SPLINE on a 256 or 512 world) or 1024 or
  2048 (FULL MAP); any other size is refused with null, as TerrainGenV returns FALSE. Traxx origin/main:
  `unitv` is how many v one unit of ground, hill and Classic's valley is (0 or 256: a step; a v6 track's dialog
  passes 1 and the three in v) and `hmax` the terrain's height limit, the top of every result (65535 for a
  classic track). A tall limit gives an Int32Array, any other a Uint16Array.
*/
export function terrainGenV(p: TerrainGenSettings, size: number): Uint16Array | null;
export function terrainGenV(p: TerrainGenSettings, size: number, unitv: number, hmax: number): Uint16Array | Int32Array | null;
export function terrainGenV(p: TerrainGenSettings, size: number, unitv = 0, hmax = 65535): Uint16Array | Int32Array | null {
  const shift = size === 256 ? 8 : size === 512 ? 9 : size === 1024 ? 10 : size === 2048 ? 11 : 0;
  if (!shift) return null;
  const t = new Float32Array(size * size);
  const rand = new MsvcRand(p.seed);
  // A step (unitv 0 or 256) is the old meaning; anything else is a v6 track's own unit.
  const stepunits = unitv === 0 || unitv === 256;
  if (p.mode === TERRAINGEN_CLASSIC) {
    if (stepunits) classicV(p, size, shift, t, rand, 1, 1, 255);
    else classicV(p, size, shift, t, rand, f32(unitv / 256), 1, f32(hmax / 256));
  } else if (stepunits) fractalV(p, size, shift, t, rand, p.hillHeight, 1);
  else {
    let hillpos = (p.hillHeight * unitv) / 256;
    let sc = 1;
    if (hmax > 65535) {
      hillpos = (hillpos * 65535) / hmax;
      sc = f32(hmax / 65535);
    }
    if (hillpos > 255) hillpos = 255;
    else if (hillpos < 0) hillpos = 0;
    fractalV(p, size, shift, t, rand, hillpos, sc);
  }
  const npasses = p.mode === TERRAINGEN_CLASSIC ? 12 + Math.trunc((30 * p.smoothness) / 100) : Math.trunc(p.smoothness / 5);
  if (size <= 512) {
    // The 256 filter itself (the same on the 512 coarse grid, with its own row length), in place and in the
    // same order, without the >> 2 truncation.
    const all = size * size - 1;
    for (let n = 0; n < npasses; n++) {
      for (let k = 0; k <= all; k++) t[k] = f32(f32(f32(f32(t[k]! + t[(k + 1) & all]!) + t[(k + size) & all]!) + t[(k + size + 1) & all]!) * 0.25);
    }
  } else smoothFine(t, size, npasses);
  const out = hmax > 65535 ? new Int32Array(size * size) : new Uint16Array(size * size);
  for (let k = 0; k < size * size; k++) {
    let v = Math.floor(t[k]! * 256.0 + 0.5);
    if (v < 0) v = 0;
    else if (v > hmax) v = hmax;
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

/**
  OnEditGenTerrain: the dialog set-up for terrain mode 0..3 (CLASSIC8, CLASSIC16, SPLINE, FINE) on a world of
  `cells` (Traxx origin/main: 256, or 512, whose grids are 512 and the Full Map's 2048).
*/
export function terrainGenTarget(terrainMode: number, cells = 256): TerrainGenTarget {
  const wn = cells === 512 ? 512 : 256;
  switch (terrainMode) {
    case 1: return { gridSize: wn, precise: true, forText: `For: 16-bit Classic (${wn} × 32 ft)` };
    case 2: return { gridSize: wn, precise: true, forText: `For: Finer Heights 16-bit Spline (${wn} × 32 ft)` };
    case 3: return { gridSize: 4 * wn, precise: true, forText: `For: Precision 8 ft grid and 16-bit Heights Full Map (${4 * wn} × 8 ft)` };
    default: return { gridSize: 256, precise: false, forText: "For: Traditional 8-bit" };
  }
}

/**
  OnGenRebuild's preview: the grey picture of a 16-bit result (v >> 8 per cell, gridSize square). Traxx
  origin/main: on a v6 track (hmax given) the grey spans the track's own range, v * 255 / hmax. The 8-bit
  generator's bytes are their own preview.
*/
export function terrainGenPreview(v: Uint16Array | Int32Array, hmax?: number): Uint8Array {
  const g = new Uint8Array(v.length);
  for (let k = 0; k < v.length; k++) {
    const x = hmax ? Math.trunc((v[k]! * 255) / hmax) : v[k]! >> 8;
    g[k] = x < 0 ? 0 : x > 255 ? 255 : x;
  }
  return g;
}

/** TerrainGenDlg.cpp VFromPos: a 0..255 slider position to v on 0..hmax. */
export function genVFromPos(pos: number, hmax: number): number {
  if (pos <= 0) return 0;
  if (pos >= 255) return hmax;
  return Math.floor((pos * hmax) / 255 + 0.5);
}

/** PosFromV: v to the nearest slider position, 0..255. */
export function genPosFromV(v: number, hmax: number): number {
  const pos = Math.floor((v * 255) / hmax + 0.5);
  return pos < 0 ? 0 : pos > 255 ? 255 : pos;
}

/*
  What a v6 track's dialog remembers between visits (TerrainGenDlg.cpp s_v6ground and the rest): in v, and the
  roughness, the Fractal range and the smoothness as slider positions; kept apart from the classic steps, two
  sets, [0] Standard V6 and [1] Tall (V6Slot). Defaults 200 ft, 100 ft, 40 ft; the range starts at the hill's.
*/
export interface TerrainGenFeet { ground: number; hill: number; valley: number; rough: number; range: number; smooth: number }

const V6_GEN: TerrainGenFeet[] = [0, 1].map(() => ({ ground: 200 * 128, hill: 100 * 128, valley: 40 * 128, rough: 20, range: -1, smooth: 40 }));

/** V6Slot. */
export function genFeetSlot(hmax: number): number {
  return hmax > 65535 ? 1 : 0;
}

/** OnInitDialog: the remembered values held inside this track's limit. */
export function genFeetStart(hmax: number): TerrainGenFeet {
  const m = V6_GEN[genFeetSlot(hmax)]!, top = Math.max(1, hmax);
  const hill = Math.min(m.hill, top);
  return { ground: Math.min(m.ground, top), hill, valley: Math.min(m.valley, top), rough: m.rough, range: m.range >= 0 ? m.range : genPosFromV(hill, top), smooth: m.smooth };
}

/** OnOK: the values remembered for the next visit. */
export function genFeetRemember(hmax: number, f: TerrainGenFeet): void {
  V6_GEN[genFeetSlot(hmax)] = { ...f };
}

/** OnGenRebuild's parameters on a v6 track: unit 1 v; Fractal's hill is its range position, its valley the roughness. */
export function genFeetParams(mode: number, f: TerrainGenFeet, hmax: number): { ground: number; hillHeight: number; valleyDepth: number; smoothness: number } {
  const classic = mode === TERRAINGEN_CLASSIC;
  return { ground: f.ground, hillHeight: classic ? f.hill : genVFromPos(f.range, hmax), valleyDepth: classic ? f.valley : f.rough, smoothness: f.smooth };
}
