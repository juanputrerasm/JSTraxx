import type { RgbaImage } from "./raw.ts";
/** True when the bytes begin with a TIFF header this decoder should be given. */
export declare function isTiff(bytes: Uint8Array | null | undefined): boolean;
/** A decoded TIFF: palette images are diffuse art; RGB ones are Evo 2's "_BUMP" normal maps. */
export interface TiffImage extends RgbaImage {
    kind: "palette" | "rgb";
}
/**
 * Decode one of the TIFF forms 4x4 Evolution 2 ships.
 *
 * @throws Error naming the reason for any other form.
 */
export declare function decodeTiff(bytes: Uint8Array, textureName: string): TiffImage;
