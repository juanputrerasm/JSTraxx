/*
  HD art (PNG, TGA) decoded to RGBA for display.
*/
import type { RgbaImage } from "../core/view/tiles.ts";
import { tryDecodeImage } from "../shared/image-decode.ts";

export async function decodeHd(hd: { ext: "PNG" | "TGA"; data: Uint8Array }): Promise<RgbaImage | null> {
  return tryDecodeImage(hd.data, hd.ext);
}
