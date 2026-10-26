/*
  HD art (PNG, TGA) to RGBA, in a worker or on the page. PNG goes through the browser's
  decoder with no colour conversion and no premultiplication, so texel values come through
  as stored; TGA has no browser decoder and uses core/image/image-format.ts.
*/
import { decodeTga, imageFormatRefusal } from "../core/image/image-format.ts";
import type { RgbaImage } from "../core/view/tiles.ts";

export type HdExt = "PNG" | "TGA";

/** Decode, or throw with a sentence that says why. */
export async function decodeImage(bytes: Uint8Array, ext: HdExt, name = `texture.${ext.toLowerCase()}`): Promise<RgbaImage> {
  const refusal = imageFormatRefusal(bytes, name, ext);
  if (refusal) throw new Error(refusal);
  if (ext === "TGA") return decodeTga(bytes, name);
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") throw new Error(`"${name}" cannot be decoded here: no image decoder.`);
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) throw new Error(`"${name}" cannot be decoded here: no 2D canvas.`);
    g.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, rgba: g.getImageData(0, 0, bitmap.width, bitmap.height).data };
  } finally {
    bitmap.close();
  }
}

/** The same, null on any failure. */
export async function tryDecodeImage(bytes: Uint8Array, ext: HdExt, name?: string): Promise<RgbaImage | null> {
  try { return await decodeImage(bytes, ext, name); } catch { return null; }
}
