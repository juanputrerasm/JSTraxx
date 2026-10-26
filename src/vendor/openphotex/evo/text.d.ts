export declare function splitEvoLines(bytes: Uint8Array): string[];
/** Strips the per-record sigil and surrounding space from a label line. */
export declare function evoLabel(line: string | undefined): string;
/** Parses `a,b,c` into numbers, tolerating spaces and a trailing separator. */
export declare function evoNumbers(line: string | undefined | null): number[];
/** Unquotes a v7 string field: `"AUSTART.SMF"` -> `AUSTART.SMF`. */
export declare function evoUnquote(value: string | undefined): string;
export declare function evoFieldLine(line: string): {
    value: string;
    field: string | null;
};
