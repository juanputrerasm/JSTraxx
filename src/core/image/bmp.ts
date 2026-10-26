/*
  The track's UI bitmaps (Traxx keeps each as a whole .BMP file):

    bmpInfo      width, height, bit depth and compression from the headers
    makeBmp8     HDTexMakeBMP8: true colour box-filtered to the legacy size and given its own
                 palette by HDTexQuantize, written bottom-up with 256 colours
    stockIcon    OnBitmapStock's 32-byte record: "NAME.BMP" with the sheet cell in bytes 30, 31
*/
import { quantize, resampleRgb } from "./hd-texture.ts";

export interface BmpInfo { width: number; height: number; bits: number; compression: number }

export function bmpInfo(bytes: Uint8Array | null): BmpInfo | null {
  if (!bytes || bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: v.getInt32(18, true), height: Math.abs(v.getInt32(22, true)), bits: v.getUint16(28, true), compression: v.getUint32(30, true) };
}

export function makeBmp8(rgb: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const shrunk = resampleRgb(rgb, sw, sh, dw, dh);
  const { indices, act } = quantize(shrunk, dw, dh);
  const headers = 14 + 40 + 1024;
  const row = (dw + 3) & ~3;
  const out = new Uint8Array(headers + row * dh);
  const v = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  v.setUint32(2, out.length, true);
  v.setUint32(10, headers, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, dw, true);
  v.setInt32(22, dh, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 8, true);
  v.setUint32(34, row * dh, true);
  v.setUint32(46, 256, true);
  v.setUint32(50, 256, true);
  for (let i = 0; i < 256; i++) {
    out[54 + i * 4] = act[i * 3 + 2]!;
    out[54 + i * 4 + 1] = act[i * 3 + 1]!;
    out[54 + i * 4 + 2] = act[i * 3]!;
  }
  for (let y = 0; y < dh; y++) out.set(indices.subarray(y * dw, y * dw + dw), headers + (dh - 1 - y) * row);
  return out;
}

/** stock_icon_names[row][col] (TraxxComponentsDlg.cpp). */
export const STOCK_ICON_NAMES = [
  ["TNCIRCIT", "TN-FM29", "TNNONE"],
  ["TNRALLY", "TN-GRAVE", "TN-SWNDR"],
  ["TN-98", "TN-HIGHT", "TN-THORN"],
  ["TN-BNECK", "TN-JUNK", "TN-TORT"],
  ["TNDRAG", "TNKING", "TN-TWED"],
  ["TN-EXCAV", "TN-NEW", "TN-VOODO"],
];

export function stockIcon(col: number, row: number): Uint8Array {
  const out = new Uint8Array(32);
  const name = `${STOCK_ICON_NAMES[row]![col]}.BMP`;
  for (let i = 0; i < name.length; i++) out[i] = name.charCodeAt(i);
  out[30] = col;
  out[31] = row;
  return out;
}

/** The sheet cell of a stock icon record, or null for a real bitmap. */
export function stockIconCell(bytes: Uint8Array | null): { col: number; row: number; name: string } | null {
  if (!bytes || bytes.length !== 32) return null;
  const col = bytes[30]!, row = bytes[31]!;
  if (col > 2 || row > 5) return null;
  let name = "";
  for (let i = 0; i < 30 && bytes[i]; i++) name += String.fromCharCode(bytes[i]!);
  return { col, row, name };
}
