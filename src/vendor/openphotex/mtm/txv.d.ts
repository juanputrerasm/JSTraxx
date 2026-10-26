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
