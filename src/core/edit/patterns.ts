/*
  Texture patterns (Traxx/TexturePattern.cpp): a saved block of terrain cells, its textures by
  name, and an 8-bit thumbnail in the track palette.

    buildPattern    TexturePattern::Build, from the area Copy Area took (2 to 16 cells a side)
    missingTextures the pattern's textures the track does not hold
    pasteMapping    pattern texture slot -> track texture index
    pastePattern    TexturePattern::Extract's copy: the smaller of the pattern and the area
*/
import type { TrackDocument } from "../doc/document.ts";
import { findAsset } from "../doc/names.ts";
import { trackIndices } from "../view/tiles.ts";
import type { TxpPattern } from "../traxx/txp.ts";
import type { Area } from "./textures.ts";

/** MAXNPATTERNS: a file holds this many. */
export const MAX_PATTERNS = 256;

export function buildPattern(doc: TrackDocument, name: string, rect: Area, displayPalette: Uint8Array): TxpPattern | null {
  if (rect.x1 - rect.x0 >= 16 || rect.y1 - rect.y0 >= 16) return null;
  const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1;
  if (w < 1 || h < 1 || (w < 2 && h < 2)) return null;
  const clr = doc.track.clr;
  const data: number[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data.push(clr[i + rect.x0 + ((j + rect.y0) << 8)]!);

  // First-use order, then compacted over the textures the track holds (a missing one keeps
  // its first-pass number, as Traxx's does).
  const mapping = new Map<number, number>();
  for (const word of data) { const t = word & 0x0fff; if (!mapping.has(t)) mapping.set(t, mapping.size); }
  const textures: string[] = [];
  for (const t of [...mapping.keys()].sort((a, b) => a - b)) {
    const tex = doc.textures[t];
    if (tex) { mapping.set(t, textures.length); textures.push(tex.name); }
  }
  const cells = data.map((word) => (word & 0xf000) | (mapping.get(word & 0x0fff)! & 0x0fff));

  // The thumbnail: tiles of imsize, 64 halved until it is at most 100 / the longer side.
  let imsize = 64;
  const longest = Math.max(w, h);
  while (imsize > Math.trunc(100 / longest)) imsize >>= 1;
  const bmw = w * imsize, bmh = h * imsize;
  const pixels = new Uint8Array(bmw * bmh);
  const sourceOf = (slot: number) => { for (const [t, s] of mapping) if (s === slot) return t; return -1; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const word = cells[x + y * w]!;
      const src = sourceOf(word & 0x0fff);
      const tex = src >= 0 ? doc.textures[src] : null;
      const tile = tex ? trackIndices(tex, doc.track.palette) : null;
      if (!tex || !tile || (tex.side !== 64 && tex.side !== 256)) continue;
      const scale = tex.side / imsize;
      for (let j = 0; j < imsize; j++) {
        for (let i = 0; i < imsize; i++) {
          let ii = i, jj = j;
          if (word & 0x1000) jj = imsize - 1 - jj;
          if (word & 0x2000) ii = imsize - 1 - ii;
          const arg = (word & 0xc000) >> 14;
          if (arg === 1) { const t = jj; jj = imsize - 1 - ii; ii = t; }
          else if (arg === 2) { ii = imsize - 1 - ii; jj = imsize - 1 - jj; }
          else if (arg === 3) { const t = jj; jj = ii; ii = imsize - 1 - t; }
          pixels[x * imsize + i + ((h - 1 - y) * imsize + j) * bmw] = tile[ii * scale + jj * scale * tex.side]!;
        }
      }
    }
  }
  return { name: name.slice(0, 39), w, h, cells, textures, thumbInfo: bitmapInfo(bmw, bmh, displayPalette), thumbPixels: pixels };
}

/** A top-down 8-bit BitmapInfo256 over a palette of 768 RGB bytes. */
function bitmapInfo(w: number, h: number, palette: Uint8Array): Uint8Array {
  const info = new Uint8Array(40 + 1024);
  const v = new DataView(info.buffer);
  v.setUint32(0, 40, true);
  v.setInt32(4, w, true);
  v.setInt32(8, -h, true);
  v.setUint16(12, 1, true);
  v.setUint16(14, 8, true);
  v.setInt32(24, 1000, true);
  v.setInt32(28, 1000, true);
  v.setUint32(32, 256, true);
  v.setUint32(36, 256, true);
  for (let c = 0; c < 256; c++) {
    info[40 + c * 4] = palette[c * 3 + 2]!;
    info[40 + c * 4 + 1] = palette[c * 3 + 1]!;
    info[40 + c * 4 + 2] = palette[c * 3]!;
  }
  return info;
}

/** The thumbnail as RGBA, with its size. */
export function patternThumbnail(p: TxpPattern): { width: number; height: number; rgba: Uint8Array } | null {
  const v = new DataView(p.thumbInfo.buffer, p.thumbInfo.byteOffset, p.thumbInfo.byteLength);
  const w = v.getInt32(4, true), h = Math.abs(v.getInt32(8, true));
  if (w < 1 || h < 1 || p.thumbPixels.length < w * h) return null;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = 40 + p.thumbPixels[i]! * 4;
    rgba[i * 4] = p.thumbInfo[c + 2]!;
    rgba[i * 4 + 1] = p.thumbInfo[c + 1]!;
    rgba[i * 4 + 2] = p.thumbInfo[c]!;
    rgba[i * 4 + 3] = 255;
  }
  return { width: w, height: h, rgba };
}

export function missingTextures(doc: TrackDocument, p: TxpPattern): string[] {
  return p.textures.filter((n) => findAsset(doc.textures, n) < 0);
}

/** Pattern slot -> track index; 0 for a texture the track does not hold. */
export function pasteMapping(doc: TrackDocument, p: TxpPattern): number[] {
  return p.textures.map((n) => Math.max(0, findAsset(doc.textures, n)));
}

/** Extract's copy into the area: the smaller of the two, from its top left. */
export function pastePattern(clr: Uint16Array, p: TxpPattern, mapping: readonly number[], a: Area): void {
  const pw = Math.min(p.w, a.x1 - a.x0 + 1), ph = Math.min(p.h, a.y1 - a.y0 + 1);
  for (let j = 0; j < ph; j++) {
    for (let i = 0; i < pw; i++) {
      const word = p.cells[i + j * p.w]!;
      clr[i + a.x0 + ((j + a.y0) << 8)] = ((mapping[word & 0x0fff] ?? 0) & 0x0fff) | (word & 0xf000);
    }
  }
}
