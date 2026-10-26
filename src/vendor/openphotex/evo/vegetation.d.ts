import { type EvoTree } from "./veg.ts";
export declare const EVO_RTD_SIZE = 1024;
export declare const EVO_RTD_BYTES: number;
export declare const EVO_RTD_CELL_FT = 8;
/** The terrain's vertex light in shade (0x664684). */
export declare const EVO_SHADE_LIGHT = 0.35;
export declare const EVO_SDW_NONE = 32768;
export declare const EVO_SDW_KEEP = 16384;
/** The shade map of a .RTD, or null when it is not 131,072 bytes. */
export declare function parseEvoRtd(bytes: Uint8Array): Uint8Array | null;
/** Whether (x, z), in feet, is in shade; the map repeats with the world. */
export declare function evoShadeAt(rtd: Uint8Array, x: number, z: number): boolean;
/** The shadow words of a .SDW, or null when it is not 256 x 256 words. */
export declare function parseEvoSdw(bytes: Uint8Array): Uint16Array | null;
/** The C library's rand() of the Watcom runtime (0x60fa5c): next = next * 1103515245 + 12345. */
export declare function evoRand(seed: number): () => number;
/** The seed the game gives rand() before drawing the grass table (0x469b20). */
export declare const EVO_GRASS_SEED = 873;
export declare const EVO_GRASS_TUFTS = 2048;
export interface EvoGrassPattern {
    /** Per tuft: offset in the cell (ft), half-size (ft) and slot (0..3, the grassTexture quadrant). */
    x: Float32Array;
    z: Float32Array;
    size: Float32Array;
    slot: Uint8Array;
}
/**
 * The 2,048-tuft table. Offsets are the game's (rand() seeded with 873); slots and sizes are
 * redrawn from `vegSizes` (the .VEG `vegMinSize,vegMaxSize`) with `seed`, as the game redraws them
 * unseeded. Without sizes they stay the first pass's, uniform [2, 4].
 */
export declare function evoGrassPattern(vegSizes?: readonly {
    min: number;
    max: number;
}[], seed?: number): EvoGrassPattern;
/** Tufts a cell of vegetation class `vegClass` draws (0x470f40). */
export declare function evoGrassCount(vegClass: number, highDetail?: boolean): number;
/** The pattern index of tuft `t` of the cell at (cx, cz), cells of 32 ft. */
export declare function evoGrassIndex(t: number, cx: number, cz: number): number;
export interface EvoTreeFieldInput {
    /** Ground height at a world point, ft. */
    heightAt(x: number, z: number): number;
    /** The vegetation class (0..3) of the terrain cell under a point. */
    vegClassAt(x: number, z: number): number;
    /** Whether a point lies inside a level object's box (the game widens each by 20 ft). */
    blocked?(x: number, z: number): boolean;
    waterLevelFt: number | null;
    /** The .VEG values (or the game's defaults when a level has none). */
    maxTrees: number;
    treeLine: number;
    minDistanceSquared: {
        sparse: number;
        medium: number;
        dense: number;
    };
    /** treeBiasY per slot. */
    biasY: readonly number[];
}
/** Trees generated for a level without a .VEG, in sector order like a .VEG's (0x467be0). */
export declare function evoGenerateTrees(input: EvoTreeFieldInput, seed: number): EvoTree[];
