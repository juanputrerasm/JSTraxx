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
export declare function writeTxv(lines: readonly TxvLine[]): Uint8Array;
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
}
export declare function readTxvInfo(input: Uint8Array | string | readonly TxvLine[]): TxvInfo;
