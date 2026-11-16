export declare const VEG_MAGIC = "MVEG";
export declare const VEG_SPEC_STRIDE = 192;
export declare const VEG_TREE_STRIDE = 20;
export declare const VEG_CLUMP_STRIDE = 12;
/** Position units per foot (TREE x/y/z and clump y). */
export declare const VEG_UNITS_PER_FT = 256;
export declare const VEG_KIND_PLACED = 0;
export declare const VEG_KIND_GROUND = 1;
export declare const VEG_FLAG_CAST_SHADOW = 1;
export declare const VEG_FLAG_FAR_SHADOW = 2;
export declare const VEG_FLAG_CROSSFADE = 4;
export declare const VEG_FLAG_FACING = 8;
export declare const VEG_COLLIDE: readonly ["none", "trunk", "model"];
export interface VegSpecies {
    model: string;
    farModel: string;
    kind: number;
    collide: number;
    flags: number;
    /** 1/64 ft. */
    trunkDiameter: number;
    /** 1/16 ft. */
    trunkHeight: number;
    /** Model fade band in ft, [near, far]; 0 = the engine's 900 / 1000 (OpenMTM2 docs/CP4_EXE_ANALYSIS.md 3). */
    modelFade?: [number, number];
    /** Far-card band in ft, [near, far]; 0 = 900 / 1000. */
    cardBand?: [number, number];
    /** Grass draw distance in ft; 0 = vegGrassDist (1000). */
    grassDistance?: number;
    /** The species' own name, or "". */
    name?: string;
}
/** Trees are kept as one interleaved Int32Array per field for size: 30,000 at most. */
export interface VegTrees {
    count: number;
    /** x, y, z in 1/256 ft, three per tree. */
    position: Int32Array;
    species: Uint16Array;
    /** 1/65536 turn. */
    heading: Uint16Array;
    /** x 4096. */
    scale: Uint16Array;
    tint: Uint8Array;
    tier: Uint8Array;
}
export interface VegGrassTile {
    tx: number;
    tz: number;
    first: number;
    count: number;
}
export interface VegClumps {
    count: number;
    tiles: VegGrassTile[];
    species: Uint16Array;
    /** 1/8 ft inside the tile, two per clump (fx, fz). */
    offset: Uint8Array;
    /** 1/256 ft. */
    y: Int32Array;
    /** 1/256 turn. */
    heading: Uint8Array;
    /** 0.25 + s / 64. */
    scale: Uint8Array;
    tint: Uint8Array;
}
export interface Veg {
    major: number;
    minor: number;
    species: VegSpecies[];
    trees: VegTrees;
    clumps: VegClumps;
    /** The RULE text, or null (a foreign file). */
    rule: string | null;
    info: Record<string, string>;
}
export declare function isMtm2Veg(bytes: Uint8Array): boolean;
export declare function parseMtm2Veg(bytes: Uint8Array): Veg;
/** A tree's world feet and scale, for drawing. */
export declare function vegTreeAt(trees: VegTrees, i: number): {
    x: number;
    y: number;
    z: number;
    headingTurns: number;
    scale: number;
};
/** A clump's world feet and scale, for drawing (tiles are 32 ft). */
export declare function vegClumpAt(clumps: VegClumps, tile: VegGrassTile, i: number): {
    x: number;
    y: number;
    z: number;
    headingTurns: number;
    scale: number;
};
/**
 * Write a .VEG in Traxx 1.7's layout. Trees are written sorted by 32 ft tile (z, then x, stable),
 * as Traxx does; clumps must already be grouped by tile in ascending (tz, tx) order.
 * `rule` and `info` are written verbatim when given (CRLF text).
 */
export declare function writeMtm2Veg(veg: {
    species: readonly VegSpecies[];
    trees: VegTrees;
    clumps: VegClumps;
    rule?: string | null;
    info?: string | null;
}, { cells }?: {
    cells?: number;
}): Uint8Array;
/**
 * Refuse a .VEG whose placements fall outside an N-cell world (track format version 6, section
 * 9.2): TREE x and z in 0 to W * 256 (exclusive) 1/256 ft units, W = 32 N ft, and GRAS tile numbers
 * 0 to N - 1. With N = 256 that is CP4's own bound (x and z below 0x200000). The layout does not
 * change with N; the header's tile counts stay 256 as Traxx writes them.
 */
export declare function checkMtm2VegBounds(veg: {
    trees: VegTrees;
    clumps: VegClumps;
}, cells: number): void;
