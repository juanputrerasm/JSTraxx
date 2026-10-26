/**
 * One .TEX record. `surfaceValue` is the texture's surface (`type * 100 + depth`, the MTM2
 * encoding) and `vegClass` its vegetation density (0 none, 1 sparse, 2 medium, 3 dense), as
 * 4x4 Evolution 2 reads them (OpenMTM2 docs/EVO2_EXE_ANALYSIS.md 4.1). `param0` and `param1`
 * are the same two numbers under their old names, kept for existing consumers.
 */
export interface EvoTexRecord {
    surfaceValue: number;
    vegClass: number;
    param0: number;
    param1: number;
    name: string;
}
/** Vegetation density classes of a .TEX record (the game's names, `0x673038`). */
export declare const EVO_VEG_CLASS: Readonly<{
    NONE: 0;
    SPARSE: 1;
    MEDIUM: 2;
    DENSE: 3;
}>;
/** A parsed Evo .TEX terrain and shadow texture table. */
export interface EvoTex {
    version: number;
    sourceName: string;
    ordinaryCount: number;
    shadowCount: number;
    /** Slots the .CLR grid indexes. */
    ordinary: EvoTexRecord[];
    /** Slots the .SDW grid references, by an index still offset by ordinaryCount. */
    shadow: EvoTexRecord[];
    warnings: string[];
}
export declare function parseEvoTex(bytes: Uint8Array, sourceName: string): EvoTex;
