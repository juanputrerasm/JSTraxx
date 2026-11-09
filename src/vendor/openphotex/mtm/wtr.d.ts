export declare const WTR_MAGIC = "MWTR";
export declare const WTR_HEADER = 32;
export declare const WTR_STRIDE = 64;
export declare const WTR_TILES = 65536;
/** Feet per .WTR height unit (the .LVL water scale). */
export declare const WTR_HEIGHT_FT = 0.5;
export declare const WTR_FLAG_REFLECTIVE = 1;
export interface WtrLake {
    id: number;
    flags: number;
    reflective: boolean;
    /** Height in 0.5 ft units. */
    height: number;
    heightFt: number;
    seeds: Array<{
        x: number;
        z: number;
    }>;
    box: {
        minX: number;
        minZ: number;
        maxX: number;
        maxZ: number;
    };
    tileCount: number;
}
export interface Wtr {
    major: number;
    minor: number;
    tilesX: number;
    tilesZ: number;
    lakes: WtrLake[];
    /** Tile to lake id (0 dry), x + z * 256; null when the file has no TMAP chunk. */
    tileMap: Uint8Array | null;
}
export declare function isWtr(bytes: Uint8Array): boolean;
export declare function parseWtr(bytes: Uint8Array): Wtr;
export interface WtrWriteLake {
    flags: number;
    height: number;
    seeds: Array<{
        x: number;
        z: number;
    }>;
    box: {
        minX: number;
        minZ: number;
        maxX: number;
        maxZ: number;
    };
    tileCount: number;
}
/** Write a .WTR exactly as Traxx 1.7 lays one out. Lake i gets id i + 1, which tileMap must use. */
export declare function writeWtr(lakes: readonly WtrWriteLake[], tileMap: Uint8Array): Uint8Array;
/** The lake id (0 none) of the 32 ft tile under world feet (x, z); the world wraps at 8192 ft. */
export declare function wtrLakeAt(wtr: Pick<Wtr, "tileMap">, xFt: number, zFt: number): number;
