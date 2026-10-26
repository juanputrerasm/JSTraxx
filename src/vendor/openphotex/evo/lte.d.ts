export declare const EVO_LITE_GRID = 256;
/** The terrain block at the end of a decoded Lite track: hMin, hMax, heights, tile low bytes, tile high bytes. */
export declare const EVO_LITE_TERRAIN_BYTES: number;
/** The largest Lite track the game lists, bytes. */
export declare const EVO_LITE_MAX_FILE = 100352;
/** The most bytes `decodeEvoLzw` writes before it gives up on a stream. */
export declare const EVO_LZW_MAX_OUTPUT: number;
/** The dictionary's size: the add that finds it full empties it. */
export declare const EVO_LZW_ENTRIES = 32768;
export interface EvoLite {
    version: number;
    /** The stock world it borrows from, as written (`ZONA`). */
    baseWorld: string;
    /** The Evo 1 .SIT text, as bytes for `parseEvoSit`. */
    sitBytes: Uint8Array;
    hMin: number;
    hMax: number;
    /** 256 x 256 corner heights in .RAW units (1/32 ft), rows along z, as a stock track's .RAW holds them. */
    heights: Uint16Array;
    /** 256 x 256 tile numbers (into `<base>.tex`), as a stock track's .CLR holds them. */
    tiles: Uint16Array;
}
/** Decode the game's LZW stream. */
export declare function decodeEvoLzw(data: Uint8Array): Uint8Array;
/** Whether a file is a 4x4 Evolution 1 Lite track (its decoded start reads `LTE <n>`), not MTM2's light grid. */
export declare function isEvoLite(bytes: Uint8Array): boolean;
/** Read a Lite track. Throws when the file is not one. */
export declare function parseEvoLte(bytes: Uint8Array, sourceName?: string): EvoLite;
