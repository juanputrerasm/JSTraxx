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
