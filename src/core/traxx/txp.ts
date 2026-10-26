/*
  .TXP texture patterns: saved blocks of texture cells (Traxx 1.6.7, Traxx/TexturePattern.cpp
  TexturePattern::Load and Save, and Traxx/TraxxPatternsDlg.cpp LoadPatterns and SavePatterns).

  The file is "TXPH1", a 16-bit pattern count, then each pattern:

    "TXP1", a length byte and the name (no terminator, at most 39 kept), width and height (16-bit),
    width * height 16-bit cell words, a 32-bit texture count and each texture's name in a fixed
    32-byte field, the thumbnail's BITMAPINFOHEADER and 256-colour table (1064 bytes), its pixels
    (width * -height bytes, the height being negative for a top-down bitmap), and a 32-bit spare.

  Little-endian throughout.
*/

export interface TxpPattern {
  name: string;
  w: number;
  h: number;
  /** w * h cell words, row by row, in the .CLR layout. */
  cells: number[];
  /** The textures the cells use, by name. */
  textures: string[];
  /** The thumbnail's BitmapInfo256: BITMAPINFOHEADER then 256 RGBQUADs. */
  thumbInfo: Uint8Array;
  /** Its 8-bit pixels. */
  thumbPixels: Uint8Array;
}

export class TxpError extends Error {
  override name = "TxpError";
}

const NAME_MAX = 39;
const TEXTURE_NAME_FIELD = 32;
const BITMAP_INFO_SIZE = 40 + 256 * 4;
/** MAXNPATTERNTEXTURES: the cell array's size. */
const MAX_CELLS = 256;

export function readTxp(bytes: Uint8Array): TxpPattern[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const need = (n: number) => { if (pos + n > bytes.length) throw new TxpError("the pattern file ends early"); };
  const u16 = () => { need(2); const v = view.getUint16(pos, true); pos += 2; return v; };
  const i32 = () => { need(4); const v = view.getInt32(pos, true); pos += 4; return v; };
  const take = (n: number) => { need(n); const out = bytes.slice(pos, pos + n); pos += n; return out; };

  if (ascii(take(5)) !== "TXPH1") throw new TxpError("not a Traxx pattern file");
  const count = u16();
  const patterns: TxpPattern[] = [];
  for (let p = 0; p < count; p++) {
    if (ascii(take(4)) !== "TXP1") throw new TxpError(`pattern ${p + 1} has no TXP1 mark`);
    const len = take(1)[0];
    if (len < 1) throw new TxpError(`pattern ${p + 1} has no name`);
    const name = cString(take(len)).slice(0, NAME_MAX);
    const w = u16(), h = u16();
    if (w * h > MAX_CELLS) throw new TxpError(`pattern "${name}" is ${w}x${h}, more than ${MAX_CELLS} cells`);
    const cells = Array.from({ length: w * h }, u16);
    const textureCount = i32();
    const textures = Array.from({ length: Math.max(0, textureCount) }, () => cString(take(TEXTURE_NAME_FIELD)));
    const thumbInfo = take(BITMAP_INFO_SIZE);
    const info = new DataView(thumbInfo.buffer);
    const thumbPixels = take(Math.max(0, -info.getInt32(4, true) * info.getInt32(8, true)));
    i32();
    patterns.push({ name, w, h, cells, textures, thumbInfo, thumbPixels });
  }
  return patterns;
}

export function writeTxp(patterns: readonly TxpPattern[]): Uint8Array {
  const out: number[] = [];
  const u8 = (v: number) => out.push(v & 0xff);
  const u16 = (v: number) => { u8(v); u8(v >> 8); };
  const i32 = (v: number) => { u8(v); u8(v >> 8); u8(v >> 16); u8(v >> 24); };
  const bytes = (b: ArrayLike<number>) => { for (let i = 0; i < b.length; i++) out.push(b[i] & 0xff); };
  bytes(latin1("TXPH1"));
  u16(patterns.length);
  for (const pattern of patterns) {
    // Save refuses a pattern without a name: it would read back as the end of the file.
    if (!pattern.name) throw new TxpError("a pattern needs a name");
    const name = latin1(pattern.name.slice(0, NAME_MAX));
    bytes(latin1("TXP1"));
    u8(name.length);
    bytes(name);
    u16(pattern.w);
    u16(pattern.h);
    for (let i = 0; i < pattern.w * pattern.h; i++) u16(pattern.cells[i] ?? 0);
    i32(pattern.textures.length);
    for (const texture of pattern.textures) {
      const field = new Uint8Array(TEXTURE_NAME_FIELD);
      field.set(latin1(texture).subarray(0, TEXTURE_NAME_FIELD - 1));
      bytes(field);
    }
    const info = new Uint8Array(BITMAP_INFO_SIZE);
    info.set(pattern.thumbInfo.subarray(0, BITMAP_INFO_SIZE));
    bytes(info);
    bytes(pattern.thumbPixels);
    i32(0);
  }
  return Uint8Array.from(out);
}

function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return ascii(end < 0 ? bytes : bytes.subarray(0, end));
}

function ascii(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
}
