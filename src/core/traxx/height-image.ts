/*
  The height-image codec of Traxx 1.7 (TrackPOD/TrackPODHeightImage.cpp, Include/TrackPODHeightImage.h):
  grayscale PNG (8/16-bit) and grayscale TGA (8-bit) in, decoded to 16-bit heights; grayscale PNG
  out, byte for byte what Traxx writes.

  Decoding: the refusals are read straight from the header BEFORE any decoder runs, so a colour or
  4-bit image is refused with its real reason (DecodePng, DecodeTga). Past them Traxx hands the file
  to stb_image v2.30: the PNG samples here come from OpenPhotex's decodePngSamples, and the grey TGA
  (raw or RLE, either vertical origin) is read the way stbi__tga_load reads one.

  Encoding (HeightPngEncode): IHDR, one IDAT, IEND. Every row is Paeth filtered (filter type 4),
  16-bit samples go out big-endian, 8-bit ones are v >> 8 rounded half up and clamped at 255. The
  IDAT is stb_image_write v1.16's stbi_zlib_compress at quality 8 (third_party/stb/
  stb_image_write.h): one fixed-Huffman block from a 16384-bucket hash-chain LZ77 with one step of
  lazy matching, falling back to stored blocks when that came out bigger, then the Adler-32.
*/

import { decodePngSamples } from "../../vendor/openphotex/texture/png.js";

// ---- Refusal sentences (the WHY_* statics) ----------------------------------------------------

export const WHY_NOT_IMAGE = "This file is not a PNG or TGA image.";
export const WHY_COLOUR_PNG = "This image is a colour PNG; height maps must be grayscale.";
export const WHY_BAD_DEPTH = "This PNG is 1-, 2- or 4-bit grayscale; height maps must be 8- or 16-bit.";
export const WHY_COLOUR_TGA = "This image is a colour TGA; height maps must be 8-bit grayscale.";
export const WHY_TGA_BITS = "This TGA is not 8-bit; height maps must be 8-bit grayscale.";
export const WHY_TGA_RTL = "This TGA is stored right to left; flip it horizontally and save it again.";
export const WHY_DECODE = "This image could not be decoded; the file may be damaged.";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10];

function isPngSig(f: Uint8Array): boolean {
  if (f.length < 8) return false;
  for (let i = 0; i < 8; i++) if (f[i] !== PNG_SIG[i]) return false;
  return true;
}

function readBE32(f: Uint8Array, o: number): number {
  return ((f[o]! << 24) | (f[o + 1]! << 16) | (f[o + 2]! << 8) | f[o + 3]!) >>> 0;
}

/** SizeAllowed: 256 x 256 or 1024 x 1024. */
function sizeAllowed(w: number, h: number): boolean {
  return w === h && (w === 256 || w === 1024);
}

/**
  WhySize: the size refusal names the size the image has; a 1025 (or 257) map, what a tool that
  counts vertices instead of cells writes, gets the hint.
*/
export function whySize(w: number, h: number): string {
  const hint = w === h && (w === 1025 || w === 257) ? ` (a ${w} map: drop the last row and column)` : "";
  return `This image is ${w} x ${h}; height maps must be 256 x 256 or 1024 x 1024${hint}.`;
}

/** A decoded height image: v is always 16-bit (an 8-bit sample b is b << 8), rows = Z, top row Z 0. */
export interface HeightImage {
  ok: true;
  v: Uint16Array;
  /** 256 or 1024. */
  size: number;
  /** The file's own depth, 8 or 16. */
  srcBits: number;
}
export interface HeightImageRefusal {
  ok: false;
  why: string;
}

// ---- Decoder ----------------------------------------------------------------------------------

/** DecodePng: the IHDR checks, then the samples (one channel; grey + alpha drops the alpha). */
function decodePng(f: Uint8Array): HeightImage | HeightImageRefusal {
  if (f.length < 33 || readBE32(f, 8) !== 13 || f[12] !== 0x49 || f[13] !== 0x48 || f[14] !== 0x44 || f[15] !== 0x52) return { ok: false, why: WHY_NOT_IMAGE };
  const w = readBE32(f, 16), h = readBE32(f, 20);
  const depth = f[24]!, ctype = f[25]!;
  if (ctype === 2 || ctype === 3 || ctype === 6) return { ok: false, why: WHY_COLOUR_PNG };
  if (ctype !== 0 && ctype !== 4) return { ok: false, why: WHY_NOT_IMAGE };
  if (depth === 1 || depth === 2 || depth === 4) return { ok: false, why: WHY_BAD_DEPTH };
  if (depth !== 8 && depth !== 16) return { ok: false, why: WHY_NOT_IMAGE };
  if (!sizeAllowed(w, h)) return { ok: false, why: whySize(w, h) };
  // Past the checks Traxx asks stb_image for one channel; the samples come from OpenPhotex here.
  // (stb also reads an interlaced PNG; OpenPhotex's reader refuses one, which lands on WHY_DECODE.)
  let img;
  try { img = decodePngSamples(f); } catch { return { ok: false, why: WHY_DECODE }; }
  if (img.width !== w || img.height !== h || img.bitDepth !== depth) return { ok: false, why: WHY_DECODE };
  const n = w * h, ch = img.channels, out = new Uint16Array(n);
  if (depth === 16) for (let i = 0; i < n; i++) out[i] = img.samples[i * ch]!;
  else for (let i = 0; i < n; i++) out[i] = (img.samples[i * ch]! << 8) & 0xffff;
  return { ok: true, v: out, size: w, srcBits: depth };
}

/**
  The grey 8-bit TGA as stbi__tga_load reads it (stb_image v2.30), for the headers DecodeTga lets
  through (type 3 or 11, no colour map, 8 bpp): the data starts after the id field (byte 0 is its
  length); a raw image is read row by row, an RLE one pixel by pixel with packets free to run across
  rows; descriptor bit 5 clear (bottom-left origin) flips the rows, so the first row returned is the
  top one. stb's memory reader gives 0 past the end of the file; a raw row it cannot read whole is
  left as it was allocated, which here is 0.
*/
function stbTgaGrey8(f: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const rle = f[2]! >= 8;
  const inverted = ((f[17]! >> 5) & 1) === 0;
  let p = 18 + f[0]!;
  const get8 = () => (p < f.length ? f[p++]! : 0);
  if (!rle) {
    for (let i = 0; i < h; i++) {
      const row = inverted ? h - i - 1 : i;
      if (p + w <= f.length) { out.set(f.subarray(p, p + w), row * w); p += w; }
    }
    return out;
  }
  let count = 0, repeating = 0, read = 1, value = 0;
  for (let i = 0; i < w * h; i++) {
    if (count === 0) {
      const cmd = get8();
      count = 1 + (cmd & 127);
      repeating = cmd >> 7;
      read = 1;
    } else if (!repeating) read = 1;
    if (read) { value = get8(); read = 0; }
    out[i] = value;
    count--;
  }
  if (inverted) {
    const tmp = new Uint8Array(w);
    for (let j = 0; j * 2 < h; j++) {
      const a = j * w, b = (h - 1 - j) * w;
      tmp.set(out.subarray(a, a + w));
      out.copyWithin(a, b, b + w);
      out.set(tmp, b);
    }
  }
  return out;
}

/** DecodeTga: TGA has no signature, so the header must look like a grey one; then stb reads it. */
function decodeTga(f: Uint8Array): HeightImage | HeightImageRefusal {
  if (f.length < 18) return { ok: false, why: WHY_NOT_IMAGE };
  const type = f[2]!;
  if (type === 1 || type === 2 || type === 9 || type === 10) return { ok: false, why: WHY_COLOUR_TGA };
  if (type !== 3 && type !== 11) return { ok: false, why: WHY_NOT_IMAGE };
  if (f[1] !== 0) return { ok: false, why: WHY_COLOUR_TGA };
  if (f[16] !== 8) return { ok: false, why: WHY_TGA_BITS };
  if (f[17]! & 0x10) return { ok: false, why: WHY_TGA_RTL };
  const w = f[12]! | (f[13]! << 8), h = f[14]! | (f[15]! << 8);
  if (!sizeAllowed(w, h)) return { ok: false, why: whySize(w, h) };
  const b = stbTgaGrey8(f, w, h);
  const out = new Uint16Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = b[i]! << 8;
  return { ok: true, v: out, size: w, srcBits: 8 };
}

/**
  HeightImageDecode: PNG or TGA, sniffed by signature, into 16-bit heights. A refusal carries the
  static English sentence Traxx shows as it is.
*/
export function heightImageDecode(file: Uint8Array | null): HeightImage | HeightImageRefusal {
  if (!file || file.length < 18) return { ok: false, why: WHY_NOT_IMAGE };
  if (isPngSig(file)) return decodePng(file);
  return decodeTga(file);
}

// ---- Import helpers ---------------------------------------------------------------------------

/**
  HeightImageLooksLikeImage: does this file take the image path of Import Heightmap? A PNG by its
  signature; an exact grey TGA header (type 3 or 11, no colour map, 8 bpp, 256 or 1024 square) at
  any length; otherwise any plausible TGA header, unless the length is one of the three .RAW sizes.
  `len` is the whole file's length (the size sniff passes only the first bytes).
*/
export function heightImageLooksLikeImage(file: Uint8Array | null, len = file ? file.length : 0): boolean {
  if (!file || len < 18 || file.length < 18) return false;
  if (isPngSig(file)) return true;
  {
    const w = file[12]! | (file[13]! << 8), h = file[14]! | (file[15]! << 8);
    if ((file[2] === 3 || file[2] === 11) && file[1] === 0 && file[16] === 8 && (w === 256 || w === 1024) && w === h) return true;
  }
  if (len === 65536 || len === 131072 || len === 2097152) return false;
  const type = file[2]!, bpp = file[16]!;
  if (type !== 1 && type !== 2 && type !== 3 && type !== 9 && type !== 10 && type !== 11) return false;
  if (file[1]! > 1) return false;
  if (bpp !== 8 && bpp !== 15 && bpp !== 16 && bpp !== 24 && bpp !== 32) return false;
  if ((file[12]! | (file[13]! << 8)) === 0 || (file[14]! | (file[15]! << 8)) === 0) return false;
  return true;
}

/**
  HeightImageSizeRefusal: the size refusal alone, from a file's first bytes (33 cover a PNG's IHDR,
  18 a TGA's header) and its whole length, so a huge wrong-size image is refused unread. null when
  the size is fine or the bytes are no image (the decoder then gives its own reason).
*/
export function heightImageSizeRefusal(head: Uint8Array | null, fileLength: number): string | null {
  if (!head || head.length < 18 || !heightImageLooksLikeImage(head, fileLength)) return null;
  let w: number, h: number;
  if (isPngSig(head)) {
    if (head.length < 33 || readBE32(head, 8) !== 13 || head[12] !== 0x49 || head[13] !== 0x48 || head[14] !== 0x44 || head[15] !== 0x52) return null;
    w = readBE32(head, 16);
    h = readBE32(head, 20);
  } else {
    w = head[12]! | (head[13]! << 8);
    h = head[14]! | (head[15]! << 8);
  }
  return sizeAllowed(w, h) ? null : whySize(w, h);
}

/** HeightImportPlan: the .RAW length an image enters the import as (8-bit 1024 is stored 16-bit); 0 for none. */
export function heightImportPlan(srcBits: number, size: number): number {
  if (srcBits !== 8 && srcBits !== 16) return 0;
  if (size === 256) return srcBits === 8 ? 65536 : 131072;
  if (size === 1024) return 2097152;
  return 0;
}

/** HeightImageToRaw: the .RAW bytes of decoded heights: 8-bit 256 -> v >> 8; else 16-bit little-endian. */
export function heightImageToRaw(v: Uint16Array | null, srcBits: number, size: number): Uint8Array | null {
  const plan = heightImportPlan(srcBits, size);
  const n = size * size;
  if (!v || plan === 0) return null;
  const out = new Uint8Array(plan);
  if (plan === n) for (let i = 0; i < n; i++) out[i] = v[i]! >> 8;
  else {
    for (let i = 0; i < n; i++) {
      out[2 * i] = v[i]! & 255;
      out[2 * i + 1] = v[i]! >> 8;
    }
  }
  return out;
}

/** HeightExportFormat's results, in the export dialog's filter order (TraxxViewEdit.cpp HEIGHTMAP_EXPORT_*). */
export const HEIGHTMAP_EXPORT_PNG16 = 1;
export const HEIGHTMAP_EXPORT_PNG8 = 2;
export const HEIGHTMAP_EXPORT_RAW = 3;

/**
  HeightExportFormat: the typed extension (with or without the dot, any case) decides: raw -> RAW;
  png -> PNG, 8-bit only when the 8-bit filter was chosen (or the RAW filter on a classic 8-bit
  track). Any other extension follows the 1-based filter index, else the mode's default.
*/
export function heightExportFormat(ext: string | null, filterIndex: number, classic8: boolean): number {
  let e = ext;
  if (e && e[0] === ".") e = e.slice(1);
  if (e && e.toLowerCase() === "raw") return HEIGHTMAP_EXPORT_RAW;
  if (e && e.toLowerCase() === "png") {
    if (filterIndex === 2) return HEIGHTMAP_EXPORT_PNG8;
    if (filterIndex === 3 && classic8) return HEIGHTMAP_EXPORT_PNG8;
    return HEIGHTMAP_EXPORT_PNG16;
  }
  if (filterIndex === 1 || filterIndex === 2 || filterIndex === 3) return filterIndex;
  return classic8 ? HEIGHTMAP_EXPORT_PNG8 : HEIGHTMAP_EXPORT_PNG16;
}

// ---- Encoder ----------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Crc32 (TrackPODHeightImage.cpp): the PNG chunk CRC. */
export function crc32(p: Uint8Array, start = 0, end = p.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ p[i]!) & 255]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** A growable byte buffer, stb's stretchy buffer. */
class Bytes {
  buf = new Uint8Array(1 << 16);
  n = 0;
  push(b: number): void {
    if (this.n === this.buf.length) {
      const g = new Uint8Array(this.buf.length * 2);
      g.set(this.buf);
      this.buf = g;
    }
    this.buf[this.n++] = b & 255;
  }
  pushAll(src: Uint8Array): void {
    for (let i = 0; i < src.length; i++) this.push(src[i]!);
  }
}

const LENGTHC = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 259];
const LENGTHEB = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTC = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 32768];
const DISTEB = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const ZHASH = 16384;

/** stbiw__zlib_bitrev. */
function bitrev(code: number, codebits: number): number {
  let res = 0;
  while (codebits--) {
    res = (res << 1) | (code & 1);
    code >>= 1;
  }
  return res;
}

/** stbiw__zhash: of the three bytes at data[i], in u32 arithmetic. */
function zhash(d: Uint8Array, i: number): number {
  let h = (d[i]! + (d[i + 1]! << 8) + (d[i + 2]! << 16)) >>> 0;
  h = (h ^ (h << 3)) >>> 0;
  h = (h + (h >>> 5)) >>> 0;
  h = (h ^ (h << 4)) >>> 0;
  h = (h + (h >>> 17)) >>> 0;
  h = (h ^ (h << 25)) >>> 0;
  h = (h + (h >>> 6)) >>> 0;
  return h;
}

/**
  stbi_zlib_compress (stb_image_write v1.16), ported line for line: Traxx calls it with quality 8.
  Positions stand in for stb's pointers; a bucket holds at most 2 * quality of them.
*/
export function stbiZlibCompress(data: Uint8Array, quality = 8): Uint8Array {
  const dataLen = data.length;
  if (quality < 5) quality = 5;
  const cap = 2 * quality;
  const table = new Int32Array(ZHASH * cap);
  const counts = new Int32Array(ZHASH);
  const out = new Bytes();
  let bitbuf = 0, bitcount = 0;
  const add = (code: number, codebits: number) => {
    bitbuf = (bitbuf | (code << bitcount)) >>> 0;
    bitcount += codebits;
    while (bitcount >= 8) {
      out.push(bitbuf & 255);
      bitbuf >>>= 8;
      bitcount -= 8;
    }
  };
  const huffa = (b: number, c: number) => add(bitrev(b, c), c);
  const huff = (n: number) => {
    if (n <= 143) huffa(0x30 + n, 8);
    else if (n <= 255) huffa(0x190 + n - 144, 9);
    else if (n <= 279) huffa(n - 256, 7);
    else huffa(0xc0 + n - 280, 8);
  };
  const huffb = (n: number) => (n <= 143 ? huffa(0x30 + n, 8) : huffa(0x190 + n - 144, 9));
  const countm = (a: number, b: number, limit: number) => {
    let i = 0;
    for (; i < limit && i < 258; ++i) if (data[a + i] !== data[b + i]) break;
    return i;
  };

  out.push(0x78); // DEFLATE 32K window
  out.push(0x5e); // FLEVEL = 1
  add(1, 1); // BFINAL = 1
  add(1, 2); // BTYPE = 1, fixed Huffman

  let i = 0;
  while (i < dataLen - 3) {
    let h = zhash(data, i) & (ZHASH - 1), best = 3;
    let bestloc = -1;
    let n = counts[h]!, base = h * cap;
    for (let j = 0; j < n; ++j) {
      const pos = table[base + j]!;
      if (pos > i - 32768) {
        const d = countm(pos, i, dataLen - i);
        if (d >= best) { best = d; bestloc = pos; }
      }
    }
    // When the bucket is full, the older half goes.
    if (counts[h] === 2 * quality) {
      table.copyWithin(base, base + quality, base + 2 * quality);
      counts[h] = quality;
    }
    table[base + counts[h]!] = i;
    counts[h]!++;

    if (bestloc >= 0) {
      // Lazy matching: a better match at the next byte makes this byte a literal.
      h = zhash(data, i + 1) & (ZHASH - 1);
      n = counts[h]!;
      base = h * cap;
      for (let j = 0; j < n; ++j) {
        const pos = table[base + j]!;
        if (pos > i - 32767) {
          const e = countm(pos, i + 1, dataLen - i - 1);
          if (e > best) { bestloc = -1; break; }
        }
      }
    }

    if (bestloc >= 0) {
      const d = i - bestloc;
      let j = 0;
      for (j = 0; best > LENGTHC[j + 1]! - 1; ++j);
      huff(j + 257);
      if (LENGTHEB[j]) add(best - LENGTHC[j]!, LENGTHEB[j]!);
      for (j = 0; d > DISTC[j + 1]! - 1; ++j);
      add(bitrev(j, 5), 5);
      if (DISTEB[j]) add(d - DISTC[j]!, DISTEB[j]!);
      i += best;
    } else {
      huffb(data[i]!);
      ++i;
    }
  }
  for (; i < dataLen; ++i) huffb(data[i]!);
  huff(256); // end of block
  while (bitcount) add(0, 1);

  // Stored instead when compression came out worse.
  if (out.n > dataLen + 2 + Math.trunc((dataLen + 32766) / 32767) * 5) {
    out.n = 2;
    for (let j = 0; j < dataLen;) {
      let blocklen = dataLen - j;
      if (blocklen > 32767) blocklen = 32767;
      out.push(dataLen - j === blocklen ? 1 : 0);
      out.push(blocklen);
      out.push(blocklen >> 8);
      out.push(~blocklen);
      out.push(~blocklen >> 8);
      out.pushAll(data.subarray(j, j + blocklen));
      j += blocklen;
    }
  }

  // Adler-32 of the input.
  let s1 = 1, s2 = 0;
  let blocklen = dataLen % 5552;
  for (let j = 0; j < dataLen;) {
    for (let k = 0; k < blocklen; ++k) { s1 += data[j + k]!; s2 += s1; }
    s1 %= 65521;
    s2 %= 65521;
    j += blocklen;
    blocklen = 5552;
  }
  out.push(s2 >> 8);
  out.push(s2);
  out.push(s1 >> 8);
  out.push(s1);
  return out.buf.slice(0, out.n);
}

/** Paeth (TrackPODHeightImage.cpp). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = p > a ? p - a : a - p;
  const pb = p > b ? p - b : b - p;
  const pc = p > c ? p - c : c - p;
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function writeBE32(d: Uint8Array, o: number, v: number): void {
  d[o] = (v >>> 24) & 255; d[o + 1] = (v >>> 16) & 255; d[o + 2] = (v >>> 8) & 255; d[o + 3] = v & 255;
}

/**
  HeightPngEncode: a size x size grayscale PNG of v, at 8 bits (v >> 8 rounded half up, clamped
  255) or 16. null for a bad size or depth, as Traxx refuses them.
*/
export function heightPngEncode(v: Uint16Array | null, size: number, bits: number): Uint8Array | null {
  if (!v || size < 1 || size > 8192 || (bits !== 8 && bits !== 16) || v.length < size * size) return null;
  const bpp = bits / 8;
  const rowbytes = size * bpp;
  const filtered = new Uint8Array(size * (rowbytes + 1));
  let cur = new Uint8Array(rowbytes);
  let prev = new Uint8Array(rowbytes);
  // Paeth (filter type 4) on every row; 16-bit samples big-endian.
  for (let z = 0; z < size; z++) {
    const src = z * size;
    const dst = z * (rowbytes + 1);
    for (let x = 0; x < size; x++) {
      const s = v[src + x]!;
      if (bits === 16) {
        cur[x * 2] = s >> 8;
        cur[x * 2 + 1] = s & 255;
      } else {
        const q = (s + 128) >> 8;
        cur[x] = q > 255 ? 255 : q;
      }
    }
    filtered[dst] = 4;
    for (let i = 0; i < rowbytes; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      filtered[dst + 1 + i] = (cur[i]! - paeth(a, b, c)) & 255;
    }
    const t = prev; prev = cur; cur = t;
  }
  const zdata = stbiZlibCompress(filtered, 8);
  const file = new Uint8Array(8 + 25 + 12 + zdata.length + 12);
  file.set(PNG_SIG, 0);
  let d = 8;
  const chunk = (type: string, data: Uint8Array) => {
    writeBE32(file, d, data.length);
    for (let k = 0; k < 4; k++) file[d + 4 + k] = type.charCodeAt(k);
    file.set(data, d + 8);
    writeBE32(file, d + 8 + data.length, crc32(file, d + 4, d + 8 + data.length));
    d += 12 + data.length;
  };
  const ihdr = new Uint8Array(13);
  writeBE32(ihdr, 0, size);
  writeBE32(ihdr, 4, size);
  ihdr[8] = bits; // grey, deflate, adaptive filtering, no interlace: the rest stay 0
  chunk("IHDR", ihdr);
  chunk("IDAT", zdata);
  chunk("IEND", new Uint8Array(0));
  return file;
}
