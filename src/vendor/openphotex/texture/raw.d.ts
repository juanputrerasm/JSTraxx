/**
 * Which games' size rules apply.
 *
 * - `classic`: Monster Truck Madness 1 and 2, CART Precision Racing, Terminal Velocity, Fury3,
 *   Hellbender. Square power-of-two sides from 32 to 1024.
 * - `evo`: 4x4 Evolution 1 and 2. Square power-of-two sides from 8 to 2048.
 */
export type RawTextureFamily = "classic" | "evo";
/** A decoded texture: `width * height` RGBA texels, row by row. */
export interface RgbaImage {
    width: number;
    height: number;
    rgba: Uint8ClampedArray;
    /** Whether any texel may be less than fully opaque. */
    hasAlpha: boolean;
}
export interface DecodeRawTextureOptions {
    /** Size rules to apply. Defaults to `classic`. */
    family?: RawTextureFamily;
    /**
     * Classic colour-key transparency: make every texel whose palette colour is pure black fully
     * transparent (and keep it black). For glass, trees, fences and grilles only; see below.
     */
    cutout?: boolean;
}
/**
 * Side length of a square 8-bit .RAW texture with this many bytes, or 0 if the byte count is
 * not one the family's games accept.
 */
export declare function rawTextureSide(byteLength: number, family?: RawTextureFamily): number;
/**
 * Decode an indexed .RAW through an 8-bit RGB palette (as `decodeActPalette` returns).
 *
 * @throws RangeError when the byte count is not a texture size for the family, or the palette
 *   is shorter than 768 bytes.
 */
export declare function decodeRawTexture(raw: Uint8Array, palette: Uint8Array, options?: DecodeRawTextureOptions): RgbaImage;
/**
 * Map palette indices to RGBA at any size, for 8-bit images that are not textures (screens,
 * heightfields viewed as images, or a size a user picks). Texels beyond the end of `indices`
 * are left fully transparent black; indices beyond `width * height` are ignored.
 *
 * @throws RangeError for a non-positive size or a palette shorter than 768 bytes.
 */
export declare function decodeIndexedImage(indices: Uint8Array, palette: Uint8Array, width: number, height: number, options?: {
    cutout?: boolean;
}): RgbaImage;
/**
 * Put an .OPA opacity plane into an image's alpha channel, in place. Returns the image with
 * `hasAlpha` set, or the image untouched when the plane is missing or the wrong size.
 */
export declare function applyOpacityPlane<T extends RgbaImage>(image: T, opacity: Uint8Array | null | undefined): T;
