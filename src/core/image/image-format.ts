/*
  Image format sniffing and the TGA decoder, for HD art (PNG, TGA). Ported from OpenMTM2
  worker/image-decoder.js (itself from JSPod). TGA has no browser decoder, so it is decoded
  here; PNG goes through the browser (render/hd-decode.ts, worker/image-decode.ts).
*/
import type { RgbaImage } from "../view/tiles.ts";

const SIGNATURES: { name: string; bytes: number[] }[] = [
  { name: "PNG", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: "JPEG", bytes: [0xff, 0xd8, 0xff] },
  { name: "GIF", bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: "BMP", bytes: [0x42, 0x4d] },
  { name: "DDS", bytes: [0x44, 0x44, 0x53, 0x20] },
  { name: "PSD", bytes: [0x38, 0x42, 0x50, 0x53] },
];

/** The format a file is, by signature. TGA has none, so it is never claimed here. */
export function detectImageFormat(bytes: Uint8Array): string | null {
  for (const sig of SIGNATURES) {
    if (bytes.length < sig.bytes.length) continue;
    if (sig.bytes.every((b, i) => bytes[i] === b)) return sig.name;
  }
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "WEBP";
  return null;
}

/**
  The format check of HDTexIdentify: a .PNG must be a PNG, a .TGA must not be anything
  recognisable. Returns a refusal, or null.
*/
export function imageFormatRefusal(bytes: Uint8Array, name: string, ext: "PNG" | "TGA"): string | null {
  const actual = detectImageFormat(bytes);
  if (ext === "TGA") return actual ? `"${name}" is named .TGA but the content is ${actual}.` : null;
  if (actual === null) return `"${name}" is not a recognised image.`;
  if (actual !== "PNG") return `"${name}" is named .PNG but the content is ${actual}.`;
  return null;
}

/** Uncompressed (type 2) and RLE (type 10) true-colour TGA, 24 or 32 bit, returned top-down. */
export function decodeTga(bytes: Uint8Array, name = "texture.tga"): RgbaImage {
  if (bytes.length < 18) throw new Error(`${name}: TGA header is truncated`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idLength = bytes[0]!;
  const colorMapType = bytes[1]!;
  const imageType = bytes[2]!;
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const bitsPerPixel = bytes[16]!;
  const descriptor = bytes[17]!;
  if (colorMapType !== 0 || (imageType !== 2 && imageType !== 10)) throw new Error(`${name}: expected uncompressed or RLE true-colour TGA`);
  if (!width || !height || (bitsPerPixel !== 24 && bitsPerPixel !== 32)) throw new Error(`${name}: expected 24- or 32-bit TGA pixels`);

  const bpp = bitsPerPixel / 8;
  let offset = 18 + idLength;
  const count = width * height;
  const out = new Uint8ClampedArray(count * 4);
  let pixel = 0;
  const px = [0, 0, 0, 255];
  const read = () => {
    if (offset + bpp > bytes.length) throw new Error(`${name}: TGA pixel data is truncated`);
    px[2] = bytes[offset++]!;
    px[1] = bytes[offset++]!;
    px[0] = bytes[offset++]!;
    px[3] = bpp === 4 ? bytes[offset++]! : 255;
  };
  const write = () => {
    if (pixel >= count) throw new Error(`${name}: TGA has more pixels than its header says`);
    out.set(px, pixel * 4);
    pixel++;
  };
  if (imageType === 2) {
    while (pixel < count) { read(); write(); }
  } else {
    while (pixel < count) {
      if (offset >= bytes.length) throw new Error(`${name}: TGA RLE packet is truncated`);
      const packet = bytes[offset++]!;
      const n = (packet & 0x7f) + 1;
      if (packet & 0x80) {
        read();
        for (let i = 0; i < n; i++) write();
      } else {
        for (let i = 0; i < n; i++) { read(); write(); }
      }
    }
  }
  // Descriptor bit 5 puts the origin at the top, bit 4 at the right.
  const top = (descriptor & 0x20) !== 0;
  const right = (descriptor & 0x10) !== 0;
  if (top && !right) return { width, height, rgba: out };
  const flipped = new Uint8ClampedArray(out.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tx = right ? width - 1 - x : x;
      const ty = top ? y : height - 1 - y;
      const s = (y * width + x) * 4;
      flipped.set(out.subarray(s, s + 4), (ty * width + tx) * 4);
    }
  }
  return { width, height, rgba: flipped };
}

/** RGBA to packed RGB, alpha dropped (stb's 3-component load, as Traxx decodes HD art). */
export function rgbaToRgb(img: RgbaImage): Uint8Array {
  const n = img.width * img.height;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = img.rgba[i * 4]!;
    out[i * 3 + 1] = img.rgba[i * 4 + 1]!;
    out[i * 3 + 2] = img.rgba[i * 4 + 2]!;
  }
  return out;
}
