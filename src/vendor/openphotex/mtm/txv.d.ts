/** A `key=value` line, or any other line (a comment) kept as written. Blank lines are dropped. */
export type TxvLine = {
    key: string;
    value: string;
} | {
    text: string;
};
export declare function parseTxv(input: Uint8Array | string): TxvLine[];
/** The value of a key, compared without case, or null. */
export declare function txvValue(lines: readonly TxvLine[], key: string): string | null;
/**
 * The bytes of a .TXV. With `situation`, the track's situation file extension, the keys of track
 * format version 6 are checked first (docs/LEVELS.md, "Track format version 6"): a .SIT or .SI2
 * track must not carry them, and a .SI3 track must carry formatVersion 6 or later with every key
 * in range. A RangeError names the offending key.
 */
export declare function writeTxv(lines: readonly TxvLine[], { situation }?: {
    situation?: string;
}): Uint8Array;
/**
 * Set keys in a .TXV, keeping every other line (unknown keys, comments) and the order: a key that
 * is present keeps its place and spelling and takes the new value; a new key is appended. A null
 * value removes the key.
 */
export declare function setTxvValues(lines: readonly TxvLine[], values: Readonly<Record<string, string | number | null>>): TxvLine[];
export interface TxvInfo {
    formatVersion: number | null;
    tool: string | null;
    toolVersion: string | null;
    built: string | null;
    legacyFallback: boolean | null;
    hdTextures: boolean | null;
    fogVolumes: number | null;
    vegetation: boolean | null;
    vegTrees: number | null;
    vegClumps: number | null;
    terrainGrid: string | null;
    terrainHeights: string | null;
    /** Waterfalls in WORLD\<stem>.WFL (Traxx 1.7.1 writes it only with the file). */
    waterfalls: number | null;
    /** Track format version 6 keys as written (readTxvV6 validates them): cells a side, 256 or 512. */
    worldCells: number | null;
    /** The entry holding the heights, a .PNG or a .RAW (version 6). */
    terrainHeightMap: string | null;
    /** Height steps per foot, a power of two 1..128 (version 6). */
    terrainHeightStep: number | null;
    /** Whole feet added to every height (version 6). */
    terrainHeightBase: number | null;
}
export declare function readTxvInfo(input: Uint8Array | string | readonly TxvLine[]): TxvInfo;
export declare const TXV_V6_KEYS: readonly ["formatVersion", "worldCells", "terrainHeightMap", "terrainHeightStep", "terrainHeightBase", "terrainGrid"];
export declare const TXV_V6_ONLY_KEYS: readonly ["worldCells", "terrainHeightMap", "terrainHeightStep", "terrainHeightBase"];
export declare const TXV_FORMAT_VERSION_V6 = 6;
export declare const MTM2_WORLD_CELLS: readonly [256, 512];
export declare const MTM2_HEIGHT_STEPS: readonly [1, 2, 4, 8, 16, 32, 64, 128];
/** The validated version 6 keys of a .SI3 track, defaults filled in. */
export interface TxvV6 {
    formatVersion: number;
    /** N, cells a side: 256 or 512. */
    worldCells: 256 | 512;
    /** W = 32 N, the world's side in feet. */
    worldFt: number;
    /** The heights' entry as written, or null for CP4's rules. */
    terrainHeightMap: string | null;
    terrainHeightStep: number;
    terrainHeightBase: number;
    /** The terrainGrid key, or null when absent (the file's size then picks: classic for N, fine for 4N). */
    terrainGrid: "classic" | "spline" | "fine" | null;
    /** formatVersion above 6: the track may need a newer build. */
    warnings: string[];
}
/** Read and check the version 6 keys of a .SI3 track's .TXV (section 6). Throws a RangeError naming the key. */
export declare function readTxvV6(input: Uint8Array | string | readonly TxvLine[] | null): TxvV6;
/** True when a .TXV uses a key of section 6 other than formatVersion: such a track must be a .SI3. */
export declare function txvUsesV6Keys(input: Uint8Array | string | readonly TxvLine[]): boolean;
