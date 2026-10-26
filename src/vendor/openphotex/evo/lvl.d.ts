/** A parsed Evo .LVL: the terrain manifest and environment record. */
export interface EvoLvl {
    version: number;
    sourceName: string;
    /** The 16-bit height grid (.RAW). */
    heightName: string;
    /** The 16-bit terrain tile-index grid (.CLR). */
    clrName: string;
    /** The terrain and shadow texture table (.TEX). */
    texName: string;
    skyName: string;
    ambientWav: string;
    water: {
        height: number;
        tideHeight: number;
        tidePeriod: number;
        color: number[];
    };
    detailTexture: string | null;
    lightVector: number[] | null;
    vegTexture: string | null;
    /** Lines after the head that match no known label, kept verbatim. */
    trailing: string[];
}
/** A parsed Evo 2 .WAT animated-water material. */
export interface EvoWat {
    sourceName: string;
    version: number;
    baseName: string | null;
    cycleSpeed: [number, number];
    scale: [number, number];
    specularAlpha: number;
}
export declare function parseEvoLvl(bytes: Uint8Array, sourceName: string): EvoLvl;
export declare function parseEvoWat(bytes: Uint8Array, sourceName: string): EvoWat;
