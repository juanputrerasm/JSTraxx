import type { ColourHistogram } from "../texture/encode.ts";
export declare const MTM2_PALETTE_WHITE_INDEX = 229;
/** The first index a level authors. */
export declare const MTM2_PALETTE_FIRST_AUTHORED = 10;
/** How many it authors: 10..228. */
export declare const MTM2_PALETTE_AUTHORED_COUNT: number;
/**
 * An MTM2 level palette: the system bands, the authored band median-cut from `histogram` (see
 * sampleForPalette), and white at 229. Without a histogram the authored band is a colour cube.
 */
export declare function mtm2LevelPalette(histogram?: ColourHistogram | null): Uint8Array;
export declare function buildFogMap(palette: Uint8Array): Uint8Array;
