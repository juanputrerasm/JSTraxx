/*
  Special > Enlarge World to 512 x 512 (Traxx origin/main, TrackPOD/TrackPOD.cpp CTrackPOD::EnlargeWorld512,
  TrackPOD/TrackPODTerrain.cpp GrowTo and LowestHeight, TrackPOD/TrackPODHeightImage.cpp MaskImageEnlarge2x,
  TrackPODLakes.cpp GrowWorldCells; spec docs/superpowers/specs/2026-11-22-traxx-enlarge-world-design.md).

  A 256 x 256 track becomes 512 x 512 with everything kept in the top-left corner (cells 0..255, 0..8,192 ft):
  every coordinate stays as it was. The new three quarters are flat at the track's lowest TERRAIN height (not the
  boxes, the water or the lakes), texture 0 and the flat 0xed .LTE ground. Every grid keeps its mode, except that
  Classic 8-bit becomes Classic 16-bit (h16 = raw << 8). The painted world masks _MASK, _WMSK, _V and _G are
  placed in the top-left of a picture twice as wide and tall (black elsewhere; an alpha channel opaque) and
  re-encoded in their own format; the detail normals (_DTL, _WDTL) tile every 64 ft and are not touched. A
  classic track becomes Standard V6, as Track Type does it. Lakes, falls, walls and vegetation keep every record;
  the lakes and falls are judged again, and those that no longer hold as they did are reported. No UI here.
*/
import type { TxxHdArt, TxxTrack } from "../traxx/txx.ts";
import { decodePngSamples } from "../../vendor/openphotex/texture/png.js";
import { crc32, stbiZlibCompress } from "../traxx/height-image.ts";
import { mirrorOf, refreshRaw, syncFromRaw, TERRAINMODE_CLASSIC8, TERRAINMODE_CLASSIC16, TERRAINMODE_FINE } from "../traxx/terrain16.ts";
import { buildLakeGround, heightsChanged } from "../traxx/surface.ts";
import { FLAT_LTE } from "../traxx/terrain.ts";
import { setTrackKind, tallHeights, isV6 } from "../traxx/track-kind.ts";
import { trackLakes } from "../traxx/lakes.ts";
import { fallErrors, type FallNameCheck } from "../traxx/falls.ts";
import { trackLakeRule } from "../traxx/lake-ground.ts";
import { fallWorldOf } from "../traxx/v6.ts";
import { vegCrc32, vegetationFromTxx, vegetationToTxx } from "../traxx/veg.ts";
import { deriveBoxHeights } from "../doc/load-pod.ts";
import type { HeightGrid } from "../traxx/world.ts";

/** EnlargeReport: 1-based lake and waterfall numbers (as the Lake and Waterfall windows show them), and why not. */
export interface EnlargeReport {
  lakes: number[];
  falls: number[];
  /** Why nothing changed (a false return), or for a true one what could not be re-checked; "" otherwise. */
  reason: string;
}

export const ENLARGE_ALREADY_512 = "This track is already 512 x 512; there is nothing to enlarge.";

const WHY_MASK_NOT_IMAGE = "is not a PNG or TGA image";
const WHY_MASK_DECODE = "could not be decoded (the file may be damaged)";
const WHY_MASK_BIG = "is too big to enlarge (the new picture would pass 256 MB)";
const MASK_CANVAS_MAX = 256 * 1024 * 1024;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10];

/** A decoded mask as stb_image gives it: comp channels per pixel, 8 or 16 bits a sample, row 0 first. */
interface MaskPixels { w: number; h: number; comp: number; is16: boolean; px: Uint16Array }

function decodePngMask(file: Uint8Array): MaskPixels | null {
  let s;
  try { s = decodePngSamples(file); } catch { return null; }
  const n = s.width * s.height;
  if (s.colorType === 3) {
    // stbi expands a palette to RGB, or RGBA with a tRNS.
    const comp = s.paletteAlpha ? 4 : 3, pal = s.palette ?? new Uint8Array(0), a = s.paletteAlpha;
    const px = new Uint16Array(n * comp);
    for (let i = 0; i < n; i++) {
      const k = s.samples[i]!;
      px[i * comp] = pal[k * 3] ?? 0; px[i * comp + 1] = pal[k * 3 + 1] ?? 0; px[i * comp + 2] = pal[k * 3 + 2] ?? 0;
      if (comp === 4) px[i * comp + 3] = a && k < a.length ? a[k]! : 255;
    }
    return { w: s.width, h: s.height, comp, is16: false, px };
  }
  const comp = s.channels;
  const scale = s.bitDepth === 1 ? 0xff : s.bitDepth === 2 ? 0x55 : s.bitDepth === 4 ? 0x11 : 1;
  const px = new Uint16Array(n * comp);
  for (let i = 0; i < n * comp; i++) px[i] = s.samples[i]! * scale;
  return { w: s.width, h: s.height, comp, is16: s.bitDepth === 16, px };
}

/* The TGA kinds stb reads that a mask can be: grey 8 (1) or 16 (grey + alpha, 2), true colour 15/16 (3), 24 (3), 32 (4). */
function decodeTgaMask(file: Uint8Array): MaskPixels | null {
  if (file.length < 18) return null;
  const idLen = file[0]!, cmap = file[1]!, type = file[2]!;
  const w = file[12]! | (file[13]! << 8), h = file[14]! | (file[15]! << 8), bits = file[16]!, desc = file[17]!;
  if (cmap !== 0 || ![2, 3, 10, 11].includes(type) || !w || !h) return null;
  const grey = type === 3 || type === 11, rle = type >= 9;
  const bpp = bits >> 3;
  if (grey ? bits !== 8 && bits !== 16 : ![15, 16, 24, 32].includes(bits)) return null;
  const comp = grey ? (bits === 16 ? 2 : 1) : bits === 32 ? 4 : 3;
  const px = new Uint16Array(w * h * comp);
  let at = 18 + idLen, pixel = 0;
  const read = (): number[] | null => {
    if (at + bpp > file.length) return null;
    const p = file.subarray(at, at + bpp);
    at += bpp;
    if (grey) return bits === 16 ? [p[0]!, p[1]!] : [p[0]!];
    if (bpp === 2) {
      const v = p[0]! | (p[1]! << 8);
      return [((v >> 10) & 31) * 255 / 31 | 0, ((v >> 5) & 31) * 255 / 31 | 0, (v & 31) * 255 / 31 | 0];
    }
    return bpp === 4 ? [p[2]!, p[1]!, p[0]!, p[3]!] : [p[2]!, p[1]!, p[0]!];
  };
  const put = (v: number[]) => { if (pixel < w * h) { px.set(v, pixel * comp); pixel++; } };
  while (pixel < w * h) {
    if (!rle) { const v = read(); if (!v) return null; put(v); continue; }
    if (at >= file.length) return null;
    const packet = file[at++]!, count = (packet & 0x7f) + 1;
    if (packet & 0x80) { const v = read(); if (!v) return null; for (let i = 0; i < count; i++) put(v); }
    else for (let i = 0; i < count; i++) { const v = read(); if (!v) return null; put(v); }
  }
  // Bit 5 of the descriptor puts row 0 at the top; stb flips a bottom-up picture to top-first.
  if (!(desc & 0x20)) {
    const row = w * comp, out = new Uint16Array(px.length);
    for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return { w, h, comp, is16: false, px: out };
  }
  return { w, h, comp, is16: false, px };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
  MaskImageEnlarge2x: a world-space mask (a PNG or TGA file) in the top-left of a canvas twice as wide and tall,
  black elsewhere (an alpha channel opaque there), re-encoded in its own format: a PNG at its depth and channel
  count, Paeth on every row; a TGA uncompressed, top-left origin (a grey + alpha TGA as RGBA). The bytes, or why
  not, in Traxx's words.
*/
export function maskImageEnlarge2x(file: Uint8Array): { bytes: Uint8Array } | { why: string } {
  if (file.length < 18) return { why: WHY_MASK_NOT_IMAGE };
  const isPng = PNG_SIG.every((b, i) => file[i] === b);
  const looksTga = !isPng && file[1] === 0 && [2, 3, 10, 11].includes(file[2]!);
  if (!isPng && !looksTga) return { why: WHY_MASK_NOT_IMAGE };
  const img = isPng ? decodePngMask(file) : decodeTgaMask(file);
  if (!img || img.w < 1 || img.h < 1 || img.comp < 1 || img.comp > 4) return { why: WHY_MASK_DECODE };
  const { w, h, comp, is16 } = img;
  const bps = is16 ? 2 : 1;
  const outcomp = !isPng && comp === 2 ? 4 : comp;
  const W = 2 * w, H = 2 * h, pxbytes = outcomp * bps, rowbytes = W * pxbytes;
  if (W > 16384 || H > 16384 || rowbytes * H > MASK_CANVAS_MAX) return { why: WHY_MASK_BIG };
  const canvas = new Uint8Array(rowbytes * H);
  if (outcomp === 2 || outcomp === 4) {
    const acol = outcomp - 1;
    for (let i = 0; i < W * H; i++) for (let b = 0; b < bps; b++) canvas[i * pxbytes + acol * bps + b] = 0xff;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = y * rowbytes + x * pxbytes, si = (y * w + x) * comp, p = img.px;
      if (is16) {
        for (let c = 0; c < comp; c++) { canvas[d + 2 * c] = p[si + c]! >> 8; canvas[d + 2 * c + 1] = p[si + c]! & 255; }
      } else if (!isPng) {
        if (comp === 1) canvas[d] = p[si]!;
        else if (comp === 2) { canvas[d] = canvas[d + 1] = canvas[d + 2] = p[si]!; canvas[d + 3] = p[si + 1]!; }
        else { canvas[d] = p[si + 2]!; canvas[d + 1] = p[si + 1]!; canvas[d + 2] = p[si]!; if (comp === 4) canvas[d + 3] = p[si + 3]!; }
      } else for (let c = 0; c < comp; c++) canvas[d + c] = p[si + c]!;
    }
  }
  if (!isPng) {
    const out = new Uint8Array(18 + canvas.length);
    out[2] = outcomp === 1 ? 3 : 2;
    out[12] = W & 255; out[13] = W >> 8; out[14] = H & 255; out[15] = H >> 8;
    out[16] = outcomp * 8;
    out[17] = 0x20 | (outcomp === 4 ? 8 : 0);
    out.set(canvas, 18);
    return { bytes: out };
  }
  const filtered = new Uint8Array(H * (rowbytes + 1));
  const zero = new Uint8Array(rowbytes);
  for (let y = 0; y < H; y++) {
    const cur = canvas.subarray(y * rowbytes, (y + 1) * rowbytes);
    const prev = y ? canvas.subarray((y - 1) * rowbytes, y * rowbytes) : zero;
    const dst = y * (rowbytes + 1);
    filtered[dst] = 4;
    for (let i = 0; i < rowbytes; i++) {
      const a = i >= pxbytes ? cur[i - pxbytes]! : 0, b = prev[i]!, c = i >= pxbytes ? prev[i - pxbytes]! : 0;
      filtered[dst + 1 + i] = (cur[i]! - paeth(a, b, c)) & 255;
    }
  }
  const zdata = stbiZlibCompress(filtered, 8);
  const ctype = [0, 0, 4, 2, 6][outcomp]!;
  const ihdr = new Uint8Array(13);
  const be32 = (b: Uint8Array, at: number, v: number) => { b[at] = v >>> 24; b[at + 1] = (v >>> 16) & 255; b[at + 2] = (v >>> 8) & 255; b[at + 3] = v & 255; };
  be32(ihdr, 0, W); be32(ihdr, 4, H);
  ihdr[8] = bps * 8; ihdr[9] = ctype;
  const out = new Uint8Array(8 + 25 + 12 + zdata.length + 12);
  out.set(PNG_SIG, 0);
  let d = 8;
  const chunk = (type: string, data: Uint8Array) => {
    be32(out, d, data.length);
    for (let k = 0; k < 4; k++) out[d + 4 + k] = type.charCodeAt(k);
    out.set(data, d + 8);
    be32(out, d + 8 + data.length, crc32(out, d + 4, d + 8 + data.length));
    d += 12 + data.length;
  };
  chunk("IHDR", ihdr);
  chunk("IDAT", zdata);
  chunk("IEND", new Uint8Array(0));
  return { bytes: out.subarray(0, d) };
}

/* LowestHeight: the active grid's lowest v (raw << 8 on Classic 8-bit), the terrain alone. */
function lowestHeight(t: TxxTrack): number {
  syncFromRaw(t);
  const g = t.terrainMode === TERRAINMODE_CLASSIC8 ? null : t.fine ?? t.h16;
  let lo = Infinity;
  if (g) for (let i = 0; i < g.length; i++) { if (g[i]! < lo) lo = g[i]!; }
  else for (let i = 0; i < 65536; i++) { const v = t.heights[i]! << 8; if (v < lo) lo = v; }
  return lo === Infinity ? 0 : lo;
}

/* GrowTo(512, fill): every plane into the top-left of a 512 one, the new ground flat at `fill`. */
function growTo512(t: TxxTrack, fill: number): void {
  syncFromRaw(t);
  const oc = 256, nc = 512, nn = nc * nc;
  const raw = t.heights, clr = t.clr, lte = t.lte;
  const nraw = new Uint8Array(nn).fill(mirrorOf(fill));
  const nclr = new Uint16Array(nn);
  const nlte = new Uint8Array(nn * 7);
  for (let i = 0; i < nn; i++) nlte[i * 7] = FLAT_LTE;
  let nh16: HeightGrid | null = null, nfine: HeightGrid | null = null;
  const classic8 = t.terrainMode === TERRAINMODE_CLASSIC8;
  const wide = t.h16 instanceof Int32Array || t.fine instanceof Int32Array;
  const make = (n: number) => (wide ? new Int32Array(n) : new Uint16Array(n)).fill(fill);
  if (t.terrainMode === TERRAINMODE_FINE) nfine = make(16 * nn);
  else nh16 = make(nn);
  for (let z = 0; z < oc; z++) {
    nraw.set(raw.subarray(z * oc, (z + 1) * oc), z * nc);
    nclr.set(clr.subarray(z * oc, (z + 1) * oc), z * nc);
    if (lte) nlte.set(lte.subarray(z * oc * 7, (z + 1) * oc * 7), z * nc * 7);
    if (nh16 && t.h16) nh16.set(t.h16.subarray(z * oc, (z + 1) * oc), z * nc);
    else if (nh16) for (let x = 0; x < oc; x++) nh16[z * nc + x] = raw[z * oc + x]! << 8;
  }
  if (nfine && t.fine) for (let z = 0; z < 4 * oc; z++) nfine.set(t.fine.subarray(z * 4 * oc, (z + 1) * 4 * oc), z * 4 * nc);
  t.heights = nraw;
  t.clr = nclr;
  t.lte = nlte;
  t.h16 = nh16;
  t.fine = nfine;
  t.rawShadow = nraw.slice();
  t.worldCells = 512;
  if (classic8) t.terrainMode = TERRAINMODE_CLASSIC16;
  refreshRaw(t);
  heightsChanged(t);
}

/**
  EnlargeWorld512: false, with report.reason and the track exactly as it was, for a track already 512 or a mask
  that cannot be re-encoded; true when done, the report listing the lakes and waterfalls the author must look at.
  `names` is the waterfalls' name check (falls.ts FallNameCheck; null: names are not checked).
*/
export function enlargeWorld512(t: TxxTrack, names: FallNameCheck = null): { ok: boolean; report: EnlargeReport } {
  const report: EnlargeReport = { lakes: [], falls: [], reason: "" };
  if (t.worldCells !== 256 || t.heights.length !== 65536) {
    report.reason = ENLARGE_ALREADY_512;
    return { ok: false, report };
  }
  const tall = isV6(t) ? tallHeights(t) : false;

  // Everything that can fail first: the four masks' new pictures.
  const veg = t.vegetation;
  const slots: { name: string; get: () => TxxHdArt | null; set: (a: TxxHdArt) => void }[] = [
    { name: "_MASK", get: () => (t.maskMap ? { ext: t.maskExt, data: t.maskMap } : null), set: (a) => { t.maskMap = a.data; } },
    { name: "_WMSK", get: () => (t.waterMaskMap ? { ext: t.waterMaskExt, data: t.waterMaskMap } : null), set: (a) => { t.waterMaskMap = a.data; } },
    { name: "_V", get: () => veg?.masks[0] ?? null, set: (a) => { veg!.masks[0] = a; } },
    { name: "_G", get: () => veg?.masks[1] ?? null, set: (a) => { veg!.masks[1] = a; } },
  ];
  const grown: (TxxHdArt | null)[] = [];
  for (const s of slots) {
    const old = s.get();
    if (!old) { grown.push(null); continue; }
    const r = maskImageEnlarge2x(old.data);
    if ("why" in r) {
      report.reason = `The ${s.name} mask ${r.why}, so the world cannot be enlarged. Remove or replace it first.`;
      return { ok: false, report };
    }
    grown.push({ ext: old.ext, data: r.bytes });
  }

  // What each lake filled before (the map shown), to see what the new ground changes.
  const before = t.lakes.length ? trackLakes(t) : null;
  const oldmap = before?.tmap ?? null;
  const oldcount = before ? before.lakes.map((l) => l.tilecount) : [];

  // ---- Committed. ----
  // The vegetation planted against the old masks is current against the new ones: its recorded CRC follows.
  if (veg && veg.image && (grown[2] || grown[3])) {
    const v = vegetationFromTxx(veg, 256);
    let follows = false;
    for (let l = 0; l < 2; l++) {
      const g = grown[2 + l], old = veg.masks[l];
      if (!g || !old) continue;
      v.masks[l] = { ext: g.ext, data: g.data };
      if (v.plantedcrc[l] !== 0 && v.plantedcrc[l] === vegCrc32(old.data)) { v.plantedcrc[l] = vegCrc32(g.data); follows = true; }
    }
    // The image carries the CRCs (BuildVEG's RULE chunk): rebuilt only when one follows.
    const block = follows && !v.readonly ? vegetationToTxx(v, t.prefix, undefined, 512) : null;
    if (block?.image) veg.image = block.image;
  }
  grown.forEach((g, i) => { if (g) slots[i]!.set(g); });

  growTo512(t, lowestHeight(t));
  // The stored lake map goes with its tiles, into the corner of a 512 map.
  if (t.storedLakeMap) {
    const n = new Uint8Array(512 * 512);
    for (let z = 0; z < 256; z++) n.set(t.storedLakeMap.tmap.subarray(z * 256, (z + 1) * 256), z * 512);
    t.storedLakeMap = { ...t.storedLakeMap, tmap: n };
  }
  // A classic track becomes Standard V6 exactly as Track Type does it; a v6 one is asked again for what it is.
  setTrackKind(t, tall ? "tall" : "standard", 512);
  // The objects keep their absolute height; their height above the ground follows the new ground.
  deriveBoxHeights(t);

  // The lakes and falls judged against the new world.
  if (t.lakes.length) {
    // Traxx's Recompute: the fill (a stored map on show is compared with it, not read through it).
    const held = t.storedLakeMap;
    t.storedLakeMap = null;
    const now = trackLakes(t);
    t.storedLakeMap = held;
    if (t.storedLakeMap) {
      let diff = 0;
      for (let i = 0; i < now.tmap.length; i++) if (now.tmap[i] !== t.storedLakeMap.tmap[i]) diff++;
      if (diff === 0) t.storedLakeMap = null;
    }
    const changed = new Uint8Array(256);
    if (oldmap) {
      for (let z = 0; z < 512; z++) for (let x = 0; x < 512; x++) {
        const was = x < 256 && z < 256 ? oldmap[x + (z << 8)]! : 0, is = now.tmap[x + (z << 9)]!;
        if (was !== is) changed[was] = changed[is] = 1;
      }
    }
    let unchecked = !oldmap;
    now.lakes.forEach((l, i) => {
      const fillfailed = (oldcount[i] ?? 0) > 0 && l.tilecount === 0 && l.errors === 0;
      if (l.errors !== 0 || changed[i + 1] || fillfailed) {
        report.lakes.push(i + 1);
        if (fillfailed) unchecked = true;
      }
    });
    if (unchecked) report.reason = "There was not enough memory to check the lakes against the new ground; check them in the lake list.";
  }
  if (t.falls.length) {
    const lakes = { lakes: t.lakes, tmap: t.lakes.length ? trackLakes(t).tmap : null, world: fallWorldOf(t), rule: trackLakeRule(t) };
    const lip = buildLakeGround(t);
    t.falls.forEach((_, i) => { if (fallErrors(t.falls, i, lakes, names, lip) !== 0) report.falls.push(i + 1); });
  }
  return { ok: true, report };
}
