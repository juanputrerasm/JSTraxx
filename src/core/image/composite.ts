/*
  Paste Composite's geometry and tile writers (Traxx/TextureCutDlg.cpp, HDTexture.cpp).

  An image is cut into a grid of square tiles named <base><col><row>, each one hex digit, so
  16 x 16 at most. A .RAW tile with the overlap on shares its border ring (size/32) with its
  neighbours, so the visible parts meet; PNG and TGA tiles abut, since the importer builds each
  one's ring itself.
*/
import { borderInset, HDTEX_COMPOSITE_MAX, quantize } from "./hd-texture.ts";

export type CutFormat = "PNG" | "TGA" | "RAW";
export const CUT_MAXGRID = 16;
/** kLegacySizes and kHDSizes: what each format's tiles may be. */
export const LEGACY_SIZES = [32, 64, 256];
export const HD_SIZES = [32, 64, 128, 256, 512, 1024];

export interface CutSettings {
  format: CutFormat;
  size: number;
  overlap: boolean;
  xoff: number;
  yoff: number;
  cols: number;
  rows: number;
}

export function tileRing(s: Pick<CutSettings, "format" | "overlap" | "size">): number {
  return s.format === "RAW" && s.overlap && s.size > 0 ? borderInset(s.size) : 0;
}

export function tileStride(s: Pick<CutSettings, "format" | "overlap" | "size">): number {
  return s.size - 2 * tileRing(s);
}

export function tileOrigin(s: CutSettings, c: number, r: number): { x: number; y: number } {
  return { x: s.xoff + c * tileStride(s), y: s.yoff + r * tileStride(s) };
}

/** FitCount: whole tiles along one side from an offset, one hex digit's worth at most. */
export function fitCount(dim: number, off: number, size: number, stride: number): number {
  if (size <= 0 || stride <= 0 || dim - off < size) return 0;
  return Math.min(CUT_MAXGRID, Math.floor((dim - off - size) / stride) + 1);
}

/** FillSizes: the sizes this image offers in the format; the size kept if offered, else 256, else the largest. */
export function sizesFor(format: CutFormat, w: number, h: number): number[] {
  const fit = Math.min(w, h);
  return (format === "RAW" ? LEGACY_SIZES : HD_SIZES).filter((s) => s <= fit);
}

export function pickSize(sizes: number[], wanted: number): number {
  if (sizes.includes(wanted)) return wanted;
  if (sizes.includes(256)) return 256;
  return sizes.at(-1) ?? 0;
}

/** ApplyLimits: offsets kept where a tile still fits; columns and rows to how many fit. */
export function applyLimits(s: CutSettings, w: number, h: number): CutSettings & { maxCols: number; maxRows: number; maxX: number; maxY: number } {
  const maxX = s.size > 0 ? Math.max(0, w - s.size) : 0;
  const maxY = s.size > 0 ? Math.max(0, h - s.size) : 0;
  const xoff = Math.max(0, Math.min(s.xoff, maxX));
  const yoff = Math.max(0, Math.min(s.yoff, maxY));
  const stride = tileStride(s);
  const maxCols = fitCount(w, xoff, s.size, stride);
  const maxRows = fitCount(h, yoff, s.size, stride);
  let cols = Math.min(s.cols, maxCols), rows = Math.min(s.rows, maxRows);
  if (cols < 1 && maxCols >= 1) cols = 1;
  if (rows < 1 && maxRows >= 1) rows = 1;
  return { ...s, xoff, yoff, cols, rows, maxCols, maxRows, maxX, maxY };
}

/** The refusal for an image too big to cut from, or null. */
export function compositeRefusal(w: number, h: number): string | null {
  if (w < 1 || h < 1 || w > HDTEX_COMPOSITE_MAX || h > HDTEX_COMPOSITE_MAX) {
    return `The image is ${w} x ${h} - an image to cut textures from can be up to ${HDTEX_COMPOSITE_MAX} x ${HDTEX_COMPOSITE_MAX}.`;
  }
  return null;
}

/** sprintf("%s%X%X", base, c, r). */
export function tileName(base: string, c: number, r: number): string {
  return `${base}${c.toString(16).toUpperCase()}${r.toString(16).toUpperCase()}`;
}

/** One size x size tile of packed RGB from an image w wide. */
export function cutRgb(rgb: Uint8Array, w: number, x: number, y: number, size: number): Uint8Array {
  const out = new Uint8Array(size * size * 3);
  for (let row = 0; row < size; row++) out.set(rgb.subarray(((y + row) * w + x) * 3, ((y + row) * w + x + size) * 3), row * size * 3);
  return out;
}

/** HDTexWriteTGA24: uncompressed 24-bit, origin bottom left. */
export function encodeTga24(rgb: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(18 + w * h * 3);
  out[2] = 2;
  out[12] = w & 255; out[13] = w >> 8;
  out[14] = h & 255; out[15] = h >> 8;
  out[16] = 24;
  let p = 18;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3;
      out[p++] = rgb[s + 2]!;
      out[p++] = rgb[s + 1]!;
      out[p++] = rgb[s]!;
    }
  }
  return out;
}

/** HDTexWriteLegacyTile: a .RAW and its .ACT straight from true colour, no resampling. */
export function legacyTile(rgb: Uint8Array, size: number): { raw: Uint8Array; act: Uint8Array } {
  const { indices, act } = quantize(rgb, size, size);
  return { raw: indices, act };
}
