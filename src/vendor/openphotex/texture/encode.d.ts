/** An exact-colour histogram: 0xRRGGBB to texel count. */
export type ColourHistogram = Map<number, number>;
export declare function sampleForPalette(histogram: ColourHistogram, rgba: Uint8Array, budget?: number): ColourHistogram;
export declare function medianCutPalette(histogram: ColourHistogram, count: number): [number, number, number][];
/** The 6x6x6 colour cube and a 4-step grey ramp: the palette for art with no colours to fit. */
export declare function colourCube(): [number, number, number][];
export declare function encodeRawTexture(rgba: Uint8Array, width: number, height: number): {
    raw: Uint8Array;
    act: Uint8Array;
};
