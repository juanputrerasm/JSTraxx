export declare function nocturneLines(bytes: Uint8Array): string[];
export declare function nocturneDataLines(bytes: Uint8Array): string[];
export declare function csv(line: string): string[];
export declare function numbers(line: string): number[];
export declare function integer(line: string, what: string): number;
export declare function unquote(value: string): string;
export declare class LineReader {
    index: number;
    readonly lines: string[];
    readonly name: string;
    constructor(lines: string[], name: string);
    next(what: string): string;
    nums(what: string, count?: number): number[];
    count(what: string): number;
    done(): void;
}
