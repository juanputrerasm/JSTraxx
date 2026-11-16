export declare const WTR_MAGIC = "MWTR";
export declare const WTR_HEADER = 32;
export declare const WTR_STRIDE = 64;
export declare const WTR_TILES = 65536;
/** Feet per .WTR height unit (the .LVL water scale). */
export declare const WTR_HEIGHT_FT = 0.5;
export declare const WTR_FLAG_REFLECTIVE = 1;
/** Header flags (byte 20) bit 0: the lakes were filled with the edge rule. */
export declare const WTR_HEADER_EDGE_RULE = 1;
export interface WtrLake {
    id: number;
    flags: number;
    reflective: boolean;
    /** Height in 0.5 ft units (signed in version 2). */
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
    /** The header's u32 flags at byte 20 (0 in files before Traxx 1.7.3). */
    headerFlags: number;
    /** Header flags bit 0: built with the edge rule. */
    edgeRule: boolean;
    tilesX: number;
    tilesZ: number;
    lakes: WtrLake[];
    /** Tile to lake id (0 dry), x + z * N (N = 256 in version 1, tilesX in version 2); null when the file has no TMAP chunk. */
    tileMap: Uint8Array | null;
}
export declare function isWtr(bytes: Uint8Array): boolean;
/**
 * Parse a .WTR, version 1 or 2. With `cells` (a version 6 track's worldCells) the header's size
 * must be N x N and the TMAP N * N bytes, else it is refused.
 */
export declare function parseWtr(bytes: Uint8Array, { cells }?: {
    cells?: number;
}): Wtr;
/**
 * The valid lake heights, in half-feet, inclusive: version 1's 1..4096, or version 2's
 * 2 * base + 1 .. 2 * (base + 65536 / step), the terrain's whole range (9.1).
 */
export declare function wtrHeightRange(major: number, step?: number, base?: number): [number, number];
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
/**
 * Write a .WTR as Traxx 1.7 lays one out. Lake i gets id i + 1, which tileMap must use. The tile
 * map is N * N bytes, and N picks the version (9.1): 256 x 256 writes version 1 (heights 1..4096,
 * the CP4 file; a lake outside that throws), 512 x 512 version 2. `version`, when given, must agree.
 * `edgeRule` marks a file filled with the edge rule as Traxx 1.7.3 does (minor 1, header flags bit 0);
 * without it the header is Traxx 1.7.0's (minor 0, flags 0).
 */
export declare function writeWtr(lakes: readonly WtrWriteLake[], tileMap: Uint8Array, { version, edgeRule }?: {
    version?: 1 | 2;
    edgeRule?: boolean;
}): Uint8Array;
/** The lake id (0 none) of the 32 ft tile under world feet (x, z); the world wraps at 32 N ft, N the map's side. */
export declare function wtrLakeAt(wtr: Pick<Wtr, "tileMap">, xFt: number, zFt: number): number;
