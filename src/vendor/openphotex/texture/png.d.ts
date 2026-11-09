/** PNG image samples, channel-interleaved, row-major, at the stored bit depth. */
export interface PngSamples {
    width: number;
    height: number;
    bitDepth: 8 | 16;
    /** 0 grey, 2 RGB, 4 grey + alpha, 6 RGBA. */
    colorType: 0 | 2 | 4 | 6;
    channels: number;
    samples: Uint16Array;
}
export declare function isPng(bytes: Uint8Array): boolean;
/** Decode a PNG's samples. Throws RangeError on palette, sub-byte depths, interlace or damage. */
export declare function decodePngSamples(bytes: Uint8Array): PngSamples;
