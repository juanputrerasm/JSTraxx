/*
  Make Far Cards (Traxx 1.7, Traxx/VegetationFarCard.cpp, called from VegetationDlg.cpp
  OnMakeCards): one auto-rendered far card per distinct tree-layer model of the vegetation that
  has an entry with no far model of its own.

  A card is TWO upright quads crossed at 90 degrees. The species model is rendered twice on the
  CPU, a FRONT view (looking along +Z from the -Z side) and a SIDE view (looking along +X from
  the -X side), onto the two halves of one square transparent atlas (256, or 512 for a tall
  model), with 2 x 2 supersampling, an alpha-weighted downsample, a 4-pixel transparent gutter
  and a colour bleed into the holes. The atlas is written as a PNG with real alpha plus the
  legacy 256 .RAW / .ACT pair (index 0 = transparent black), and a 384-byte .BIN wears it. The
  .BIN is loaded into the track as an ordinary model and every entry that wanted a card is given
  its name as far model.

  Traxx renders with its own small software rasteriser (its GL is 1.1 with no offscreen
  rendering), so this is a port of that rasteriser, not of an OpenGL path: VcTriangle,
  VcDownsample, VcClearGutter, VcFinish, VcMakeQuad, VcRenderModel. Traxx is an SSE2 build, so
  every float operation is rounded to float32 here (f32).

  The card's name is "V" + a CRC-32 over the generator tag (FARCARD5), the UPPER-CASE bare model
  name, the model's bytes and the bytes of every texture the render drew (the HD source when it
  was drawn, else the legacy .RAW then its .ACT), in that order (VegFarCardHashBegin / Update /
  Name). The same inputs always give the same name, so a card already in the track is reused.

  What JSTraxx does differently, because it is a browser program:
    * The ART and MODELS folders are JSTraxx's (browser storage, then the game library for
      reading), so there is no folder to choose, no "ART folder not set" and no protected game
      folder (VcCardFolder, VegFarCardIsGamePath): nothing is ever written into the library.
    * The PNG is encoded here (filter 4, stb_image_write's deflate) where Traxx asks Windows'
      WIC encoder; the pixels are the same, the compressed bytes are not.
    * A LightWave model (TranslateLWO) is not read: such a model has no faces to draw here.

  Everything that touches storage or the open document goes through a VegFarCardHost, so this
  module stays plain data and runs under node --test.
*/
import { decodePngSamples } from "../../vendor/openphotex/texture/png.js";
import { decodeTga, imageFormatRefusal } from "../image/image-format.ts";
import { stbiPngRgba } from "../image/stbi-png.ts";
import { quantize } from "../image/hd-texture.ts";
import { crc32, stbiZlibCompress } from "./height-image.ts";
import { metalcr2Act3, remapIndices } from "./palette.ts";
import { f32 } from "./cformat.ts";
import { modelInstanceProblem, vegFarCardBaseY, type ModelTextureOk } from "./instancing.ts";
import { VEG_LAYER_TREES, VEG_MODELNAME, type VegEntry, type Vegetation } from "./veg.ts";
import type { TextureAsset } from "../doc/document.ts";

export { vegFarCardBaseY };

/** Part of the card name: Traxx changes it whenever the render or the .BIN layout changes. */
export const VEGCARD_GENERATOR_TAG = "FARCARD5";
/** The folder beside the track Traxx falls back to when no Models folder is set. */
export const VEGCARD_FOLDER = "FarCards";
/** The generated .BIN is always exactly this long. */
export const VEGCARD_BIN_BYTES = 384;
/** "V" + 8 hex digits, no extension. */
export const VEGCARD_NAME_CHARS = 9;

const VEGCARD_GUTTER = 4;
const VEGCARD_SS = 2;
const VEGCARD_SIZE_TALL = 512;
const VEGCARD_SIZE_NORMAL = 256;
const VEGCARD_LEGACY = 256;
const VEGCARD_TALL_RATIO = f32(1.5);
const VEGCARD_MAXTEX = 32;

const VC_MRGL_EOL = 0;
const VC_MRGL_VLIST = 2;
const VC_MRGL_MAGNIFY = 20;
const VC_MRGL_TEXTURE64 = 62;
const VC_MRGL_MATERIAL = 63;
const VC_MRGL_MATFACET = 64;
const VC_MRGL_KEYFRAME = 32;
const VC_MRGL_KEYFRAME64 = 65;
const VC_MAT_FOLIAGE = 0x1089;
const VC_FIXED_ONE = 0x00010000;
const VC_UVMAX = 0x00ffffff;
const VC_UVHALF = 0x00800000;

const VC_UV_SLACK = f32(0.002);

function rdInt(p: Uint8Array, at: number): number {
  return (p[at]! | (p[at + 1]! << 8) | (p[at + 2]! << 16) | (p[at + 3]! << 24)) | 0;
}

/////////////////////////////////////////////////////////////////////////////
// The name

/** VegFarCardHashUpdate: CRC-32 (poly 0xEDB88320) as a running state, started at 0xFFFFFFFF. */
export function vegFarCardHashUpdate(crc: number, data: ArrayLike<number>, len = data.length): number {
  let c = crc >>> 0;
  for (let i = 0; i < len; i++) {
    c ^= data[i]! & 0xff;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return c >>> 0;
}

const asciiBytes = (s: string) => Array.from(s, (ch) => ch.charCodeAt(0) & 0xff);

/**
  VegFarCardHashBegin: the generator tag, then the UPPER-CASE bare name (after the last
  backslash, at most 100 characters). `tag` is VEGCARD_GENERATOR_TAG; it is a parameter only so a
  test can name a card an older Traxx made.
*/
export function vegFarCardHashBegin(barename: string, tag = VEGCARD_GENERATOR_TAG): number {
  let crc = vegFarCardHashUpdate(0xffffffff, asciiBytes(tag));
  const slash = barename.lastIndexOf("\\");
  const title = slash >= 0 ? barename.slice(slash + 1) : barename;
  const up = asciiBytes(title.slice(0, 100)).map((c) => (c >= 0x61 && c <= 0x7a ? c - 0x20 : c));
  crc = vegFarCardHashUpdate(crc, up);
  return crc;
}

/** VegFarCardName: "V" + the complement as 8 upper-case hex digits. */
export function vegFarCardName(crc: number): string {
  return `V${((~crc) >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

/////////////////////////////////////////////////////////////////////////////
// The .BIN

/**
  VegFarCardIsFlatModel: the engine's modelIsFlatCard. Skip a leading MAGNIFY, take the first
  VLIST, and call the model flat when the thinnest extent of the vertex AABB times 20 is under
  the largest. Anything unreadable is not flat.
*/
export function vegFarCardIsFlatModel(model: Uint8Array | null): boolean {
  if (!model || model.length < 12) return false;
  const size = model.length;
  let q = 0;
  if (rdInt(model, q) === VC_MRGL_MAGNIFY) q += 8;
  if (q + 12 > size || rdInt(model, q) !== VC_MRGL_VLIST) return false;
  const n = rdInt(model, q + 8);
  if (n <= 0 || q + 12 + n * 12 > size) return false;
  q += 12;
  const mn3 = [rdInt(model, q), rdInt(model, q + 4), rdInt(model, q + 8)];
  const mx3 = [...mn3];
  for (let i = 1; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const c = rdInt(model, q + i * 12 + a * 4);
      if (c < mn3[a]!) mn3[a] = c;
      if (c > mx3[a]!) mx3[a] = c;
    }
  }
  let mn = mx3[0]! - mn3[0]!, mx = mn;
  for (let i = 1; i < 3; i++) {
    const ext = mx3[i]! - mn3[i]!;
    if (ext < mn) mn = ext;
    if (ext > mx) mx = ext;
  }
  return mx > 0 && mn * 20 < mx;
}

/** VegFarCardIsKeyframe: the first record is KEYFRAME (32) or KEYFRAME64 (65). */
export function vegFarCardIsKeyframe(model: Uint8Array | null): boolean {
  if (!model || model.length < 4) return false;
  const first = rdInt(model, 0);
  return first === VC_MRGL_KEYFRAME || first === VC_MRGL_KEYFRAME64;
}

/**
  VegFarCardBuildBIN: the card's 384 bytes, or null when an extent is not positive, the texture
  name is empty or over 63 characters, or the engine would take the card for one flat quad.
  FRONT quad in the file XY plane (z = 0) over fx0..fx1, SIDE quad in the ZY plane (x = 0) over
  sz0..sz1, both y0..y1; front wears the left half of the atlas, side the right. `power` is the
  source model's MAGNIFY power (0x10000 when it has none).
*/
export function vegFarCardBuildBin(fx0: number, fx1: number, sz0: number, sz1: number, y0: number, y1: number, power: number, texname: string): Uint8Array | null {
  if (fx1 <= fx0 || sz1 <= sz0 || y1 <= y0 || !texname || texname.length > 63) return null;
  if (power <= 0) power = VC_FIXED_ONE;
  const out = new Uint8Array(VEGCARD_BIN_BYTES);
  const dv = new DataView(out.buffer);
  let at = 0;
  const put = (v: number) => { dv.setInt32(at, v | 0, true); at += 4; };
  const vx: number[] = [], vy: number[] = [], vz: number[] = [], u: number[] = [], v: number[] = [];
  for (let q = 0; q < 2; q++) {
    const b = q * 4;
    const ul = q === 0 ? 0 : VC_UVHALF;
    const ur = q === 0 ? VC_UVHALF - 1 : VC_UVMAX;
    const al = q === 0 ? fx0 : sz1;
    const ar = q === 0 ? fx1 : sz0;
    vy[b] = y1; vy[b + 1] = y0; vy[b + 2] = y0; vy[b + 3] = y1;
    u[b] = ul; u[b + 1] = ul; u[b + 2] = ur; u[b + 3] = ur;
    v[b] = 0; v[b + 1] = VC_UVMAX; v[b + 2] = VC_UVMAX; v[b + 3] = 0;
    for (let i = 0; i < 4; i++) {
      const a = i < 2 ? al : ar;
      vx[b + i] = q === 0 ? a : 0;
      vz[b + i] = q === 0 ? 0 : a;
    }
  }
  const nz = [-65536, 0], nx = [0, -65536];
  put(VC_MRGL_MAGNIFY); put(power);
  put(VC_MRGL_VLIST); put(0); put(8);
  for (let i = 0; i < 8; i++) { put(vx[i]!); put(vy[i]!); put(vz[i]!); }
  put(VC_MRGL_TEXTURE64); put(0);
  for (let i = 0; i < texname.length; i++) out[at + i] = texname.charCodeAt(i) & 0xff;
  at += 64;
  // MATERIAL: BinEdit's CMaterial::SetFoliagePreset, field for field.
  put(VC_MRGL_MATERIAL); put(VC_MAT_FOLIAGE); put(0); put(0); put(0); put(VC_FIXED_ONE); put(0); put(0);
  put(VC_FIXED_ONE); put(VC_FIXED_ONE); put(VC_FIXED_ONE); put(0x80000000);
  for (let q = 0; q < 2; q++) {
    put(VC_MRGL_MATFACET); put(4); put(nx[q]!); put(0); put(nz[q]!); put(0);
    for (let i = q * 4; i < q * 4 + 4; i++) { put(i); put(u[i]!); put(v[i]!); }
  }
  put(VC_MRGL_EOL);
  if (vegFarCardIsFlatModel(out)) return null;
  return out;
}

/////////////////////////////////////////////////////////////////////////////
// The model as Traxx reads it (CTrackPODModel::TranslateBIN)

/** TrackModelPolygon: the face's texture, type, up to 4 vertices and their txmap (file u, v >> 16). */
export interface TraxxModelPolygon {
  texturename: string;
  type: number;
  nvertices: number;
  vertindex: number[];
  txmap: { x: number; y: number }[];
}

export interface TraxxModelData {
  /** TrackModelVertex per vertex: x = file x >> 1, y = file z >> 1 (depth), z = file y >> 1 (up). */
  x: Int32Array;
  y: Int32Array;
  z: Int32Array;
  polygons: TraxxModelPolygon[];
  /** The walk stopped early (IsIncomplete), with why (GetLoadWarning). */
  incomplete: boolean;
  warning: string;
}

const MAXNMODELVERTICES = 64000;
const MAXPOLYVERTICES = 4;
const MODELTEXNAMELEN = 32;

/* mrglSkipInts: the stride of a record TranslateBIN does not use, in ints; 0 runs past the end, -1 unknown. */
function mrglSkipInts(w: Int32Array, p: number, end: number): number {
  const avail = end - p;
  if (avail < 1) return 0;
  let n: number, per: number;
  switch (w[p]) {
    case 1: return avail < 4 ? 0 : 4;
    case 9: return avail < 8 ? 0 : 8;
    case 11: return avail < 2 ? 0 : 2;
    case 12: return avail < 7 ? 0 : 7;
    case 16: return avail < 5 ? 0 : 5;
    case 20: return avail < 2 ? 0 : 2;
    case 66: return avail < 8 ? 0 : 8;
    case 67: return avail < 18 ? 0 : 18;
    case 23: return avail < 3 ? 0 : 3;
    case 61: return avail < 2 ? 0 : 2;
    case 32: return avail < 86 ? 0 : 86;
    case 18: return avail < 2 ? 0 : 2;
    case 2: per = 3; break;
    case 4: per = 2; break;
    case 31: per = 1; break;
    case 22:
      if (avail < 2) return 0;
      n = w[p + 1]!;
      if (n < 0 || n > avail - 2) return 0;
      return 2 + n;
    case 5: case 6: case 7: case 8: case 15: case 21: case 26: case 27: case 33:
      if (avail < 6) return 0;
      n = w[p + 1]!;
      if (n < 0 || n > Math.trunc((avail - 6) / 1)) return 0;
      return 6 + n;
    case 30: case 34: case 56:
      if (avail < 6) return 0;
      n = w[p + 1]!;
      if (n < 0 || n > Math.trunc((avail - 6) / 3)) return 0;
      return 6 + n * 3;
    default: return -1;
  }
  if (avail < 3) return 0;
  n = w[p + 2]!;
  if (n < 0 || n > Math.trunc((avail - 3) / per)) return 0;
  return 3 + n * per;
}

/** strncpy of up to `max` bytes at byte offset `at`, then _strupr. */
function cName(bytes: Uint8Array, at: number, max: number): string {
  let s = "";
  for (let i = 0; i < max && at + i < bytes.length; i++) {
    const c = bytes[at + i]!;
    if (c === 0) break;
    s += String.fromCharCode(c >= 0x61 && c <= 0x7a ? c - 0x20 : c);
  }
  return s;
}

/**
  CTrackPODModel::Load + TranslateBIN for a normal (0x14) or animated (0x20) BIN: the first
  vertex list (after the 16-byte header) and the faces Traxx keeps. Null for anything else
  (a LightWave model is not read here).
*/
export function traxxModelData(bytes: Uint8Array | null): TraxxModelData | null {
  if (!bytes || bytes.length < 4) return null;
  const first = rdInt(bytes, 0);
  if (first !== 0x14 && first !== 0x20) return null;
  const nints = bytes.length >> 2;
  const w = new Int32Array(nints);
  for (let i = 0; i < nints; i++) w[i] = rdInt(bytes, i * 4);
  const end = nints;
  let p = 4;
  const empty = { x: new Int32Array(0), y: new Int32Array(0), z: new Int32Array(0), polygons: [], incomplete: false, warning: "" };
  if (p >= end) return empty;
  let nv = w[p]!;
  if (nv > MAXNMODELVERTICES) nv = MAXNMODELVERTICES;
  if (nv < 0) nv = 0;
  p++;
  if (nv > Math.trunc((end - p) / 3)) nv = Math.trunc((end - p) / 3);
  const x = new Int32Array(nv), y = new Int32Array(nv), z = new Int32Array(nv);
  for (let v = 0; v < nv; v++) {
    x[v] = w[p++]! >> 1;
    z[v] = w[p++]! >> 1;
    y[v] = w[p++]! >> 1;
  }
  const out: TraxxModelData = { x, y, z, polygons: [], incomplete: false, warning: "" };
  const stop = (why: string) => { out.incomplete = true; out.warning = why; };
  let tex = "";
  for (;;) {
    if (p >= end) { stop("no terminator before end of file"); break; }
    const code = w[p]!;
    if (code === 3) {
      if (p + 3 > end) { stop("truncated vertex-normals record"); break; }
      const n = w[p + 2]!;
      p += 3;
      if (n < 0 || n > Math.trunc((end - p) / 3)) { stop("bad vertex-normals count"); break; }
      p += n * 3;
    } else if (code === 13) {
      if (p + 6 > end) { stop("truncated texture record"); break; }
      tex = cName(bytes, (p + 2) * 4, 12);
      p += 6;
    } else if (code === 62) {
      if (p + 18 > end) { stop("truncated texture64 record"); break; }
      tex = cName(bytes, (p + 2) * 4, MODELTEXNAMELEN - 1);
      p += 18;
    } else if (code === 63) {
      if (p + 12 > end) { stop("truncated material record"); break; }
      p += 12;
    } else if (code === 29) {
      if (p + 7 > end) { stop("truncated animated-texture record"); break; }
      const n = w[p + 2]!;
      p += 7;
      if (n < 0 || n > Math.trunc((end - p) / 8)) { stop("bad animated-texture count"); break; }
      for (let v = 0; v < n; v++) {
        if (v === 0) tex = cName(bytes, p * 4, 12);
        p += 8;
      }
    } else if (code === 10) {
      if (p + 2 > end) { stop("truncated colour record"); break; }
      p += 2;
      tex = "";
    } else if (code === 17 || code === 24 || code === 41 || code === 51 || code === 52 || code === 14 || code === 64) {
      if (p + 6 > end) { stop("truncated facet record"); break; }
      const filenv = w[p + 1]!;
      if (filenv < 0 || filenv > Math.trunc((end - (p + 6)) / 3)) { stop("bad facet vertex count"); break; }
      const poly: TraxxModelPolygon = { texturename: tex, type: code, nvertices: Math.min(filenv, MAXPOLYVERTICES), vertindex: [], txmap: [] };
      p += 6;
      for (let v = 0; v < filenv; v++) {
        if (v < MAXPOLYVERTICES) {
          poly.vertindex.push(w[p]!);
          poly.txmap.push({ x: w[p + 1]! >> 16, y: w[p + 2]! >> 16 });
        }
        p += 3;
      }
      out.polygons.push(poly);
    } else if (code === 25) {
      if (p + 6 > end) { stop("truncated untextured facet record"); break; }
      const filenv = w[p + 1]!;
      if (filenv < 0 || filenv > end - (p + 6)) { stop("bad untextured facet count"); break; }
      const poly: TraxxModelPolygon = { texturename: tex, type: code, nvertices: Math.min(filenv, MAXPOLYVERTICES), vertindex: [], txmap: [] };
      p += 6;
      for (let v = 0; v < filenv; v++) {
        if (v < MAXPOLYVERTICES) { poly.vertindex.push(w[p]!); poly.txmap.push({ x: 0, y: 0 }); }
        p++;
      }
      out.polygons.push(poly);
    } else if (code === 0) {
      break;
    } else {
      const nskip = mrglSkipInts(w, p, end);
      if (nskip > 0) { p += nskip; continue; }
      stop(nskip === 0 ? "record runs past the end of the file" : "unknown record type");
      break;
    }
  }
  return out;
}

/////////////////////////////////////////////////////////////////////////////
// The rasteriser

/** VegCardImage: w x h, RGBA straight alpha, row 0 = top. */
export interface VegCardImage { w: number; h: number; rgba: Uint8Array }

interface VegCardCanvas { w: number; h: number; rgba: Uint8Array; depth: Float32Array }

/** VcSample: nearest texel; clamped within VC_UV_SLACK of [0, 1], wrapped beyond. */
function vcSample(t: VegCardImage, u: number, v: number, out: Uint8Array): void {
  if (u < -VC_UV_SLACK || u > f32(1 + VC_UV_SLACK)) u = f32(u - Math.floor(u));
  if (v < -VC_UV_SLACK || v > f32(1 + VC_UV_SLACK)) v = f32(v - Math.floor(v));
  let ix = Math.trunc(f32(u * t.w));
  let iy = Math.trunc(f32(v * t.h));
  if (ix >= t.w) ix = t.w - 1;
  if (iy >= t.h) iy = t.h - 1;
  if (ix < 0) ix = 0;
  if (iy < 0) iy = 0;
  const at = (iy * t.w + ix) * 4;
  out[0] = t.rgba[at]!; out[1] = t.rgba[at + 1]!; out[2] = t.rgba[at + 2]!; out[3] = t.rgba[at + 3]!;
}

/**
  VcTriangle: one orthographic triangle; pixel centres tested with barycentric weights (a hair
  of slack, then clamped and renormalised), a z-buffer where larger is nearer, and a texel with
  alpha under 128 a hole that writes nothing. Both faces are drawn.
*/
function vcTriangle(cv: VegCardCanvas, px: number[], py: number[], pd: number[], pu: number[], pv: number[], tex: VegCardImage, s: Uint8Array): void {
  const area = f32(f32(f32(px[1]! - px[0]!) * f32(py[2]! - py[0]!)) - f32(f32(px[2]! - px[0]!) * f32(py[1]! - py[0]!)));
  if (Math.abs(area) < f32(1.0e-6)) return;
  let minx = px[0]!, maxx = px[0]!, miny = py[0]!, maxy = py[0]!;
  for (let k = 1; k < 3; k++) {
    if (px[k]! < minx) minx = px[k]!; if (px[k]! > maxx) maxx = px[k]!;
    if (py[k]! < miny) miny = py[k]!; if (py[k]! > maxy) maxy = py[k]!;
  }
  let x0 = Math.floor(f32(minx - 0.5)); if (x0 < 0) x0 = 0;
  let y0 = Math.floor(f32(miny - 0.5)); if (y0 < 0) y0 = 0;
  let x1 = Math.ceil(f32(maxx + 0.5)); if (x1 > cv.w - 1) x1 = cv.w - 1;
  let y1 = Math.ceil(f32(maxy + 0.5)); if (y1 > cv.h - 1) y1 = cv.h - 1;
  const slack = f32(-0.0001);
  for (let y = y0; y <= y1; y++) {
    const cy = f32(y + 0.5);
    for (let x = x0; x <= x1; x++) {
      const cx = f32(x + 0.5);
      let w0 = f32(f32(f32(f32(px[1]! - cx) * f32(py[2]! - cy)) - f32(f32(px[2]! - cx) * f32(py[1]! - cy))) / area);
      let w1 = f32(f32(f32(f32(cx - px[0]!) * f32(py[2]! - py[0]!)) - f32(f32(px[2]! - px[0]!) * f32(cy - py[0]!))) / area);
      let w2 = f32(f32(1 - w0) - w1);
      if (w0 < slack || w1 < slack || w2 < slack) continue;
      if (w0 < 0) w0 = 0;
      if (w1 < 0) w1 = 0;
      if (w2 < 0) w2 = 0;
      const sum = f32(f32(w0 + w1) + w2);
      if (sum <= 0) continue;
      w0 = f32(w0 / sum); w1 = f32(w1 / sum); w2 = f32(w2 / sum);
      const d = f32(f32(f32(w0 * pd[0]!) + f32(w1 * pd[1]!)) + f32(w2 * pd[2]!));
      const at = y * cv.w + x;
      if (d <= cv.depth[at]!) continue;
      const u = f32(f32(f32(w0 * pu[0]!) + f32(w1 * pu[1]!)) + f32(w2 * pu[2]!));
      const v = f32(f32(f32(w0 * pv[0]!) + f32(w1 * pv[1]!)) + f32(w2 * pv[2]!));
      vcSample(tex, u, v, s);
      if (s[3]! < 128) continue;
      cv.depth[at] = d;
      cv.rgba[at * 4] = s[0]!;
      cv.rgba[at * 4 + 1] = s[1]!;
      cv.rgba[at * 4 + 2] = s[2]!;
      cv.rgba[at * 4 + 3] = 255;
    }
  }
}

/** VcDownsample: reduce by `f`, alpha-weighted colour, mean alpha. */
export function vcDownsample(src: Uint8Array, sw: number, sh: number, f: number): VegCardImage {
  const dw = Math.trunc(sw / f), dh = Math.trunc(sh / f);
  const rgba = new Uint8Array(dw * dh * 4);
  const ff = f * f;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let sa = 0, sr = 0, sg = 0, sb = 0;
      for (let sy = 0; sy < f; sy++) {
        for (let sx = 0; sx < f; sx++) {
          const p = ((y * f + sy) * sw + (x * f + sx)) * 4;
          const a = src[p + 3]!;
          sa += a;
          sr += src[p]! * a;
          sg += src[p + 1]! * a;
          sb += src[p + 2]! * a;
        }
      }
      const o = (y * dw + x) * 4;
      if (sa > 0) {
        rgba[o] = Math.trunc((sr + (sa >> 1)) / sa);
        rgba[o + 1] = Math.trunc((sg + (sa >> 1)) / sa);
        rgba[o + 2] = Math.trunc((sb + (sa >> 1)) / sa);
        rgba[o + 3] = Math.trunc((sa + (ff >> 1)) / ff);
      }
    }
  }
  return { w: dw, h: dh, rgba };
}

/** VcClearGutter: `gutter` pixels left and right of every half, and the top rows, made transparent. */
export function vcClearGutter(im: VegCardImage, halves: number, gutter: number): void {
  const hw = Math.trunc(im.w / halves);
  for (let y = 0; y < im.h; y++) {
    for (let k = 0; k < halves; k++) {
      if (y < gutter) {
        for (let x = 0; x < hw; x++) im.rgba[(y * im.w + k * hw + x) * 4 + 3] = 0;
        continue;
      }
      for (let g = 0; g < gutter && g < hw; g++) {
        im.rgba[(y * im.w + k * hw + g) * 4 + 3] = 0;
        im.rgba[(y * im.w + k * hw + hw - 1 - g) * 4 + 3] = 0;
      }
    }
  }
}

/**
  VcFinish: clear the gutter, then bleed colour into the transparent texels (8 rings of the
  neighbours' average, never across the seam), the rest the mean opaque colour. Alpha is kept.
*/
export function vcFinish(im: VegCardImage, halves: number): void {
  const n = im.w * im.h, hw = Math.trunc(im.w / halves);
  vcClearGutter(im, halves, VEGCARD_GUTTER);
  let has = new Uint8Array(n);
  let mr = 0, mg = 0, mb = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    has[i] = im.rgba[i * 4 + 3]! > 0 ? 1 : 0;
    if (has[i]) { mr += im.rgba[i * 4]!; mg += im.rgba[i * 4 + 1]!; mb += im.rgba[i * 4 + 2]!; cnt += 1; }
  }
  for (let pass = 0; pass < 8; pass++) {
    const nhas = has.slice();
    for (let y = 0; y < im.h; y++) {
      for (let x = 0; x < im.w; x++) {
        if (has[y * im.w + x]) continue;
        let sr = 0, sg = 0, sb = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= im.w || yy >= im.h) continue;
            if (Math.trunc(xx / hw) !== Math.trunc(x / hw)) continue;
            if (!has[yy * im.w + xx]) continue;
            const q = (yy * im.w + xx) * 4;
            sr += im.rgba[q]!; sg += im.rgba[q + 1]!; sb += im.rgba[q + 2]!;
            c++;
          }
        }
        if (c > 0) {
          const o = (y * im.w + x) * 4;
          im.rgba[o] = Math.trunc(sr / c);
          im.rgba[o + 1] = Math.trunc(sg / c);
          im.rgba[o + 2] = Math.trunc(sb / c);
          nhas[y * im.w + x] = 1;
        }
      }
    }
    has = nhas;
  }
  if (cnt > 0) {
    const r = Math.trunc(mr / cnt), g = Math.trunc(mg / cnt), b = Math.trunc(mb / cnt);
    for (let i = 0; i < n; i++) {
      if (!has[i]) { im.rgba[i * 4] = r; im.rgba[i * 4 + 1] = g; im.rgba[i * 4 + 2] = b; }
    }
  }
}

/////////////////////////////////////////////////////////////////////////////
// The quad

/** VegCardQuad: the rectangle a view's half covers, in raw file units (y0 is the base itself). */
export interface VegCardQuad { x0: number; x1: number; y0: number; y1: number; cx0: number; cx1: number; cy0: number; cy1: number }

/** VcMakeQuad: the model's extents grown by the gutter (in pixels of a pw x ph half) left, right and top. */
export function vcMakeQuad(cx0: number, cx1: number, cy0: number, cy1: number, pw: number, ph: number): VegCardQuad {
  let mx = Math.trunc((cx1 - cx0 + (pw - 2 * VEGCARD_GUTTER) - 1) / (pw - 2 * VEGCARD_GUTTER));
  let my = Math.trunc((cy1 - cy0 + (ph - VEGCARD_GUTTER) - 1) / (ph - VEGCARD_GUTTER));
  if (mx < 1) mx = 1;
  if (my < 1) my = 1;
  return { cx0, cx1, cy0, cy1, x0: cx0 - VEGCARD_GUTTER * mx, x1: cx1 + VEGCARD_GUTTER * mx, y0: cy0, y1: cy1 + VEGCARD_GUTTER * my };
}

/** VcQuadToCanvas: a model point (file units) in canvas samples, row 0 = top. */
function vcQuadToCanvas(q: VegCardQuad, across: number, up: number, cw: number, ch: number, xoff: number): [number, number] {
  const px = f32(xoff + f32(f32(f32(across - q.x0) / f32(q.x1 - q.x0)) * cw));
  const py = f32(f32(f32(q.y1 - up) / f32(q.y1 - q.y0)) * ch);
  return [px, py];
}

/**
  VcWidenCrossed: widen the narrower quad about its centre to just over num/400 of the largest
  extent (+2 units), so the engine does not take the card for a flat one. True when it widened.
*/
export function vcWidenCrossed(e: { fx0: number; fx1: number; sz0: number; sz1: number }, y0: number, y1: number, num: number): boolean {
  let widened = false;
  for (let pass = 0; pass < 6; pass++) {
    const ex = (e.fx1 > 0 ? e.fx1 : 0) - (e.fx0 < 0 ? e.fx0 : 0);
    const ez = (e.sz1 > 0 ? e.sz1 : 0) - (e.sz0 < 0 ? e.sz0 : 0);
    const ey = y1 - y0;
    let mx = ex;
    if (ez > mx) mx = ez;
    if (ey > mx) mx = ey;
    const need = Math.trunc((mx * num + 399) / 400) + 2;
    if (ex >= need && ez >= need) break;
    if (ex < need) { const grow = Math.trunc((need - ex) / 2) + 1; e.fx0 -= grow; e.fx1 += grow; widened = true; }
    if (ez < need) { const grow = Math.trunc((need - ez) / 2) + 1; e.sz0 -= grow; e.sz1 += grow; widened = true; }
  }
  return widened;
}

/////////////////////////////////////////////////////////////////////////////
// Textures: what the model's faces are painted with

/** reg.ART_folder, as far as a card needs it: a file by name, or null. */
export type VegCardArtFile = (fileName: string) => Promise<Uint8Array | null>;

const exactBlack = (pal: Uint8Array, ix: number) => pal[ix * 3] === 0 && pal[ix * 3 + 1] === 0 && pal[ix * 3 + 2] === 0;

/** PodSwapExt on a bare title. */
function swapExt(title: string, ext: string): string {
  const dot = title.lastIndexOf(".");
  return `${dot > 0 ? title.slice(0, dot) : title}.${ext}`;
}

/**
  HDTexDecodeRGBA: the format gate of HDTexIdentify, at most 4096 square, then stb's 4
  components. Null with the reason, or the RGBA and whether any texel is not opaque.
*/
export function hdTexDecodeRgba(file: Uint8Array, nameHint: string): { img: VegCardImage; hasAlpha: boolean } | string {
  if (file.length === 0) return "No image data.";
  const ext = /\.TGA$/i.test(nameHint) ? "TGA" : "PNG";
  const refusal = imageFormatRefusal(file, nameHint, ext);
  if (refusal) return refusal;
  let img: VegCardImage;
  try {
    if (ext === "PNG") {
      const s = decodePngSamples(file);
      if (s.width < 1 || s.height < 1 || s.width > 4096 || s.height > 4096) return `"${nameHint}" is ${s.width}x${s.height} - too large to sample.`;
      img = { w: s.width, h: s.height, rgba: stbiPngRgba(s) };
    } else {
      const t = decodeTga(file, nameHint);
      if (t.width > 4096 || t.height > 4096) return `"${nameHint}" is ${t.width}x${t.height} - too large to sample.`;
      img = { w: t.width, h: t.height, rgba: new Uint8Array(t.rgba) };
    }
  } catch (e) {
    return `Could not decode "${nameHint}": ${(e as Error).message}.`;
  }
  let hasAlpha = false;
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] !== 255) { hasAlpha = true; break; }
  return { img, hasAlpha };
}

/**
  VcLoadTexture: one face texture's colour and alpha, and the bytes that feed the card's name.
  The track must hold the texture (`tex`, IsModelTextureLoaded("ART\<name>")), and it must not
  be the bad placeholder.
    legacy  the ART folder's <title>.RAW (64 or 256 square) with its own .ACT; failing that the
            tile in memory, in the TRACK palette (remapped, as Traxx holds it)
    HD      the texture's own HD source, else <stem>.PNG / .TGA in the ART folder; its alpha
            rules. Opaque HD art beside a legacy tile is cut by the tile's exact-black holes.
    legacy only  palette colour, alpha 0 where the palette entry is exactly (0,0,0)
*/
export async function vcLoadTexture(
  texname: string, tex: TextureAsset | null, trackPalette: Uint8Array, artFile: VegCardArtFile, crc: { v: number }, notes: VcNotes,
): Promise<VegCardImage | string> {
  if (!tex) return `texture ${texname} is not in the track`;
  if (tex.bad) return `texture ${texname} could not be loaded (it is the purple placeholder)`;
  const slash = tex.name.lastIndexOf("\\");
  const title = slash >= 0 ? tex.name.slice(slash + 1) : tex.name;

  let legidx: Uint8Array | null = null, legpal: Uint8Array | null = null, lw = 0, lh = 0;
  const file = await artFile(title);
  const side = file ? (file.length === 4096 ? 64 : file.length === 65536 ? 256 : 0) : 0;
  if (file && side) {
    const act = await artFile(swapExt(title, "ACT"));
    if (act && act.length >= 768) { legidx = file; legpal = act.subarray(0, 768); lw = lh = side; }
  }
  if (!legidx && tex.indices && tex.side > 0) {
    // GetData: the tile as the track holds it, remapped into the track palette.
    legidx = tex.trackIndexed ? tex.indices : remapIndices(tex.indices, tex.act ?? metalcr2Act3(), trackPalette);
    legpal = trackPalette.subarray(0, 768);
    lw = lh = tex.side;
  }

  let hd: Uint8Array | null = null, hdpath = "";
  if (tex.hd && tex.hd.data.length > 0) { hd = tex.hd.data; hdpath = `${title}.PNG`; }
  else {
    for (const ext of ["PNG", "TGA"]) {
      const name = swapExt(title, ext);
      const bytes = await artFile(name);
      if (bytes) { hd = bytes; hdpath = name; break; }
    }
  }

  let img: VegCardImage | null = null;
  let usedLegacy = false;
  if (hd) {
    const r = hdTexDecodeRgba(hd, hdpath);
    if (typeof r === "string") notes.add(`  ${texname}: its HD source would not decode, used the legacy tile.`);
    else {
      crc.v = vegFarCardHashUpdate(crc.v, hd);
      img = r.img;
      if (!r.hasAlpha) {
        if (legidx && legpal) {
          usedLegacy = true;
          const { w, h } = img;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const ix = legidx[Math.trunc((y * lh) / h) * lw + Math.trunc((x * lw) / w)]!;
              if (exactBlack(legpal, ix)) img.rgba[(y * w + x) * 4 + 3] = 0;
            }
          }
          notes.add(`  ${texname}: its HD art has no alpha, cut with the legacy tile's transparent index.`);
        } else notes.add(`  ${texname}: its HD art has no alpha and there is no legacy tile - drawn solid.`);
      }
    }
  }
  if (!img && legidx && legpal) {
    usedLegacy = true;
    const rgba = new Uint8Array(lw * lh * 4);
    for (let i = 0; i < lw * lh; i++) {
      const ix = legidx[i]!;
      rgba[i * 4] = legpal[ix * 3]!;
      rgba[i * 4 + 1] = legpal[ix * 3 + 1]!;
      rgba[i * 4 + 2] = legpal[ix * 3 + 2]!;
      rgba[i * 4 + 3] = exactBlack(legpal, ix) ? 0 : 255;
    }
    img = { w: lw, h: lh, rgba };
  }
  if (usedLegacy && legidx && legpal && img) {
    crc.v = vegFarCardHashUpdate(crc.v, legidx, lw * lh);
    crc.v = vegFarCardHashUpdate(crc.v, legpal, 768);
  }
  if (!img) return `texture ${texname} has no usable image (no HD source, no .RAW/.ACT)`;
  return img;
}

/** VcNote: the notes buffer (1024 characters; a note that does not fit is dropped). */
export class VcNotes {
  text = "";
  add(line: string): void {
    if (this.text.length >= 1024 - 2) return;
    this.text = `${this.text}${line}\n`.slice(0, 1023);
  }
}

/////////////////////////////////////////////////////////////////////////////
// Render a model

/** VegCardCard: both views' quads, the model's true extents (file units) and what had to change. */
export interface VegCardCard {
  v: [VegCardQuad, VegCardQuad];
  tw: number;
  td: number;
  th: number;
  widenedFront: boolean;
  widenedSide: boolean;
  /** Textured faces reach below the first VLIST's lowest vertex. */
  baselow: boolean;
}

/** The texture a face's name resolves to in the track (IsModelTextureLoaded("ART\<name>")). */
export type VegCardTextureLookup = (face: string) => TextureAsset | null;

/**
  VcRenderModel: the finished S x S atlas (front view left, side view right) and the card's
  quads, or the reason. `crc` is fed every texture the render uses, in first-use order.
*/
export async function vcRenderModel(
  modelBytes: Uint8Array, texture: VegCardTextureLookup, trackPalette: Uint8Array, artFile: VegCardArtFile, crc: { v: number }, notes: VcNotes,
): Promise<{ img: VegCardImage; card: VegCardCard } | string> {
  const m = traxxModelData(modelBytes);
  if (!m) return "the model has no textured faces to draw";
  if (m.incomplete) notes.add(`  the model did not load completely (${m.warning})`);
  const nv = m.x.length;
  const drawable = (p: TraxxModelPolygon) => p.texturename !== "" && p.nvertices >= 3 && p.type !== 0x19;

  let minx = 0x7fffffff, maxx = -0x7fffffff, minz = 0x7fffffff, maxz = -0x7fffffff, mind = 0x7fffffff, maxd = -0x7fffffff;
  let nuse = 0;
  for (const p of m.polygons) {
    if (!drawable(p)) continue;
    for (let k = 0; k < p.nvertices; k++) {
      const i = p.vertindex[k]!;
      if (i < 0 || i >= nv) break;
      const x = m.x[i]!, y = m.y[i]!, z = m.z[i]!;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (z < minz) minz = z;
      if (z > maxz) maxz = z;
      if (y < mind) mind = y;
      if (y > maxd) maxd = y;
    }
    nuse++;
  }
  if (nuse === 0) return "the model has no textured faces to draw";

  const outw = (maxx - minx) * 2, outd = (maxd - mind) * 2, outh = (maxz - minz) * 2;
  if (outh < 1 || (outw < 1 && outd < 1)) return "the model has no width, depth or height to draw";
  const ratio = f32(f32(outh) / f32(outw > outd ? outw : outd));
  const S = ratio > VEGCARD_TALL_RATIO ? VEGCARD_SIZE_TALL : VEGCARD_SIZE_NORMAL;
  const canvasdim = S * VEGCARD_SS, halfdim = canvasdim / 2;

  let cy0 = minz * 2;
  const cy1 = maxz * 2;
  let baselow = false;
  const base = vegFarCardBaseY(modelBytes);
  if (base && base.fileMinY < cy1) {
    if (cy0 < base.fileMinY - 1) baselow = true;
    else cy0 = base.fileMinY;
  }

  const e = { fx0: minx * 2, fx1: maxx * 2, sz0: mind * 2, sz1: maxd * 2 };
  const o = { ...e };
  let q0 = vcMakeQuad(e.fx0, e.fx1, cy0, cy1, S / 2, S), q1 = vcMakeQuad(-e.sz1, -e.sz0, cy0, cy1, S / 2, S);
  for (let num = 21; num <= 21 + 4 * 8; num += 4) {
    vcWidenCrossed(e, cy0, cy1, num);
    q0 = vcMakeQuad(e.fx0, e.fx1, cy0, cy1, S / 2, S);
    q1 = vcMakeQuad(-e.sz1, -e.sz0, cy0, cy1, S / 2, S);
    if (vegFarCardBuildBin(q0.x0, q0.x1, -q1.x1, -q1.x0, q0.y0, q0.y1, VC_FIXED_ONE, "FLATTEST.RAW")) break;
  }
  const card: VegCardCard = {
    v: [q0, q1], tw: outw, td: outd, th: outh,
    widenedFront: e.fx0 !== o.fx0 || e.fx1 !== o.fx1, widenedSide: e.sz0 !== o.sz0 || e.sz1 !== o.sz1, baselow,
  };

  const cv: VegCardCanvas = { w: canvasdim, h: canvasdim, rgba: new Uint8Array(canvasdim * canvasdim * 4), depth: new Float32Array(canvasdim * canvasdim).fill(f32(-1.0e30)) };
  const texCache = new Map<string, VegCardImage>();
  const sample = new Uint8Array(4);
  const px: [number[], number[]] = [[], []], py: [number[], number[]] = [[], []], pd: [number[], number[]] = [[], []];
  const pu: number[] = [], pv: number[] = [];
  const tri = [[0, 1, 2], [0, 2, 3]];
  const tx = [0, 0, 0], ty = [0, 0, 0], td = [0, 0, 0], tu = [0, 0, 0], tv = [0, 0, 0];

  for (const p of m.polygons) {
    if (!drawable(p)) continue;
    let img = texCache.get(p.texturename);
    if (!img) {
      if (texCache.size >= VEGCARD_MAXTEX) return `the model wears more than ${VEGCARD_MAXTEX} textures`;
      const r = await vcLoadTexture(p.texturename, texture(`ART\\${p.texturename}`), trackPalette, artFile, crc, notes);
      if (typeof r === "string") return r;
      texCache.set(p.texturename, (img = r));
    }
    let good = true;
    for (let k = 0; k < p.nvertices; k++) {
      const i = p.vertindex[k]!;
      if (i < 0 || i >= nv) { good = false; break; }
      // Traxx's axes: x = file x, y = file z (depth), z = file y (up).
      [px[0][k], py[0][k]] = vcQuadToCanvas(q0, m.x[i]! * 2, m.z[i]! * 2, halfdim, canvasdim, 0);
      pd[0][k] = f32(-m.y[i]!);
      [px[1][k], py[1][k]] = vcQuadToCanvas(q1, -(m.y[i]! * 2), m.z[i]! * 2, halfdim, canvasdim, halfdim);
      pd[1][k] = f32(-m.x[i]!);
      pu[k] = f32(f32(p.txmap[k]!.x) / 255);
      pv[k] = f32(f32(p.txmap[k]!.y) / 255);
    }
    if (!good) continue;
    const ntri = p.nvertices >= 4 ? 2 : 1;
    for (let view = 0; view < 2; view++) {
      for (let t = 0; t < ntri; t++) {
        for (let c = 0; c < 3; c++) {
          const k = tri[t]![c]!;
          tx[c] = px[view][k]!; ty[c] = py[view][k]!; td[c] = pd[view][k]!; tu[c] = pu[k]!; tv[c] = pv[k]!;
        }
        vcTriangle(cv, tx, ty, td, tu, tv, img, sample);
      }
    }
  }

  const img = vcDownsample(cv.rgba, cv.w, cv.h, VEGCARD_SS);
  let any = false;
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i]! > 0) { any = true; break; }
  if (!any) return "nothing of the model was visible from the front or the side (every texel was transparent)";
  vcFinish(img, 2);
  return { img, card };
}

/////////////////////////////////////////////////////////////////////////////
// The art

/**
  HDTexQuantizeKeyed: the opaque texels (alpha >= 128) quantised to 255 colours shifted up one,
  entry 0 the engine's transparent black, any other exact black nudged to (1,1,1). Null when no
  texel is opaque.
*/
export function hdTexQuantizeKeyed(rgba: Uint8Array, w: number, h: number): { indices: Uint8Array; act: Uint8Array } | null {
  const npix = w * h;
  let n = 0;
  for (let i = 0; i < npix; i++) if (rgba[i * 4 + 3]! >= 128) n++;
  if (n === 0) return null;
  const rgb = new Uint8Array(n * 3);
  for (let i = 0, k = 0; i < npix; i++) {
    if (rgba[i * 4 + 3]! >= 128) { rgb[k * 3] = rgba[i * 4]!; rgb[k * 3 + 1] = rgba[i * 4 + 1]!; rgb[k * 3 + 2] = rgba[i * 4 + 2]!; k++; }
  }
  const q = quantize(rgb, n, 1, 255);
  const act = new Uint8Array(768);
  act.set(q.act.subarray(0, 255 * 3), 3);
  for (let e = 1; e < 256; e++) {
    if (act[e * 3] === 0 && act[e * 3 + 1] === 0 && act[e * 3 + 2] === 0) act[e * 3] = act[e * 3 + 1] = act[e * 3 + 2] = 1;
  }
  const indices = new Uint8Array(npix);
  for (let i = 0, k = 0; i < npix; i++) indices[i] = rgba[i * 4 + 3]! >= 128 ? q.indices[k++]! + 1 : 0;
  return { indices, act };
}

/** VegCardArt: what VcWriteArt writes: the PNG's pixels (RGBA), and the legacy tile and palette. */
export interface VegCardArt { rgba: Uint8Array; w: number; h: number; idx: Uint8Array; lw: number; pal: Uint8Array }

/** VcPrepareArt: the legacy 256 tile (downsampled, gutter cleared again) keyed, and the PNG's pixels. */
export function vcPrepareArt(img: VegCardImage): VegCardArt | string {
  let leg = img;
  if (img.w !== VEGCARD_LEGACY) {
    leg = vcDownsample(img.rgba, img.w, img.h, Math.trunc(img.w / VEGCARD_LEGACY));
    vcClearGutter(leg, 2, Math.trunc((VEGCARD_GUTTER * leg.w + img.w - 1) / img.w));
  }
  const k = hdTexQuantizeKeyed(leg.rgba, leg.w, leg.h);
  if (!k) {
    return `the model is too thin to draw: at the legacy ${VEGCARD_LEGACY}x${VEGCARD_LEGACY} size not one texel is at least half covered, so the .RAW/.ACT pair cannot be built (nothing was written)`;
  }
  return { rgba: img.rgba.slice(), w: img.w, h: img.h, idx: k.indices, lw: leg.w, pal: k.act };
}

function be32(d: Uint8Array, o: number, v: number): void {
  d[o] = (v >>> 24) & 255; d[o + 1] = (v >>> 16) & 255; d[o + 2] = (v >>> 8) & 255; d[o + 3] = v & 255;
}

/**
  HDTexWritePNG32's file: 8-bit RGBA (straight alpha), every row Paeth filtered, stb_image_write's
  deflate. Traxx hands the pixels to WIC, whose compressed bytes differ; the image is the same.
*/
export function encodePngRgba(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 4;
  const filtered = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const r = y * stride, d = y * (stride + 1);
    filtered[d] = 4;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? rgba[r + i - 4]! : 0;
      const b = y > 0 ? rgba[r - stride + i]! : 0;
      const c = y > 0 && i >= 4 ? rgba[r - stride + i - 4]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      filtered[d + 1 + i] = (rgba[r + i]! - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  const z = stbiZlibCompress(filtered, 8);
  const file = new Uint8Array(8 + 25 + 12 + z.length + 12);
  file.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  let o = 8;
  const chunk = (type: string, data: Uint8Array) => {
    be32(file, o, data.length);
    for (let k = 0; k < 4; k++) file[o + 4 + k] = type.charCodeAt(k);
    file.set(data, o + 8);
    be32(file, o + 8 + data.length, crc32(file, o + 4, o + 8 + data.length));
    o += 12 + data.length;
  };
  const ihdr = new Uint8Array(13);
  be32(ihdr, 0, w); be32(ihdr, 4, h);
  ihdr[8] = 8; ihdr[9] = 6;
  chunk("IHDR", ihdr);
  chunk("IDAT", z);
  chunk("IEND", new Uint8Array(0));
  return file;
}

/////////////////////////////////////////////////////////////////////////////
// The driver

/** A card the track now holds, as VcLoadCard loaded it: the model and the textures it added. */
export interface VegCardLoaded<M = unknown, T = unknown> { model: M; textures: T[]; bytes: Uint8Array; missing: string[] }

/**
  Everything Make Far Cards needs from the track and from storage. Names are bare
  ("V3F9A21C0.BIN", "V3F9A21C0.PNG").
*/
export interface VegFarCardHost<M = unknown, T = unknown> {
  /** pod->palette, 768 bytes. */
  trackPalette: Uint8Array;
  /** IsModelLoaded + GetData: the bytes of a model the track holds, by bare or MODELS\ name; null when absent. */
  modelBytes(name: string): Uint8Array | null;
  /** IsModelLoaded >= 0. */
  modelLoaded(bare: string): boolean;
  /** IsModelTextureLoaded("ART\<name>"). */
  modelTexture(face: string): TextureAsset | null;
  /** A file of the ART folder (for reading the textures' own .RAW / .ACT / HD source). */
  artFile: VegCardArtFile;
  /** VcFileExists on <ART>\<name> and <models folder>\<name>. */
  artExists(name: string): Promise<boolean>;
  binExists(bare: string): Promise<boolean>;
  /** VcWriteArt: the three files, all or none; the reason on failure. */
  writeArt(stem: string, files: { png: Uint8Array; raw: Uint8Array; act: Uint8Array }): Promise<string | null>;
  /** VcWriteBytes into the models folder; false on failure. */
  writeBin(bare: string, bytes: Uint8Array): Promise<boolean>;
  /** DeleteFile of the art this run wrote, when the .BIN could not follow. */
  deleteArt(stem: string): Promise<void>;
  /**
    CTrackPODModel::Load + LoadModelTextures of <models folder>\<bare> as MODELS\<bare>, without
    adding it to the track yet: the model, the textures it adds, and the textures it could not
    load. A string is the reason it could not be read.
  */
  loadCard(bare: string): Promise<VegCardLoaded<M, T> | string>;
  /** Put a card that passed every check into the track (a free model slot and its textures). */
  addCard(card: VegCardLoaded<M, T>): void;
  /** The textures loadCard brought, by face, for VcTexOK (the card's texture is not yet in the track). */
  loadedTexture(card: VegCardLoaded<M, T>, face: string): { bad: boolean } | null;
  /** Where the files go, for the report. */
  modelsFolderLabel: string;
  artFolderLabel: string;
}

export interface VegFarCardResult {
  /** How many entries were given a far model (the rules changed). */
  changed: number;
  /** The plain-text account (made / reused / failed, notes, where the files went). */
  report: string;
  /** Cards this run put into the track. */
  added: string[];
}

/** VcHasFar / VcSkip. */
const vcHasFar = (e: VegEntry) => e.farmodel !== "";
const vcSkip = (e: VegEntry) => e.facing || vcHasFar(e);

/*
  VcLoadCard after the file is read: 8 vertices and 2 faces, its textures loaded, and the engine
  willing to instance it (VcTexOK: a texture the track holds but marked bad is not loadable).
*/
async function vcLoadCard<M, T>(host: VegFarCardHost<M, T>, bare: string): Promise<string | null> {
  const loaded = await host.loadCard(bare);
  if (typeof loaded === "string") return loaded;
  const m = traxxModelData(loaded.bytes);
  const nverts = m ? m.x.length : 0, npolys = m ? m.polygons.length : 0;
  if (!m || npolys !== 2 || nverts !== 8) return `the card model would not load (it parsed as ${nverts} vertices, ${npolys} faces)`;
  if (loaded.missing.length) return `the card's texture would not load: ${loaded.missing.join("\n")}`;
  const texOk: ModelTextureOk = (name) => {
    const t = host.loadedTexture(loaded, name) ?? host.modelTexture(`ART\\${name}`);
    return t ? !t.bad : true;
  };
  const why = modelInstanceProblem(loaded.bytes, texOk);
  if (why !== null) return `the engine will not instance the card: ${why}`;
  host.addCard(loaded);
  return null;
}

/**
  VegMakeFarCards: one card per distinct tree-layer model with an entry that has no far model
  (facing entries skipped), made, reused or failed with the reason; then every such entry whose
  card is in the track is given it as farmodel. `veg` is the Vegetation window's copy.
*/
export async function vegMakeFarCards<M, T>(host: VegFarCardHost<M, T>, veg: Vegetation): Promise<VegFarCardResult> {
  const layer = VEG_LAYER_TREES;
  const models: string[] = [];
  const cardname: string[] = [];
  let nfacing = 0, made = 0, reused = 0, failed = 0, changed = 0, nflat = 0, nkey = 0;
  const notes = new VcNotes();
  const added: string[] = [];
  let lines = "";

  for (const c of veg.colours[layer] ?? []) {
    for (const en of c.entries) {
      if (!en.model) continue;
      if (en.facing) { nfacing++; continue; }
      if (vcHasFar(en)) continue;
      if (!models.some((m) => m.toUpperCase() === en.model.toUpperCase())) { models.push(en.model.slice(0, VEG_MODELNAME - 1)); cardname.push(""); }
    }
  }

  const plural = (n: number) => (n === 1 ? "y was" : "ies were");
  if (models.length === 0) {
    let report = "Nothing to do.\n\nEvery tree and bush entry already has a far model of its own, or there are no tree or bush entries yet. (Grass never gets a far card.)";
    if (nfacing > 0) report += `\n\n${nfacing} facing entr${plural(nfacing)} skipped: a facing plant needs no far card.`;
    return { changed: 0, report, added };
  }

  let wrote = false;
  for (let m = 0; m < models.length; m++) {
    const name = models[m]!;
    const mbytes = host.modelBytes(name);
    if (!mbytes) { lines += `  Failed  ${name}: the model is not in the track.\n`; failed++; continue; }

    const crc = { v: vegFarCardHashBegin(name) };
    crc.v = vegFarCardHashUpdate(crc.v, mbytes);
    let power = VC_FIXED_ONE;
    if (mbytes.length >= 8 && rdInt(mbytes, 0) === VC_MRGL_MAGNIFY) power = rdInt(mbytes, 4);
    const isflat = vegFarCardIsFlatModel(mbytes);
    const iskey = vegFarCardIsKeyframe(mbytes);
    if (iskey) { lines += `  Skipped ${name} is an animated (keyframe) model - no far card made\n`; nkey++; continue; }
    if (isflat) { lines += `  Skipped ${name} is already a flat card - no far card made\n`; nflat++; continue; }

    const r = await vcRenderModel(mbytes, (face) => host.modelTexture(face), host.trackPalette, host.artFile, crc, notes);
    if (typeof r === "string") { lines += `  Failed  ${name}: ${r}\n`; failed++; continue; }
    const { img, card: quad } = r;

    const stem = vegFarCardName(crc.v);
    const bare = `${stem}.BIN`;
    cardname[m] = bare;
    if (host.modelLoaded(bare)) { lines += `  Reused  ${name} -> ${bare} (already in the track)\n`; reused++; continue; }

    const texname = `${stem}.RAW`;
    const artexists = (await host.artExists(`${stem}.PNG`)) && (await host.artExists(`${stem}.RAW`)) && (await host.artExists(`${stem}.ACT`));
    const binexists = await host.binExists(bare);
    wrote = true;

    // 1. Build and validate the .BIN before any file exists (the side quad's picture runs along -Z).
    const bin = vegFarCardBuildBin(quad.v[0].x0, quad.v[0].x1, -quad.v[1].x1, -quad.v[1].x0, quad.v[0].y0, quad.v[0].y1, power, texname);
    if (!bin) { lines += `  Failed  ${name}: the card model could not be built (or the engine would take it for a flat card).\n`; failed++; continue; }
    const inst = modelInstanceProblem(bin);
    if (inst !== null) { lines += `  Failed  ${name}: the generated card would not instance: ${inst}\n`; failed++; continue; }

    // 2. The art: everything that can fail without touching storage, then the files.
    let wroteArt = false;
    if (!artexists) {
      const art = vcPrepareArt(img);
      if (typeof art === "string") { lines += `  Failed  ${name}: ${art}\n`; failed++; continue; }
      const err = await host.writeArt(stem, { png: encodePngRgba(art.rgba, art.w, art.h), raw: art.idx, act: art.pal });
      if (err) { lines += `  Failed  ${name}: ${err}\n`; failed++; continue; }
      wroteArt = true;
    }

    // 3. The .BIN last; if it cannot be written, take back the art this run made.
    if (!binexists && !(await host.writeBin(bare, bin))) {
      if (wroteArt) await host.deleteArt(stem);
      lines += `  Failed  ${name}: cannot write ${bare} in ${host.modelsFolderLabel}\n`;
      failed++;
      continue;
    }

    const why = await vcLoadCard(host, bare);
    if (why !== null) { lines += `  Failed  ${name}: ${why}\n`; failed++; continue; }
    added.push(bare);

    if (artexists) {
      lines += `  Reused  ${name} -> ${bare}${binexists ? " (found on disk)\n" : " (art found in the ART folder, card model written)\n"}`;
      reused++;
    } else {
      lines += `  Made    ${name} -> ${bare}  (crossed cards, ${img.w}x${img.h} atlas, model ${(quad.tw / 256).toFixed(1)} wide x ${(quad.td / 256).toFixed(1)} deep x ${(quad.th / 256).toFixed(1)} high ft)\n`;
      if (quad.baselow) lines += "          note: some faces reach below the model's first vertex list, so the card's base is the faces' lowest point, not the engine's base for the model\n";
      if (quad.widenedFront || quad.widenedSide) {
        const which = quad.widenedFront && quad.widenedSide ? "front and side quads were" : quad.widenedFront ? "front quad was" : "side quad was";
        lines += `          the ${which} widened to 5% of the height, or the engine would take the card for a flat one and turn it to the camera\n`;
      }
      made++;
    }
  }

  const aborted = failed === models.length;

  // Give the entries their far model.
  for (const c of veg.colours[layer] ?? []) {
    for (const en of c.entries) {
      if (!en.model || vcSkip(en)) continue;
      for (let m = 0; m < models.length; m++) {
        if (models[m]!.toUpperCase() === en.model.toUpperCase() && cardname[m] && host.modelLoaded(cardname[m]!)) {
          en.farmodel = cardname[m]!.slice(0, VEG_MODELNAME - 1);
          changed++;
          break;
        }
      }
    }
  }

  let head = `Far cards: ${made} made, ${reused} reused, ${failed} failed`;
  if (nflat > 0) head += `, ${nflat} already flat (none needed)`;
  if (nkey > 0) head += `, ${nkey} animated (none made)`;
  let report = `${head}.\n\n${lines}`;
  if (nfacing > 0) report += `\n${nfacing} facing entr${plural(nfacing)} skipped: a facing plant needs no far card, and its far model field was not touched.\n`;
  if (notes.text) report += `\nNotes:\n${notes.text}`;
  if (wrote) report += `\nCard models: ${host.modelsFolderLabel}\nCard art (.PNG/.RAW/.ACT): ${host.artFolderLabel}\n`;
  if (made + reused > 0) report += "\nThe cards are now models of this track. If you Cancel this session they stay in the track's model list until you use Purge Unused Models (Undo takes them out).\n";
  if (changed > 0) report += "\nRe-plant to carry the far models into the planted species.";
  else if (aborted) report += "\nNo entry was changed.";
  return { changed, report, added };
}
