/*
  The vegetation planter, a port of Traxx/VegetationPlanter.cpp (Traxx 1.7.0): the one place
  vegetation is generated. The engine loads what this writes and never re-plants, so the same
  masks, rules and seed must always give the same result. Hence xorshift32, a fixed planting
  order, and a per-colour generator seeded from seed ^ hash(layer, colour).

  Bit for bit: Traxx is a Win32 SSE2 build (/fp:precise), so every float operation rounds to
  float32. Each one is wrapped in f32 (Math.fround) here; a double computed from float32
  operands and rounded once is the correctly rounded float result, so this matches. DWORD
  arithmetic uses Math.imul and >>> 0.

  Units (the C++ header comment): box / truck / course ipos are half-feet; a box adds its
  fraction / 256 of a step; terrain bytes are 2 ft steps, raw[x + (z << 8)]; a model's
  vertices are 128 per foot, Z up, and basez (the lowest vertex less 31) / 128 is its lowest
  point in feet; the world is 256 x 256 tiles of 32 ft = 8192 ft.

  No DOM here: a mask arrives decoded (vegDecodeMask takes the file bytes and uses OpenPhotex's
  PNG decoder or JSTraxx's TGA decoder).
*/
import { decodePngSamples } from "../../vendor/openphotex/texture/png.js";
import { decodeTga } from "../image/image-format.ts";
import { stbiPngRgba } from "../image/stbi-png.ts";
import { cFixed, f32 } from "../traxx/cformat.ts";
import {
  VEG_COLLIDE_NONE, VEG_COLLIDE_TRUNK, VEG_FLAG_CASTSHADOW, VEG_FLAG_CROSSFADE, VEG_FLAG_FACING, VEG_KIND_GROUND,
  VEG_KIND_PLACED, VEG_LAYER_GRASS, VEG_LAYER_TREES, VEG_MAX_CLUMPS, VEG_MAX_CLUMPS_PER_TILE, VEG_MAX_COLOURS,
  VEG_MAX_GROUND_SPECIES, VEG_MAX_SPECIES, VEG_MAX_TREES, VEG_MODELNAME, VEG_NLAYERS, vegDefaultColour, vegMaskCrc,
} from "../traxx/veg.ts";
import { TERRAINMODE_CLASSIC8 } from "../traxx/terrain16.ts";
import type { TxxTrack } from "../traxx/txx.ts";
import type { VegInstanceIssue } from "../traxx/instancing.ts";
import type { VegClumpRec, VegColour, VegEntry, VegMaskFile, VegSpeciesRec, VegTreeRec, Vegetation } from "../traxx/veg.ts";

/** VEG_PALETTE_TOLERANCE: pixels within this many levels per channel count as the colour. */
export const VEG_PALETTE_TOLERANCE = 8;
/** VEG_UNMATCHED_WARN. */
export const VEG_UNMATCHED_WARN = f32(0.01);

const VEG_PI = f32(3.14159265358979);
/*
  Track format version 6 (track-format-v6.md 8.1, 9.2): the world is N x N tiles of 32 ft, W =
  32 N ft, and a tree's x and z run 0..W * 256 - 1 (1/256 ft). The planter reads N from its input
  (VegPlantInput.cells) for the length of one vegPlant call; at N = 256 every number is Traxx's.
  A mask covers the whole world, so at N = 512 a pixel is twice as many feet.
*/
const VW = { n: 256, m: 255, sh: 8, t: 65536, ft: 8192 };
function setVegWorld(n: number): void {
  const N = n === 512 ? 512 : 256;
  VW.n = N; VW.m = N - 1; VW.sh = N === 512 ? 9 : 8; VW.t = N * N; VW.ft = 32 * N;
}
const VEG_NO_LABEL = 255;
const VEG_MAX_MASK_SIDE = 16384;
const VEG_POISSON_TRIES = 30;
const VEG_MAX_SAMPLES = 4000000;
const INV_2_24 = f32(1 / 16777216);
const SQRT_HALF = f32(0.70710678);

/* Small helpers. */
/** RoundI: (int)floor((double)v + 0.5). */
function roundI(v: number): number {
  return Math.floor(v + 0.5) | 0;
}
function clampI(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/*
  The generator: xorshift32 (Marsaglia).
*/
export interface VegRng {
  s: number;
}

/** RngNext. */
export function rngNext(r: VegRng): number {
  let x = r.s;
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  r.s = x;
  return x;
}

/** RngSeed: an all-zero state never leaves zero; the first four outputs are spun off. */
export function rngSeed(seed: number): VegRng {
  const r: VegRng = { s: (seed >>> 0) !== 0 ? seed >>> 0 : 0x9e3779b9 };
  for (let i = 0; i < 4; i++) rngNext(r);
  return r;
}

/** RngFloat: [0,1) with 24 bits. */
export function rngFloat(r: VegRng): number {
  return f32((rngNext(r) >>> 8) * INV_2_24);
}

/** ColourHash: FNV-1a over (layer, r, g, b). */
export function colourHash(layer: number, r: number, g: number, b: number): number {
  let h = 2166136261;
  for (const byte of [layer & 255, r & 255, g & 255, b & 255]) h = Math.imul((h ^ byte) >>> 0, 16777619) >>> 0;
  return h;
}

/** VegGroundH. */
function groundH(raw: Uint8Array, i: number, j: number): number {
  if (raw.length === 65536) return 2 * raw[((j & 255) << 8) | (i & 255)]!;
  const n = Math.round(Math.sqrt(raw.length)); // version 6: an N x N raw wraps at N
  return 2 * raw[(j & (n - 1)) * n + (i & (n - 1))]!;
}

/*
  VegGroundHeight's CLASSIC8 branch (TrackPOD/TrackPODTerrain.cpp): the engine's groundHeight1
  on the raw bytes, triangle for triangle, in feet. Other modes plant on the drive surface:
  SurfaceHeightV(floor(x*512 + 0.5), floor(z*512 + 0.5)) / 128, which the caller supplies.
*/
export function vegGroundHeightClassic8(raw: Uint8Array, x: number, z: number): number {
  const gx = Math.floor(x / 32) | 0;
  const gz = Math.floor(z / 32) | 0;
  const fx = f32(f32(x / 32) - gx);
  const fz = f32(f32(z / 32) - gz);
  const h00 = groundH(raw, gx, gz);
  const h10 = groundH(raw, gx + 1, gz);
  const h01 = groundH(raw, gx, gz + 1);
  const h11 = groundH(raw, gx + 1, gz + 1);
  if ((gx & 1) === (gz & 1)) {
    if (fx > fz) return f32(f32(h00 + f32((h10 - h00) * fx)) + f32((h11 - h10) * fz));
    return f32(f32(h00 + f32((h11 - h01) * fx)) + f32((h01 - h00) * fz));
  }
  const ifx = f32(1 - fx);
  if (ifx > fz) return f32(f32(h10 + f32((h00 - h10) * ifx)) + f32((h01 - h00) * fz));
  return f32(f32(h10 + f32((h01 - h11) * ifx)) + f32((h11 - h10) * fz));
}

/** The surface-mode ground from a SurfaceHeightV function (v units, 128 per foot). */
export function vegGroundFromSurface(surfaceHeightV: (px: number, py: number) => number): (x: number, z: number) => number {
  return (x, z) => f32(surfaceHeightV(Math.floor(x * 512 + 0.5) | 0, Math.floor(z * 512 + 0.5) | 0) / 128);
}

/*
  Masks.
*/
/** VegMaskImage: tightly packed RGB, row 0 = Z 0 (never flipped). */
export interface VegMaskImage {
  w: number;
  h: number;
  rgb: Uint8Array;
}

/*
  VegDecodeMask: stbi_load_from_memory(..., 3). Three components: grey is replicated, alpha
  dropped, 16-bit samples keep their high byte (stbi__convert_16_to_8), and a palette PNG is
  expanded through its PLTE to RGB (stbi__expand_png_palette), as stb does for any req_comp of 3.
*/
export function vegDecodeMask(mask: VegMaskFile | null): { img: VegMaskImage | null; err: string | null } {
  if (!mask) return { img: null, err: "There is no mask loaded." };
  if (mask.data.length === 0) return { img: null, err: "The mask could not be read." };
  let w = 0, h = 0, rgb: Uint8Array;
  try {
    const d = mask.data;
    if (d.length >= 8 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) {
      const s = decodePngSamples(d);
      w = s.width; h = s.height;
      const rgba = stbiPngRgba(s);
      rgb = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        rgb[i * 3] = rgba[i * 4]!; rgb[i * 3 + 1] = rgba[i * 4 + 1]!; rgb[i * 3 + 2] = rgba[i * 4 + 2]!;
      }
    } else {
      const t = decodeTga(d, "mask");
      w = t.width; h = t.height;
      rgb = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        rgb[i * 3] = t.rgba[i * 4]!; rgb[i * 3 + 1] = t.rgba[i * 4 + 1]!; rgb[i * 3 + 2] = t.rgba[i * 4 + 2]!;
      }
    }
  } catch (e) {
    return { img: null, err: `The mask could not be decoded: ${(e as Error).message}.` };
  }
  if (w < 1 || h < 1 || w > VEG_MAX_MASK_SIDE || h > VEG_MAX_MASK_SIDE) return { img: null, err: "The mask has an unreasonable size." };
  return { img: { w, h, rgb }, err: null };
}

function withinTol(a0: number, a1: number, a2: number, b0: number, b1: number, b2: number): boolean {
  return Math.abs(a0 - b0) <= VEG_PALETTE_TOLERANCE && Math.abs(a1 - b1) <= VEG_PALETTE_TOLERANCE &&
    Math.abs(a2 - b2) <= VEG_PALETTE_TOLERANCE;
}

const PAL_TABLE_BITS = 20;
const PAL_TABLE_SIZE = 1 << PAL_TABLE_BITS;
const PAL_TABLE_FULL = (PAL_TABLE_SIZE * 3) / 4;

/*
  VegExtractPalette: the distinct painted colours (black = nothing), most used first, merging
  any within tolerance of a more used one; a colour is accepted only when at least
  max(16, painted / 2000) pixels carry it.
*/
export function vegExtractPalette(img: VegMaskImage, max: number): { rgb: [number, number, number][]; count: number[]; unmatched: number } {
  const keys = new Uint32Array(PAL_TABLE_SIZE);
  const counts = new Int32Array(PAL_TABLE_SIZE);
  let ndistinct = 0, overflow = 0, painted = 0;
  let lastkey = 0, lastslot = -1;
  const npix = img.w * img.h;
  for (let i = 0; i < npix; i++) {
    const key = ((img.rgb[3 * i]! << 16) | (img.rgb[3 * i + 1]! << 8) | img.rgb[3 * i + 2]!) >>> 0;
    if (key === 0) continue;
    painted += 1;
    if (lastslot >= 0 && key === lastkey) { counts[lastslot]!++; continue; }
    let slot = Math.imul(key, 2654435761) >>> (32 - PAL_TABLE_BITS);
    let full = false;
    for (;;) {
      if (keys[slot] === 0) {
        if (ndistinct >= PAL_TABLE_FULL) { overflow++; full = true; break; }
        keys[slot] = key;
        ndistinct++;
        break;
      }
      if (keys[slot] === key) break;
      slot = (slot + 1) & (PAL_TABLE_SIZE - 1);
    }
    if (full) { lastslot = -1; continue; }
    counts[slot]!++;
    lastkey = key;
    lastslot = slot;
  }
  const list: { key: number; count: number }[] = [];
  for (let i = 0; i < PAL_TABLE_SIZE; i++) if (keys[i] !== 0) list.push({ key: keys[i]!, count: counts[i]! });
  list.sort((a, b) => (a.count !== b.count ? (a.count > b.count ? -1 : 1) : a.key !== b.key ? (a.key < b.key ? -1 : 1) : 0));
  let minCount = Math.trunc(painted / 2000);
  if (minCount < 16) minCount = 16;
  let lost = overflow;
  const rgb: [number, number, number][] = [];
  const merged: number[] = [];
  for (const e of list) {
    const c0 = (e.key >>> 16) & 255, c1 = (e.key >>> 8) & 255, c2 = e.key & 255;
    let home = -1;
    for (let k = 0; k < rgb.length; k++) if (withinTol(c0, c1, c2, rgb[k]![0], rgb[k]![1], rgb[k]![2])) { home = k; break; }
    if (home >= 0) merged[home]! += e.count;
    else if (e.count >= minCount && rgb.length < max) { rgb.push([c0, c1, c2]); merged.push(e.count); }
    else lost += e.count;
  }
  return { rgb, count: merged, unmatched: painted > 0 ? f32(lost / painted) : 0 };
}

/*
  VegSyncPalette: bring a layer's colours in line with its mask's palette. Colours already
  present (within tolerance, nearest first) keep their name and entries; new ones get the
  defaults and "colour N"; colours no longer painted are dropped. Returns the unmatched
  fraction, or -1 with the reason.
*/
export function vegSyncPalette(v: Vegetation, layer: number): { unmatched: number; err: string | null } {
  if (layer < 0 || layer >= VEG_NLAYERS) return { unmatched: -1, err: "Bad vegetation layer." };
  const { img, err } = vegDecodeMask(v.masks[layer] ?? null);
  if (!img) return { unmatched: -1, err };
  const pal = vegExtractPalette(img, VEG_MAX_COLOURS);
  const old = v.colours[layer]!;
  const claimed = new Array<boolean>(old.length).fill(false);
  const out: VegColour[] = [];
  for (let i = 0; i < pal.rgb.length && out.length < VEG_MAX_COLOURS; i++) {
    const p = pal.rgb[i]!;
    let best = -1, bestd = 0x7fffffff;
    for (let k = 0; k < old.length; k++) {
      if (claimed[k]) continue;
      const c = old[k]!;
      if (!withinTol(c.r, c.g, c.b, p[0], p[1], p[2])) continue;
      const d = Math.abs(c.r - p[0]) + Math.abs(c.g - p[1]) + Math.abs(c.b - p[2]);
      if (d < bestd) { bestd = d; best = k; }
    }
    if (best >= 0) { claimed[best] = true; out.push(old[best]!); }
    else {
      const c = vegDefaultColour(layer);
      c.r = p[0]; c.g = p[1]; c.b = p[2];
      c.name = `colour ${out.length + 1}`.slice(0, 31);
      out.push(c);
    }
  }
  v.colours[layer] = out;
  return { unmatched: pal.unmatched, err: null };
}

/*
  Labelling: which colour each pixel belongs to (one byte per pixel, VEG_NO_LABEL for none),
  with each colour's bounding pixel box.
*/
function labelPixel(r: number, g: number, b: number, cols: readonly VegColour[]): number {
  if ((r | g | b) === 0) return -1;
  let best = -1, bestd = 0x7fffffff;
  for (let i = 0; i < cols.length; i++) {
    const dr = Math.abs(r - cols[i]!.r), dg = Math.abs(g - cols[i]!.g), db = Math.abs(b - cols[i]!.b);
    if (dr > VEG_PALETTE_TOLERANCE || dg > VEG_PALETTE_TOLERANCE || db > VEG_PALETTE_TOLERANCE) continue;
    const d = dr + dg + db;
    if (d < bestd) { bestd = d; best = i; }
  }
  return best;
}

interface LayerMap {
  w: number;
  h: number;
  label: Uint8Array;
  minpx: Int32Array;
  maxpx: Int32Array;
  minpz: Int32Array;
  maxpz: Int32Array;
  painted: number;
  unmatched: number;
}

function buildLayerMap(img: VegMaskImage, cols: readonly VegColour[]): LayerMap {
  const m: LayerMap = {
    w: img.w, h: img.h, label: new Uint8Array(img.w * img.h),
    minpx: new Int32Array(VEG_MAX_COLOURS).fill(0x7fffffff), maxpx: new Int32Array(VEG_MAX_COLOURS).fill(-1),
    minpz: new Int32Array(VEG_MAX_COLOURS).fill(0x7fffffff), maxpz: new Int32Array(VEG_MAX_COLOURS).fill(-1),
    painted: 0, unmatched: 0,
  };
  let lastKey = -1, lastl = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const p = (y * img.w + x) * 3;
      const r = img.rgb[p]!, g = img.rgb[p + 1]!, b = img.rgb[p + 2]!;
      const key = (r << 16) | (g << 8) | b;
      let lab: number;
      if (key === lastKey) lab = lastl;
      else { lab = labelPixel(r, g, b, cols); lastKey = key; lastl = lab; }
      if (key !== 0) { m.painted += 1; if (lab < 0) m.unmatched += 1; }
      if (lab < 0) m.label[y * img.w + x] = VEG_NO_LABEL;
      else {
        m.label[y * img.w + x] = lab;
        if (x < m.minpx[lab]!) m.minpx[lab] = x;
        if (x > m.maxpx[lab]!) m.maxpx[lab] = x;
        if (y < m.minpz[lab]!) m.minpz[lab] = y;
        if (y > m.maxpz[lab]!) m.maxpz[lab] = y;
      }
    }
  }
  return m;
}

/** PixelOf: floor(ft * size / 8192), clamped. */
function pixelOf(ft: number, size: number): number {
  return clampI(Math.floor((ft * size) / VW.ft) | 0, 0, size - 1);
}

function inRegion(m: LayerMap, colour: number, x: number, z: number): boolean {
  return m.label[pixelOf(z, m.h) * m.w + pixelOf(x, m.w)] === colour;
}

/*
  PointGrid: a point set bucketed by 32 ft tile, each point with its own spacing.
*/
class PointGrid {
  head = new Int32Array(VW.t).fill(-1);
  next = new Int32Array(1024);
  x = new Float32Array(1024);
  z = new Float32Array(1024);
  sp = new Float32Array(1024);
  n = 0;

  reset(): void {
    this.head.fill(-1);
    this.n = 0;
  }

  add(x: number, z: number, sp: number): void {
    if (this.n >= this.x.length) {
      const cap = this.x.length * 2;
      const grow = <T extends Int32Array | Float32Array>(a: T, make: (n: number) => T): T => { const b = make(cap); b.set(a); return b; };
      this.next = grow(this.next, (n) => new Int32Array(n));
      this.x = grow(this.x, (n) => new Float32Array(n));
      this.z = grow(this.z, (n) => new Float32Array(n));
      this.sp = grow(this.sp, (n) => new Float32Array(n));
    }
    const t = tileIndex(x, z);
    this.x[this.n] = x;
    this.z[this.n] = z;
    this.sp[this.n] = sp;
    this.next[this.n] = this.head[t]!;
    this.head[t] = this.n;
    this.n++;
  }

  /** PGNear: any point closer than (sp + its spacing) / 2. */
  near(x: number, z: number, sp: number, maxsp: number): boolean {
    const reach = f32(f32(sp + maxsp) * 0.5);
    const cr = clampI(Math.ceil(reach / 32) | 0, 1, VW.m);
    const tx = clampI(Math.floor(x / 32) | 0, 0, VW.m);
    const tz = clampI(Math.floor(z / 32) | 0, 0, VW.m);
    for (let cz = tz - cr; cz <= tz + cr; cz++) {
      if (cz < 0 || cz > VW.m) continue;
      for (let cx = tx - cr; cx <= tx + cr; cx++) {
        if (cx < 0 || cx > VW.m) continue;
        for (let i = this.head[cx + (cz << VW.sh)]!; i >= 0; i = this.next[i]!) {
          const dx = f32(this.x[i]! - x);
          const dz = f32(this.z[i]! - z);
          const lim = f32(f32(sp + this.sp[i]!) * 0.5);
          if (f32(f32(dx * dx) + f32(dz * dz)) < f32(lim * lim)) return true;
        }
      }
    }
    return false;
  }
}

function tileIndex(x: number, z: number): number {
  const tx = clampI(Math.floor(x / 32) | 0, 0, VW.m);
  const tz = clampI(Math.floor(z / 32) | 0, 0, VW.m);
  return tx + (tz << VW.sh);
}

/*
  Obstacles: capsules (a circle is a capsule with both ends the same), bucketed by the tiles
  they touch.
*/
interface Obstacle {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  r: number;
}

class ObstacleSet {
  list: Obstacle[] = [];
  start = new Int32Array(VW.t + 1);
  index = new Int32Array(0);

  add(x1: number, z1: number, x2: number, z2: number, r: number): void {
    this.list.push({ x1, z1, x2, z2, r });
  }

  private tiles(o: Obstacle): [number, number, number, number] {
    const minx = o.x1 < o.x2 ? o.x1 : o.x2, maxx = o.x1 < o.x2 ? o.x2 : o.x1;
    const minz = o.z1 < o.z2 ? o.z1 : o.z2, maxz = o.z1 < o.z2 ? o.z2 : o.z1;
    return [
      clampI(Math.floor(f32(minx - o.r) / 32) | 0, 0, VW.m), clampI(Math.floor(f32(minz - o.r) / 32) | 0, 0, VW.m),
      clampI(Math.floor(f32(maxx + o.r) / 32) | 0, 0, VW.m), clampI(Math.floor(f32(maxz + o.r) / 32) | 0, 0, VW.m),
    ];
  }

  build(): void {
    const start = new Int32Array(VW.t + 1);
    let total = 0;
    const spans = this.list.map((o) => this.tiles(o));
    for (const [tx0, tz0, tx1, tz1] of spans) {
      for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) { start[tx + (tz << VW.sh) + 1]!++; total++; }
    }
    for (let i = 0; i < VW.t; i++) start[i + 1]! += start[i]!;
    const index = new Int32Array(total);
    const fill = start.slice(0, VW.t);
    spans.forEach(([tx0, tz0, tx1, tz1], i) => {
      for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) index[fill[tx + (tz << VW.sh)]!++] = i;
    });
    this.start = start;
    this.index = index;
  }

  /** ObstacleHit. */
  hit(x: number, z: number): boolean {
    const t = tileIndex(x, z);
    for (let k = this.start[t]!; k < this.start[t + 1]!; k++) {
      const o = this.list[this.index[k]!]!;
      const vx = f32(o.x2 - o.x1), vz = f32(o.z2 - o.z1);
      const wx = f32(x - o.x1), wz = f32(z - o.z1);
      const len2 = f32(f32(vx * vx) + f32(vz * vz));
      let u = 0;
      if (len2 > f32(1e-6)) {
        u = f32(f32(f32(wx * vx) + f32(wz * vz)) / len2);
        if (u < 0) u = 0;
        if (u > 1) u = 1;
      }
      const dx = f32(wx - f32(u * vx));
      const dz = f32(wz - f32(u * vz));
      if (f32(f32(dx * dx) + f32(dz * dz)) < f32(o.r * o.r)) return true;
    }
    return false;
  }
}

/*
  What the planter reads from the track.
*/
/** A loaded model, as CTrackPODModel holds the two numbers the planter uses. */
export interface VegModelInfo {
  /** basez: the lowest vertex Z (or 0), less 31, in model units (128 per foot). */
  basez: number;
  /** ModelRadiusFt: the horizontal radius, feet (a float32). */
  radiusFt: number;
}

/**
  The two numbers from a model's vertices in Traxx's model units (x, y, z per vertex, z up:
  model-geometry's `raw`). ModelRadiusFt and the TranslateBIN basez.
*/
export function vegModelInfo(raw: ArrayLike<number>): VegModelInfo {
  let best2 = 0, basez = 0;
  for (let i = 0; i + 2 < raw.length; i += 3) {
    const x = raw[i]!, y = raw[i + 1]!, z = raw[i + 2]!;
    const d2 = f32(f32(x * x) + f32(y * y));
    if (d2 > best2) best2 = d2;
    if (z < basez) basez = z;
  }
  return { basez: basez - 31, radiusFt: f32(f32(Math.sqrt(best2)) / 128) };
}

export interface VegPlantBox {
  type: number;
  /** Half-feet. */
  ipos: ArrayLike<number>;
  /** [xfraction, yfraction, ...] in 1/256 of an ipos step. */
  fraction: ArrayLike<number>;
  length: number;
  width: number;
  modelName: string;
}

export interface VegPlantInput {
  veg: Vegetation;
  /** Track format version 6: the world's cells a side, 256 (absent) or 512. */
  cells?: number;
  /** Ground height in feet (float32) at world feet (x, z): VegGroundHeight. */
  ground: (x: number, z: number) => number;
  /** GetWaterLevel4: quarter steps of 2 ft. */
  waterLevel4: number;
  /** lakes.tmap: the lake id (1-based, 0 dry) per tile, x + (z << 8); null for none. */
  lakeTiles: Uint8Array | null;
  /** Each lake's H in water units (0.5 ft), lake id - 1. */
  lakeHeights: readonly number[];
  groundBoxes: readonly { x: number; y: number; upper: number }[];
  boxes: readonly VegPlantBox[];
  /** The main course then the extended courses (null for an empty slot); cstart / cend in half-feet. */
  courses: readonly (readonly { cstart: ArrayLike<number>; cend: ArrayLike<number> }[] | null)[];
  /** The start grid, slots 0 to 8; ipos in half-feet. */
  trucks: readonly { ipos: ArrayLike<number> }[];
  /**
    terrain->GetMode() (Traxx 1.8.0 PlanGrass): TileAllUnderWater judges a tile only on Classic
    8-bit terrain. Absent = Classic 8-bit.
  */
  terrainMode?: number;
  /** IsModelLoaded + model[]: a model in the track's model list by bare or full name, or null. */
  model: (name: string) => VegModelInfo | null;
  /** Decoded masks, when the caller already has them (otherwise decoded from veg.masks). */
  images?: (VegMaskImage | null)[];
  /**
    VegModelsThatWillNotInstance on the freshly planted vegetation (core/traxx/instancing.ts
    vegModelsThatWillNotInstance with the track's models and InstPodTextureOK); without it the
    instancing warning is not given.
  */
  notInstanced?: (veg: Vegetation) => readonly VegInstanceIssue[];
}

export interface VegPlantResult {
  /** FALSE only when nothing could be planted at all; veg is then untouched. */
  ok: boolean;
  /** Human-readable lines (Say). */
  report: string[];
}

interface PlantEntry {
  ok: boolean;
  species: number;
  minY: number;
}

interface Ctx {
  input: VegPlantInput;
  veg: Vegetation;
  report: string[];
  haswater: boolean;
  waterft: number;
  raised: Uint8Array;
  obst: ObstacleSet;
  species: VegSpeciesRec[];
  nground: number;
  trees: VegTreeRec[];
  tg: PointGrid;
  maxspacing: number;
  warned: string[];
  rejRaised: number;
  rejObstacle: number;
  rejWater: number;
  rejSlope: number;
  rejOverlap: number;
  treecap: boolean;
  speccap: boolean;
}

/** UnderLakeWater: ground on a lake tile below the lake's H is under water. */
function underLakeWater(c: Ctx, x: number, z: number, ground: number): boolean {
  const tmap = c.input.lakeTiles;
  if (!tmap) return false;
  const l = tmap[tileIndex(x, z)]!;
  if (l === 0 || l > c.input.lakeHeights.length) return false;
  return ground < f32(c.input.lakeHeights[l - 1]! * 0.5);
}

function warnMissingModel(c: Ctx, name: string): void {
  if (c.warned.some((w) => w.toLowerCase() === name.toLowerCase())) return;
  if (c.warned.length < 64) c.warned.push(name.slice(0, VEG_MODELNAME - 1));
  c.report.push(`Warning: model ${name} is not in the track's model list - its entries plant nothing.`);
}

/** FindOrAddSpecies: one species per distinct (model, farmodel, kind, collide, flags, trunk). */
function findOrAddSpecies(c: Ctx, e: VegEntry, kind: number): number {
  const s: VegSpeciesRec = {
    model: e.model.slice(0, VEG_MODELNAME - 1),
    farmodel: e.facing ? "" : e.farmodel.slice(0, VEG_MODELNAME - 1),
    kind,
    collide: kind === VEG_KIND_GROUND ? VEG_COLLIDE_NONE : clampI(e.collide, 0, 2),
    flags: (e.shadow ? VEG_FLAG_CASTSHADOW : 0) | (e.facing ? VEG_FLAG_FACING : 0),
    trunkdiam: 0, trunkheight: 0,
  };
  if (e.crossfade && kind === VEG_KIND_PLACED && !e.facing && s.farmodel) s.flags |= VEG_FLAG_CROSSFADE;
  if (s.collide === VEG_COLLIDE_TRUNK) {
    s.trunkdiam = clampI(roundI(f32(e.trunkdiam * 64)), 0, 65535);
    s.trunkheight = clampI(roundI(f32(e.trunkheight * 16)), 0, 65535);
  }
  for (let i = 0; i < c.species.length; i++) {
    const o = c.species[i]!;
    if (o.model === s.model && o.farmodel === s.farmodel && o.kind === s.kind && o.collide === s.collide &&
      o.flags === s.flags && o.trunkdiam === s.trunkdiam && o.trunkheight === s.trunkheight) return i;
  }
  if (c.species.length >= VEG_MAX_SPECIES || (kind === VEG_KIND_GROUND && c.nground >= VEG_MAX_GROUND_SPECIES)) {
    if (!c.speccap) {
      c.report.push(`Warning: too many species (at most ${VEG_MAX_SPECIES}, of which ${VEG_MAX_GROUND_SPECIES} ground cover) - the rest are skipped.`);
      c.speccap = true;
    }
    return -1;
  }
  c.species.push(s);
  if (kind === VEG_KIND_GROUND) c.nground++;
  return c.species.length - 1;
}

/** ResolveEntries: the total weight of usable entries (0 = the colour plants nothing). */
function resolveEntries(c: Ctx, col: VegColour, kind: number, pe: PlantEntry[]): number {
  let total = 0;
  col.entries.forEach((e, i) => {
    pe[i] = { ok: false, species: -1, minY: 0 };
    const name = e.model.slice(0, VEG_MODELNAME - 1);
    if (!name) return;
    const m = c.input.model(name);
    if (!m) { warnMissingModel(c, name); return; }
    const sp = findOrAddSpecies(c, e, kind);
    pe[i]!.species = sp;
    if (sp < 0) return;
    if (e.facing && e.farmodel) c.report.push(`${name} is facing - its far card is not used.`);
    pe[i]!.minY = f32(m.basez / 128);
    pe[i]!.ok = true;
    total += e.weight > 0 ? e.weight : 1;
  });
  return total;
}

function pickEntry(rng: VegRng, col: VegColour, pe: PlantEntry[], total: number): number {
  let r = rngNext(rng) % total;
  for (let i = 0; i < col.entries.length; i++) {
    if (!pe[i]!.ok) continue;
    r -= col.entries[i]!.weight > 0 ? col.entries[i]!.weight : 1;
    if (r < 0) return i;
  }
  for (let i = col.entries.length - 1; i >= 0; i--) if (pe[i]!.ok) return i;
  return -1;
}

/** GatherObstacles: scenery footprints, gates, the AI course and the start grid. */
function gatherObstacles(c: Ctx): void {
  const veg = c.veg;
  let corridor = veg.corridorft;
  if (corridor < 0) corridor = 0;
  for (const box of c.input.boxes) {
    // A light and a fog volume are not obstacles; a checkpoint gate (6) gets the corridor.
    if (box.type === 12 || box.type === 14) continue;
    const x = f32(f32(box.ipos[0]! + f32(box.fraction[0]! / 256)) * 0.5);
    const z = f32(f32(box.ipos[1]! + f32(box.fraction[1]! / 256)) * 0.5);
    const model = box.modelName ? c.input.model(box.modelName) : null;
    let r = model ? model.radiusFt : f32(Math.sqrt(box.length * box.length + box.width * box.width) * 0.5);
    r = f32(r + (box.type === 6 ? corridor : veg.objectmarginft));
    c.obst.add(x, z, x, z, r);
  }
  for (const crs of c.input.courses) {
    if (!crs) continue;
    for (const seg of crs) {
      c.obst.add(f32(seg.cstart[0]! * 0.5), f32(seg.cstart[1]! * 0.5), f32(seg.cend[0]! * 0.5), f32(seg.cend[1]! * 0.5), corridor);
    }
  }
  for (let v = 0; v < 9 && v < c.input.trucks.length; v++) {
    const p = c.input.trucks[v]!.ipos;
    if (p[0] === 0 && p[1] === 0) continue;
    const x = f32(p[0]! * 0.5), z = f32(p[1]! * 0.5);
    c.obst.add(x, z, x, z, corridor);
  }
}

/*
  Trees.
*/
interface TreeRun {
  col: VegColour;
  pe: PlantEntry[];
  totalw: number;
  resolved: boolean;
  dead: boolean;
  rng: VegRng;
  spacing: number;
  planted: number;
}

/** TryPlantTree: a sample is a candidate tree; true if it was planted. */
function tryPlantTree(c: Ctx, run: TreeRun, fx: number, fz: number): boolean {
  const col = run.col, rng = run.rng, ground = c.input.ground;
  const density = clampI(col.density, 0, 100);
  if (rngNext(rng) % 100 >= density) return false;
  if (!run.resolved) {
    run.resolved = true;
    run.totalw = resolveEntries(c, col, VEG_KIND_PLACED, run.pe);
    if (run.totalw < 1) {
      c.report.push(`Warning: tree colour "${col.name}" has no usable model - it plants nothing.`);
      run.dead = true;
    }
  }
  if (run.dead) return false;

  // Every random draw is made before any test.
  const ei = pickEntry(rng, col, run.pe, run.totalw);
  let scale = rngFloat(rng);
  let hw = (Math.trunc(f32(rngFloat(rng) * 65536)) | 0) & 0xffff;
  const sinkr = rngFloat(rng);
  if (ei < 0) return false;

  const e = col.entries[ei]!;
  let smin = e.scalemin, smax = e.scalemax;
  if (smax < smin) { const t = smin; smin = smax; smax = t; }
  scale = f32(smin + f32(f32(smax - smin) * scale));
  if (!e.rotate) hw = 0;

  const sw = clampI(roundI(f32(scale * 4096)), 256, 65535);
  const sq = f32(sw / 4096);
  const xq = clampI(roundI(f32(fx * 256)), 0, VW.ft * 256 - 1);
  const zq = clampI(roundI(f32(fz * 256)), 0, VW.ft * 256 - 1);
  const x = f32(xq / 256), z = f32(zq / 256);

  if (c.raised[tileIndex(x, z)]) { c.rejRaised++; return false; }
  if (c.tg.near(x, z, run.spacing, c.maxspacing)) { c.rejOverlap++; return false; }
  if (c.obst.hit(x, z)) { c.rejObstacle++; return false; }

  const g = ground(x, z);
  if ((c.haswater && g < c.waterft) || underLakeWater(c, x, z, g)) { c.rejWater++; return false; }

  if (e.slopemax > 0) {
    const gx = f32(f32(ground(f32(x + 1), z) - ground(f32(x - 1), z)) * 0.5);
    const gz = f32(f32(ground(x, f32(z + 1)) - ground(x, f32(z - 1))) * 0.5);
    const slope = f32((Math.atan(Math.sqrt(f32(f32(gx * gx) + f32(gz * gz)))) * 180) / 3.14159265358979);
    if (slope > e.slopemax) { c.rejSlope++; return false; }
  }

  // Seat on the LOWEST ground under the trunk.
  const sp = run.pe[ei]!.species;
  const trunk = c.species[sp]!.trunkdiam;
  const r = trunk > 0 ? f32(f32(f32(trunk / 64) * sq) * 0.5) : 1;
  let minGround = g;
  for (let k = 0; k < 8; k++) {
    const a = f32(k * f32(VEG_PI / 4));
    const h = ground(f32(x + f32(r * f32(Math.cos(a)))), f32(z + f32(r * f32(Math.sin(a)))));
    if (h < minGround) minGround = h;
  }
  const y = roundI(f32(f32(f32(minGround - f32(sq * run.pe[ei]!.minY)) - f32(sinkr * e.sink)) * 256));

  if (c.trees.length >= VEG_MAX_TREES) return false;
  c.tg.add(x, z, run.spacing);
  c.trees.push({ x: xq, y, z: zq, species: sp, heading: hw, scale: sw, tier: clampI(e.tier, 0, 2) }); // scenery detail level 0..2 only (ddf6a1f)
  run.planted++;
  return true;
}

/** PlantTreeColour: multi-region Bridson over the colour's pixels. */
function plantTreeColour(c: Ctx, m: LayerMap, ci: number, pg: PointGrid): void {
  const col = c.veg.colours[VEG_LAYER_TREES]![ci]!;
  const run: TreeRun = {
    col, pe: [], totalw: 0, resolved: false, dead: false,
    rng: rngSeed((c.veg.seed ^ colourHash(VEG_LAYER_TREES, col.r, col.g, col.b)) >>> 0),
    spacing: col.spacing < 2 ? 2 : col.spacing, planted: 0,
  };
  if (col.entries.length < 1) {
    c.report.push(`Warning: tree colour "${col.name}" has no entries - it plants nothing.`);
    return;
  }
  if (m.maxpx[ci]! < m.minpx[ci]!) {
    c.report.push(`Trees, ${col.name}: this colour is not painted in the mask.`);
    return;
  }
  const r = run.spacing;
  const cs = f32(r * SQRT_HALF);
  const x0 = f32(f32(m.minpx[ci]! * VW.ft) / m.w);
  const x1 = f32(f32((m.maxpx[ci]! + 1) * VW.ft) / m.w);
  const z0 = f32(f32(m.minpz[ci]! * VW.ft) / m.h);
  const z1 = f32(f32((m.maxpz[ci]! + 1) * VW.ft) / m.h);
  const nx = Math.ceil(f32(f32(x1 - x0) / cs)) | 0;
  const nz = Math.ceil(f32(f32(z1 - z0) / cs)) | 0;
  pg.reset();
  let active = new Int32Array(256), nactive = 0;
  const push = (i: number) => {
    if (nactive >= active.length) { const a = new Int32Array(active.length * 2); a.set(active); active = a; }
    active[nactive++] = i;
  };
  let stop = false;
  for (let iz = 0; iz < nz && !stop; iz++) {
    for (let ix = 0; ix < nx && !stop; ix++) {
      const cx = f32(x0 + f32(f32(ix + 0.5) * cs));
      const cz = f32(z0 + f32(f32(iz + 0.5) * cs));
      if (cx >= VW.ft || cz >= VW.ft) continue;
      if (!inRegion(m, ci, cx, cz)) continue;
      if (pg.near(cx, cz, r, r)) continue;
      pg.add(cx, cz, r);
      push(pg.n - 1);
      tryPlantTree(c, run, cx, cz);
      if (run.dead) { stop = true; break; }
      if (c.trees.length >= VEG_MAX_TREES) { c.treecap = true; stop = true; break; }

      while (nactive > 0 && !stop) {
        const pick = rngNext(run.rng) % nactive;
        const base = active[pick]!;
        const bx = pg.x[base]!, bz = pg.z[base]!;
        let found = false;
        for (let k = 0; k < VEG_POISSON_TRIES; k++) {
          const rad = f32(r * f32(Math.sqrt(1 + 3 * rngFloat(run.rng))));
          const ang = f32(f32(rngFloat(run.rng) * 2) * VEG_PI);
          const px = f32(bx + f32(rad * f32(Math.cos(ang))));
          const pz = f32(bz + f32(rad * f32(Math.sin(ang))));
          if (px < 0 || pz < 0 || px >= VW.ft || pz >= VW.ft) continue;
          if (!inRegion(m, ci, px, pz)) continue;
          if (pg.near(px, pz, r, r)) continue;
          if (pg.n >= VEG_MAX_SAMPLES) { stop = true; break; }
          pg.add(px, pz, r);
          push(pg.n - 1);
          found = true;
          tryPlantTree(c, run, px, pz);
          if (run.dead) stop = true;
          if (c.trees.length >= VEG_MAX_TREES) { c.treecap = true; stop = true; }
          break;
        }
        if (!found && !stop) active[pick] = active[--nactive]!;
      }
    }
  }
  if (pg.n >= VEG_MAX_SAMPLES) {
    c.report.push(`Warning: tree colour "${col.name}" needs more than ${VEG_MAX_SAMPLES} samples - its spacing is too small for the area; planting stopped.`);
  }
  c.report.push(`Trees, ${col.name}: ${run.planted} planted.`);
}

/*
  Grass.
*/
interface AxisTable {
  tile: Int32Array;
  first: Int32Array;
  count: Int32Array;
}

/** AxisBuild: pixel centre (p + 0.5) lies in tile floor((p + 0.5) * 256 / size). */
function axisBuild(size: number): AxisTable {
  const a: AxisTable = { tile: new Int32Array(size), first: new Int32Array(VW.n), count: new Int32Array(VW.n) };
  for (let p = 0; p < size; p++) {
    const t = clampI(Math.floor(((p + 0.5) * VW.n) / size) | 0, 0, VW.m);
    a.tile[p] = t;
    if (a.count[t] === 0) a.first[t] = p;
    a.count[t]!++;
  }
  return a;
}

interface GrassCtx {
  clumps: VegClumpRec[];
  /** How many clumps the plan made room for (Traxx 1.8.0: exactly what pass 1 planned). */
  cap: number;
  tilecount: Int32Array;
  /** Defensive only: the plan keeps both from ever happening. */
  tilecap: boolean;
  globalcap: boolean;
}

/** SpacedInt: a count with a space between the thousands ("2 097 152"). */
export function spacedInt(v: number): string {
  const digits = String(Math.abs(Math.trunc(v)));
  let out = v < 0 ? "-" : "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += " ";
    out += digits[i];
  }
  return out;
}

/** VEG_SAME_MASK_NOTE (VegetationPlanter.h, Traxx 1.8.0). */
export const VEG_SAME_MASK_NOTE =
  "Note: the grass mask (_G) is an exact copy of the tree mask (_V) - every tree area will also be " +
  "carpeted in grass. Paint a separate _G unless that is what you want.";

/** VegMasksIdentical: both masks loaded and the very same bytes (a _G copied from the _V). */
export function vegMasksIdentical(veg: Pick<Vegetation, "masks">): boolean {
  const a = veg.masks[VEG_LAYER_TREES]?.data, b = veg.masks[VEG_LAYER_GRASS]?.data;
  if (!a || !b || a.length === 0 || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** ColourHasModel: at least one entry whose model the track holds (ResolveEntries' test, no species made). */
function colourHasModel(c: Ctx, col: VegColour): boolean {
  for (const e of col.entries) {
    const name = e.model.slice(0, VEG_MODELNAME - 1);
    if (!name) continue;
    if (c.input.model(name)) return true;
  }
  return false;
}

/** TileAllUnderWater: on Classic 8-bit, the tile's highest corner is below the flat water or its lake. */
function tileAllUnderWater(c: Ctx, tx: number, tz: number): boolean {
  if ((c.input.terrainMode ?? TERRAINMODE_CLASSIC8) !== TERRAINMODE_CLASSIC8) return false;
  let level = -1.0e30;
  if (c.haswater) level = c.waterft;
  const tmap = c.input.lakeTiles;
  if (tmap) {
    const l = tmap[tx + (tz << VW.sh)]!;
    if (l !== 0 && l <= c.input.lakeHeights.length) {
      const h = f32(c.input.lakeHeights[l - 1]! * 0.5);
      if (h > level) level = h;
    }
  }
  if (level < -1.0e29) return false; // no water on this tile
  const g = c.input.ground;
  let top = g(tx * 32, tz * 32);
  top = Math.max(top, g((tx + 1) * 32, tz * 32));
  top = Math.max(top, g(tx * 32, (tz + 1) * 32));
  top = Math.max(top, g((tx + 1) * 32, (tz + 1) * 32));
  return top < level;
}

/*
  PlanGrass (Traxx 1.8.0, a2b55ca, VegetationPlanter.cpp): grass pass 1, no random numbers.
    1. want[ci][t] = round(pertile x coverage) as PlantGrassColour always computed it; not counted:
       raised tiles, colours with no entries, colours whose entries name no model in the track
       (deadhad says such a colour had coverage), tiles wholly under water (TileAllUnderWater).
    2. A tile over VEG_MAX_CLUMPS_PER_TILE keeps exactly the cap: colour i keeps
       floor(cap x cum_i / sum) minus what the colours before it kept.
    3. W = the sum. Over VEG_MAX_CLUMPS every count becomes n x cap / W rounded down with the
       remainders carried in (colour, tz, tx) order, so the total lands exactly on the cap.
  Returns the planned total and W.
*/
function planGrass(c: Ctx, m: LayerMap, ncol: number, colcount: Int32Array, ax: AxisTable, az: AxisTable,
  want: Int32Array, deadhad: Uint8Array): { planned: number; wanted: number } {
  want.fill(0);
  deadhad.fill(0);
  for (let ci = 0; ci < ncol; ci++) {
    const col = c.veg.colours[VEG_LAYER_GRASS]![ci]!;
    const pertile = clampI(col.pertile, 0, VEG_MAX_CLUMPS_PER_TILE);
    if (col.entries.length < 1) continue; // PlantGrassColour says so; it plants nothing
    const dead = !colourHasModel(c, col);
    for (let tz = 0; tz < VW.n; tz++) {
      for (let tx = 0; tx < VW.n; tx++) {
        const coarse = ax.count[tx] === 0 || az.count[tz] === 0;
        const t = tx + (tz << VW.sh);
        if (c.raised[t]) continue;
        let coverage: number;
        if (coarse) coverage = inRegion(m, ci, tx * 32 + 16, tz * 32 + 16) ? 1 : 0;
        else {
          const count = colcount[ci * VW.t + t]!;
          if (count < 1) continue;
          coverage = f32(count / (ax.count[tx]! * az.count[tz]!));
        }
        const n = roundI(f32(pertile * coverage));
        if (n < 1) continue;
        if (dead) { deadhad[ci] = 1; continue; }
        if (tileAllUnderWater(c, tx, tz)) continue;
        want[ci * VW.t + t] = n;
      }
    }
  }
  // 2. The per-tile cap, split in proportion with the cumulative rounding as the carry.
  for (let t = 0; t < VW.t; t++) {
    let sum = 0;
    for (let ci = 0; ci < ncol; ci++) sum += want[ci * VW.t + t]!;
    if (sum > VEG_MAX_CLUMPS_PER_TILE) {
      let cum = 0, keptBefore = 0;
      for (let ci = 0; ci < ncol; ci++) {
        const i = ci * VW.t + t;
        cum += want[i]!;
        const keptTo = Math.floor((cum * VEG_MAX_CLUMPS_PER_TILE) / sum);
        want[i] = keptTo - keptBefore;
        keptBefore = keptTo;
      }
    }
  }
  let W = 0;
  for (let i = 0; i < ncol * VW.t; i++) W += want[i]!;
  // 3. Over the engine's cap: the same fraction off everywhere, remainders carried.
  if (W > VEG_MAX_CLUMPS) {
    let carry = 0;
    for (let ci = 0; ci < ncol; ci++) {
      for (let tz = 0; tz < VW.n; tz++) {
        for (let tx = 0; tx < VW.n; tx++) {
          const i = ci * VW.t + tx + (tz << VW.sh);
          const w = want[i]!;
          if (w < 1) continue;
          const scaled = w * VEG_MAX_CLUMPS;
          let out = Math.floor(scaled / W);
          carry += scaled % W;
          if (carry >= W) { carry -= W; out++; }
          want[i] = out;
        }
      }
    }
  }
  let total = 0;
  for (let i = 0; i < ncol * VW.t; i++) total += want[i]!;
  return { planned: total, wanted: W };
}

function plantGrassColour(c: Ctx, gc: GrassCtx, m: LayerMap, ci: number, want: Int32Array, deadhad: boolean, ax: AxisTable, az: AxisTable, pixbuf: Int32Array): void {
  const col = c.veg.colours[VEG_LAYER_GRASS]![ci]!;
  const pe: PlantEntry[] = [];
  const rng = rngSeed((c.veg.seed ^ colourHash(VEG_LAYER_GRASS, col.r, col.g, col.b)) >>> 0);
  const ground = c.input.ground;
  let totalw = 0, planted = 0, resolved = false, dead = false;
  if (col.entries.length < 1) {
    c.report.push(`Warning: grass colour "${col.name}" has no entries - it plants nothing.`);
    return;
  }
  // A colour pass 1 found dead but with coverage: resolved only to print the lazy path's warnings.
  if (deadhad) {
    resolveEntries(c, col, VEG_KIND_GROUND, pe);
    c.report.push(`Warning: grass colour "${col.name}" has no usable model - it plants nothing.`);
    return;
  }
  // Pass 2 (Traxx 1.8.0): every tile's count was decided by planGrass; the random part is as ever.
  outer: for (let tz = 0; tz < VW.n; tz++) {
    for (let tx = 0; tx < VW.n; tx++) {
      const t = tx + (tz << VW.sh);
      const coarse = ax.count[tx] === 0 || az.count[tz] === 0;
      const n = want[ci * VW.t + t]!;
      let nmatch = 0;
      if (n < 1) continue;
      if (!coarse) {
        for (let pz = az.first[tz]!; pz < az.first[tz]! + az.count[tz]!; pz++) {
          for (let px = ax.first[tx]!; px < ax.first[tx]! + ax.count[tx]!; px++) {
            if (m.label[pz * m.w + px] === ci) pixbuf[nmatch++] = px + pz * m.w;
          }
        }
      }
      for (let k = 0; k < n; k++) {
        if (gc.tilecount[t]! >= VEG_MAX_CLUMPS_PER_TILE) { gc.tilecap = true; break; }
        // Cannot happen: the plan sized the buffer. Never truncate by area.
        if (gc.clumps.length >= gc.cap) { gc.globalcap = true; break; }
        let lx: number, lz: number;
        if (coarse) {
          lx = f32(rngFloat(rng) * 32);
          lz = f32(rngFloat(rng) * 32);
        } else {
          const pix = pixbuf[rngNext(rng) % nmatch]!;
          const px = pix % m.w, pz = Math.trunc(pix / m.w);
          let xa = f32(f32(px * VW.ft) / m.w);
          let xb = f32(f32((px + 1) * VW.ft) / m.w);
          let za = f32(f32(pz * VW.ft) / m.h);
          let zb = f32(f32((pz + 1) * VW.ft) / m.h);
          const tx0 = tx * 32, tz0 = tz * 32;
          if (xa < tx0) xa = tx0;
          if (xb > tx0 + 32) xb = tx0 + 32;
          if (za < tz0) za = tz0;
          if (zb > tz0 + 32) zb = tz0 + 32;
          lx = f32(f32(xa + f32(f32(xb - xa) * rngFloat(rng))) - tx0);
          lz = f32(f32(za + f32(f32(zb - za) * rngFloat(rng))) - tz0);
        }
        if (!resolved) {
          resolved = true;
          totalw = resolveEntries(c, col, VEG_KIND_GROUND, pe);
          if (totalw < 1) {
            c.report.push(`Warning: grass colour "${col.name}" has no usable model - it plants nothing.`);
            dead = true;
          }
        }
        if (dead) break;
        const ei = pickEntry(rng, col, pe, totalw);
        let scale = rngFloat(rng);
        let hb = (Math.trunc(f32(rngFloat(rng) * 256)) | 0) & 255;
        const sinkr = rngFloat(rng);
        if (ei < 0) continue;
        const e = col.entries[ei]!;
        let smin = e.scalemin, smax = e.scalemax;
        if (smax < smin) { const tmp = smin; smin = smax; smax = tmp; }
        scale = f32(smin + f32(f32(smax - smin) * scale));
        if (!e.rotate) hb = 0;
        const sb = clampI(roundI(f32(f32(scale - 0.25) * 64)), 0, 255);
        const sq = f32(0.25 + f32(sb / 64));
        const fxq = clampI(roundI(f32(lx * 8)), 0, 255);
        const fzq = clampI(roundI(f32(lz * 8)), 0, 255);
        const wx = f32(tx * 32 + f32(fxq / 8));
        const wz = f32(tz * 32 + f32(fzq / 8));
        const g = ground(wx, wz);
        if ((c.haswater && g < c.waterft) || underLakeWater(c, wx, wz, g)) continue;
        const y = roundI(f32(f32(f32(g - f32(sq * pe[ei]!.minY)) - f32(sinkr * e.sink)) * 256));
        gc.clumps.push({ tx, tz, species: pe[ei]!.species, fx: fxq, fz: fzq, y, heading: hb, scale: sb });
        gc.tilecount[t]!++;
        planted++;
      }
      if (gc.globalcap || dead) break outer;
    }
  }
  c.report.push(`Grass, ${col.name}: ${planted} clumps.`);
}

/*
  VegPlant: plant everything from the masks and rules into veg's species / trees / clumps,
  replacing what was there; records plantedcrc and clears stale and readonly. ok is false only
  when nothing could be planted at all (veg is then left as it was).
*/
export function vegPlant(input: VegPlantInput): VegPlantResult {
  const before = VW.n;
  setVegWorld(input.cells ?? 256);
  try {
    return plantIn(input);
  } finally {
    setVegWorld(before);
  }
}

function plantIn(input: VegPlantInput): VegPlantResult {
  const veg = input.veg;
  const report: string[] = [];
  const c: Ctx = {
    input, veg, report,
    haswater: input.waterLevel4 !== 0, waterft: f32(input.waterLevel4 * 0.5),
    raised: new Uint8Array(VW.t), obst: new ObstacleSet(), species: [], nground: 0, trees: [], tg: new PointGrid(),
    maxspacing: 0, warned: [], rejRaised: 0, rejObstacle: 0, rejWater: 0, rejSlope: 0, rejOverlap: 0,
    treecap: false, speccap: false,
  };
  const pg = new PointGrid();
  const gc: GrassCtx = { clumps: [], cap: 0, tilecount: new Int32Array(VW.t), tilecap: false, globalcap: false };

  // Raised terrain blocks: the engine's rule is ra1 (the upper edge) > 0.
  for (const g of input.groundBoxes) {
    if (g.upper > 0 && g.x >= 0 && g.x < VW.n && g.y >= 0 && g.y < VW.n) c.raised[g.x + (g.y << VW.sh)] = 1;
  }

  const lm: (LayerMap | null)[] = [null, null];
  for (let layer = 0; layer < VEG_NLAYERS; layer++) {
    const lname = layer === VEG_LAYER_TREES ? "tree (_V)" : "grass (_G)";
    const ncol = veg.colours[layer]!.length;
    if (!veg.masks[layer]) {
      if (ncol > 0) report.push(`Warning: there is no ${lname} mask - nothing is planted for it.`);
      continue;
    }
    const given = input.images?.[layer] ?? null;
    const dec = given ? { img: given, err: null } : vegDecodeMask(veg.masks[layer]!);
    if (!dec.img) { report.push(`Warning: the ${lname} mask could not be used: ${dec.err}`); continue; }
    const map = buildLayerMap(dec.img, veg.colours[layer]!);
    lm[layer] = map;
    if (ncol > 0 && map.painted > 0 && f32(map.unmatched / map.painted) > VEG_UNMATCHED_WARN) {
      report.push(`Warning: ${cFixed((100 * map.unmatched) / map.painted, 1)}% of the painted pixels in the ${lname} mask match no colour.`);
      report.push("Paint vegetation masks with a hard-edged brush (no anti-aliasing).");
    }
  }
  if (!lm[0] && !lm[1]) {
    report.push("There is no vegetation mask to plant from.");
    return { ok: false, report };
  }
  if (vegMasksIdentical(veg)) report.push(VEG_SAME_MASK_NOTE);

  gatherObstacles(c);
  c.obst.build();

  // Trees: colour by colour, in colour order.
  const treeMap = lm[VEG_LAYER_TREES];
  if (treeMap) {
    const cols = veg.colours[VEG_LAYER_TREES]!;
    for (const col of cols) {
      const sp = col.spacing < 2 ? 2 : col.spacing;
      if (sp > c.maxspacing) c.maxspacing = sp;
    }
    for (let i = 0; i < cols.length; i++) {
      if (c.trees.length >= VEG_MAX_TREES) { c.treecap = true; break; }
      plantTreeColour(c, treeMap, i, pg);
    }
    if (c.treecap) report.push(`Warning: the tree limit of ${VEG_MAX_TREES} was reached - later colours and areas are bare.`);
    if (c.rejRaised || c.rejObstacle || c.rejWater || c.rejSlope || c.rejOverlap) {
      report.push(`Trees rejected: ${c.rejRaised} on raised ground, ${c.rejObstacle} near objects / the course / the grid, ${c.rejWater} in water, ${c.rejSlope} too steep, ${c.rejOverlap} overlapping.`);
    }
  }

  // Grass.
  const grassMap = lm[VEG_LAYER_GRASS];
  const ncolG = veg.colours[VEG_LAYER_GRASS]!.length;
  if (grassMap && ncolG > 0) {
    const ax = axisBuild(grassMap.w), az = axisBuild(grassMap.h);
    let maxc = 0, maxr = 0;
    for (let t = 0; t < VW.n; t++) {
      if (ax.count[t]! > maxc) maxc = ax.count[t]!;
      if (az.count[t]! > maxr) maxr = az.count[t]!;
    }
    const pixbuf = new Int32Array(Math.max(1, maxc * maxr));
    const colcount = new Int32Array(ncolG * VW.t);
    for (let pz = 0; pz < grassMap.h; pz++) {
      const rowbase = az.tile[pz]! << VW.sh;
      for (let px = 0; px < grassMap.w; px++) {
        const l = grassMap.label[pz * grassMap.w + px]!;
        if (l !== VEG_NO_LABEL) colcount[l * VW.t + rowbase + ax.tile[px]!]!++;
      }
    }
    // Pass 1: how many clumps each (colour, tile) gets, thinned evenly over the engine's cap.
    const want = new Int32Array(ncolG * VW.t), deadhad = new Uint8Array(ncolG);
    const { planned, wanted } = planGrass(c, grassMap, ncolG, colcount, ax, az, want, deadhad);
    gc.cap = planned;
    if (wanted > VEG_MAX_CLUMPS) {
      // "At most": tiles only partly under water are counted whole, and pass 2 drops their submerged clumps.
      report.push(`Grass was thinned evenly to at most ${Math.trunc((100 * planned) / wanted)}% of what the masks ask for (${spacedInt(wanted)} clumps wanted, partly submerged tiles counted whole; the limit is ${spacedInt(VEG_MAX_CLUMPS)}).`);
    }
    // Pass 2: plant exactly those counts, colour by colour, each with its own generator.
    for (let i = 0; i < ncolG; i++) plantGrassColour(c, gc, grassMap, i, want, deadhad[i] !== 0, ax, az, pixbuf);
    // Defensive: the plan makes both impossible.
    if (gc.tilecap || gc.globalcap) report.push("Warning: some grass could not be placed (internal limit) - please report this.");
  }

  // Group the clumps by tile, ascending (tz, tx), and shuffle within each tile.
  let clumpout: VegClumpRec[] = [];
  if (gc.clumps.length > 0) {
    const n = gc.clumps.length;
    const start = new Int32Array(VW.t + 1);
    for (const k of gc.clumps) start[k.tx + (k.tz << VW.sh) + 1]!++;
    for (let i = 0; i < VW.t; i++) start[i + 1]! += start[i]!;
    const fill = start.slice(0, VW.t);
    clumpout = new Array<VegClumpRec>(n);
    for (const k of gc.clumps) clumpout[fill[k.tx + (k.tz << VW.sh)]!++] = k;
    const shuf = rngSeed((veg.seed ^ colourHash(7, 0xa5, 0x5a, 0xc3)) >>> 0);
    for (let g = 0; g < VW.t; g++) {
      const a = start[g]!, b = start[g + 1]!;
      for (let j = b - 1; j > a; j--) {
        const s = a + (rngNext(shuf) % (j - a + 1));
        const tmp = clumpout[j]!;
        clumpout[j] = clumpout[s]!;
        clumpout[s] = tmp;
      }
    }
  }

  // Commit. Trees sorted by tile (z / 8192, then x / 8192); planting order within a tile.
  veg.species = c.species;
  const tstart = new Int32Array(VW.t + 1);
  for (const t of c.trees) tstart[(t.x >> 13) + ((t.z >> 13) << VW.sh) + 1]!++;
  for (let i = 0; i < VW.t; i++) tstart[i + 1]! += tstart[i]!;
  const tfill = tstart.slice(0, VW.t);
  const trees = new Array<VegTreeRec>(c.trees.length);
  for (const t of c.trees) trees[tfill[(t.x >> 13) + ((t.z >> 13) << VW.sh)]!++] = t;
  veg.trees = trees;
  veg.clumps = clumpout;
  for (let layer = 0; layer < VEG_NLAYERS; layer++) veg.plantedcrc[layer] = vegMaskCrc(veg, layer);
  veg.stale = false;
  veg.readonly = false;
  veg.foreign = null;
  report.push(`Planted ${veg.trees.length} trees and ${veg.clumps.length} grass clumps (${veg.species.length} species).`);
  /*
    INSTANCING WARNING, one line per offending model (VegPlant, after the species table is filled):
    a tree model the game cannot instance draws only the nearest ~128 copies, a grass model is
    not drawn at all.
  */
  for (const w of input.notInstanced?.(veg) ?? []) {
    if (w.kind === VEG_KIND_GROUND) report.push(`Warning: ${w.model} will not be instanced by the game (${w.why}) - as grass it is not drawn at all.`);
    else report.push(`Warning: ${w.model} will not be instanced by the game (${w.why}) - as a tree it draws only the nearest ~128 copies.`);
  }
  return { ok: true, report };
}

/** Case-insensitive model lookup by bare or MODELS\ name, as IsModelLoaded compares titles. */
export function vegModelLookup(models: ReadonlyMap<string, VegModelInfo>): (name: string) => VegModelInfo | null {
  const byTitle = new Map<string, VegModelInfo>();
  const title = (n: string) => { const u = n.toUpperCase(); const s = u.lastIndexOf("\\"); return s >= 0 ? u.slice(s + 1) : u; };
  for (const [k, v] of models) byTitle.set(title(k), v);
  return (name) => byTitle.get(title(name)) ?? null;
}

/*
  Re-plant, for the app: VegPlant with its input taken from a track. `models` maps a model
  name (bare or MODELS\) to its vertices in Traxx's model units (model-geometry's `raw`).
  `lakeTiles` is the lakes' tile map (lake id per tile, 1-based) and is null when the track
  has no lakes. `surfaceHeightV` is SurfaceHeightV for a track that is not Classic 8-bit;
  without it such a track cannot be planted (null is returned).
*/
export function vegReplant(
  track: Pick<TxxTrack, "terrainMode" | "heights" | "waterLevel4" | "lakes" | "groundBoxes" | "boxes" | "course" | "extendedCourses" | "trucks"> & { worldCells?: number },
  veg: Vegetation,
  models: ReadonlyMap<string, ArrayLike<number>>,
  lakeTiles: Uint8Array | null,
  surfaceHeightV?: (px: number, py: number) => number,
  notInstanced?: (veg: Vegetation) => readonly VegInstanceIssue[],
): VegPlantResult | null {
  let ground: (x: number, z: number) => number;
  if (track.terrainMode === TERRAINMODE_CLASSIC8) ground = (x, z) => vegGroundHeightClassic8(track.heights, x, z);
  else if (surfaceHeightV) ground = vegGroundFromSurface(surfaceHeightV);
  else return null;
  const info = new Map<string, VegModelInfo>();
  for (const [name, raw] of models) info.set(name, vegModelInfo(raw));
  return vegPlant({
    veg, cells: track.worldCells ?? 256, ground, waterLevel4: track.waterLevel4, lakeTiles, lakeHeights: track.lakes.map((l) => l.height),
    groundBoxes: track.groundBoxes, boxes: track.boxes, courses: [track.course, ...track.extendedCourses],
    trucks: track.trucks, model: vegModelLookup(info), notInstanced, terrainMode: track.terrainMode,
  });
}
