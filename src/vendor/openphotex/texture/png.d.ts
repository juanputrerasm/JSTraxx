/** PNG image samples, channel-interleaved, row-major, at the stored bit depth. */
export interface PngSamples {
    width: number;
    height: number;
    /** 1, 2 and 4 occur only in palette images. */
    bitDepth: 1 | 2 | 4 | 8 | 16;
    /** 0 grey, 2 RGB, 3 palette, 4 grey + alpha, 6 RGBA. */
    colorType: 0 | 2 | 3 | 4 | 6;
    /** Samples per pixel: 1 for a palette image (the index). */
    channels: number;
    samples: Uint16Array;
    /** A palette image's PLTE: RGB triplets, one per entry (up to 256). Null for the other types. */
    palette: Uint8Array | null;
    /** A palette image's tRNS: the alpha of the first entries (the rest are opaque). Null without tRNS. */
    paletteAlpha: Uint8Array | null;
    /** Grey or RGB tRNS: the one sample value (grey) or triplet (RGB) that is transparent. Null without it. */
    transparentKey: number[] | null;
}
export declare function isPng(bytes: Uint8Array): boolean;
/** Decode a PNG's samples. Throws RangeError on sub-byte grey, interlace or damage. */
export declare function decodePngSamples(bytes: Uint8Array): PngSamples;
