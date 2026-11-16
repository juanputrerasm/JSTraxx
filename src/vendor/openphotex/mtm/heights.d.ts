export type Mtm2TerrainMode = "classic8" | "classic16" | "spline" | "fine";
/** 16-bit height units per foot. */
export declare const MTM2_H16_PER_FT = 128;
export declare const MTM2_RAW_LENGTH_8BIT = 65536;
export declare const MTM2_RAW_LENGTH_16BIT = 131072;
export declare const MTM2_RAW_LENGTH_FINE = 2097152;
/** Fine-grid spacing in feet (the coarse grid is 32 ft). */
export declare const MTM2_FINE_CELL_FT = 8;
/** The decoded heights of an MTM2 track, in 1/128 ft units. */
export interface Mtm2Heights {
    mode: Mtm2TerrainMode;
    /** 256 x 256 corner heights (for fine: every fourth fine point). */
    coarse: Uint16Array;
    /** 1024 x 1024 at 8 ft for spline (expanded) and fine; null for the 32 ft modes. */
    fine: Uint16Array | null;
    /** Set when the .TXV key and the file disagree, as Traxx reports it. */
    warning: string | null;
}
/** The .TXV `terrainGrid` value as a mode, null when absent, "unknown" for a value no tool knows. */
export declare function parseTerrainGridKey(value: string | null | undefined): "classic" | "spline" | "fine" | "unknown" | null;
/** The terrain mode for a height file of `length` bytes and a .TXV `terrainGrid` value. */
export declare function resolveMtm2TerrainMode(length: number, terrainGrid?: string | null): {
    mode: Mtm2TerrainMode;
    warning: string | null;
};
/** Decode DATA\<stem>.RAW of an MTM2 track. */
export declare function decodeMtm2Heights(bytes: Uint8Array, terrainGrid?: string | null): Mtm2Heights;
/**
 * Decode a CP4 height PNG (.TXV terrainHeights): grey or grey + alpha (alpha ignored), 8 or 16
 * bits, 256 or 1024 square. 8-bit samples mean b << 8 (2 ft steps). A 1024-square image is a Full
 * Map; a 256-square one is classic16, or spline when terrainGrid says so.
 */
export declare function decodeMtm2HeightPng(bytes: Uint8Array, terrainGrid?: string | null): Mtm2Heights & {
    bitDepth: 8 | 16;
};
/**
 * Heights in feet as the CP4 engine holds them: it stores every 16-bit sample as v >> 1 in signed 16 bits, 1/64 ft a
 * step (CP4 monster.exe 2.0.52.2, OpenMTM2 docs/CP4_EXE_ANALYSIS.md 1), dropping the file's lowest bit. Spline
 * expansion runs on v first and the shift comes after, so pass the expanded grid. This is what a game should drive on.
 */
export declare function mtm2EngineHeightsFt(v: Uint16Array): Float32Array;
/** Heights in feet (v / 128) of a 1/128 ft grid, at the file's full precision (an editor's view). */
export declare function mtm2HeightsToFeet(v: Uint16Array): Float32Array;
/** The version 6 heights of a track, in sample units (apply step and base with mtm2V6HeightsH128 or mtm2V6HeightsFt). */
export interface Mtm2V6Heights {
    mode: "classic" | "spline" | "fine";
    /** N, cells a side. */
    cells: number;
    /** N x N corner samples (for fine: every fourth fine sample). */
    coarse: Uint16Array;
    /** 4N x 4N at 8 ft for spline (expanded) and fine; null for classic. */
    fine: Uint16Array | null;
    step: number;
    base: number;
    /** 8 for an 8-bit PNG (samples are b << 8), else 16. */
    bitDepth: 8 | 16;
    warning: string | null;
}
/**
 * Decode a version 6 terrainHeightMap entry. `name` (the key's value) says PNG or RAW by its
 * extension; `cells` is worldCells; `step` and `base` the .TXV's (they are carried, not applied).
 * A file of the wrong size, depth or colour type is refused with a RangeError.
 */
export declare function decodeMtm2V6Heights(bytes: Uint8Array, opts: {
    name: string;
    cells: number;
    step?: number;
    base?: number;
    terrainGrid?: string | null;
}): Mtm2V6Heights;
/** Samples to the recommended engine store (section 7.3): h128 = (sample << (7 - log2 step)) + base * 128, in 1/128 ft. */
export declare function mtm2V6HeightsH128(samples: Uint16Array, step: number, base: number): Int32Array;
/** Samples to feet, base + sample / step. Exact in a Float32 (the 1/128 ft store fits its 24-bit mantissa). */
export declare function mtm2V6HeightsFt(samples: Uint16Array, step: number, base: number): Float32Array;
/**
 * The step and base a writer picks for heights spanning lowFt..highFt (section 11): base the
 * floor of the lowest point, step the largest power of two up to 128 with (high - base) * step at
 * most 65535. A span over 65535 ft cannot be stored and throws.
 */
export declare function mtm2V6StepAndBase(lowFt: number, highFt: number): {
    step: number;
    base: number;
};
/** Feet to samples for a step and base: round(( ft - base) * step), refused outside 0..65535. */
export declare function mtm2V6SamplesFromFt(feet: ArrayLike<number>, step: number, base: number): Uint16Array;
/** A u16 RAW height file (little-endian samples, row by row): the .RAW form of terrainHeightMap. */
export declare function encodeMtm2HeightRaw16(samples: ArrayLike<number>): Uint8Array;
