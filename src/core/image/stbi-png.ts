/*
  A PNG's samples (OpenPhotex's decodePngSamples) as stb_image hands them to Traxx:
  stbi_load_from_memory(..., req_comp) with req_comp 3 (VegDecodeMask, a vegetation mask) or 4
  (HDTexDecodeRGBA, a far card's texture).

    grey          replicated to R, G and B
    palette       expanded through PLTE (stbi__expand_png_palette); its tRNS gives the alpha
    16-bit        the high byte (stbi__convert_16_to_8)
    1, 2, 4-bit   grey scaled to 8 bits by stbi__depth_scale_table (x 255, x 85, x 17)
    tRNS key      a grey or RGB pixel equal to the key gets alpha 0 (stbi__compute_transparency)
    no alpha      255

  An index past the end of PLTE reads as black, opaque (stb reads its uninitialised table there).
*/
import type { PngSamples } from "../../vendor/openphotex/texture/png.js";

/** The image as 8-bit RGBA, straight alpha, row 0 = the top. */
export function stbiPngRgba(s: PngSamples): Uint8Array {
  const n = s.width * s.height, ch = s.channels;
  const out = new Uint8Array(n * 4);
  if (s.colorType === 3) {
    const pal = s.palette ?? new Uint8Array(0), alpha = s.paletteAlpha;
    for (let i = 0; i < n; i++) {
      const k = s.samples[i]!;
      out[i * 4] = pal[k * 3] ?? 0;
      out[i * 4 + 1] = pal[k * 3 + 1] ?? 0;
      out[i * 4 + 2] = pal[k * 3 + 2] ?? 0;
      out[i * 4 + 3] = alpha && k < alpha.length ? alpha[k]! : 255;
    }
    return out;
  }
  const shift = s.bitDepth === 16 ? 8 : 0;
  // Sub-byte grey: stb scales the samples (and the tRNS key alike, so the key compares unscaled here).
  const scale = s.bitDepth === 1 ? 0xff : s.bitDepth === 2 ? 0x55 : s.bitDepth === 4 ? 0x11 : 1;
  const key = s.transparentKey;
  for (let i = 0; i < n; i++) {
    const p = i * ch;
    let r: number, g: number, b: number, a = 255;
    if (ch >= 3) {
      r = s.samples[p]!; g = s.samples[p + 1]!; b = s.samples[p + 2]!;
      if (ch === 4) a = s.samples[p + 3]! >> shift;
      else if (key && key.length === 3 && r === key[0] && g === key[1] && b === key[2]) a = 0;
    } else {
      r = g = b = s.samples[p]!;
      if (ch === 2) a = s.samples[p + 1]! >> shift;
      else if (key && key.length === 1 && r === key[0]) a = 0;
    }
    out[i * 4] = (r >> shift) * scale;
    out[i * 4 + 1] = (g >> shift) * scale;
    out[i * 4 + 2] = (b >> shift) * scale;
    out[i * 4 + 3] = a;
  }
  return out;
}
