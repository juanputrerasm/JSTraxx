/** A parsed AI line: who drove it, the lap time as written, and the samples' positions. */
export interface EvoAiLine {
    driver: string;
    lapTime: string;
    /** (x, height, z), in .SIT axes. */
    points: [number, number, number][];
}
/** One AI line file: its header fields and the recorded positions, in .SIT axes. */
export declare function parseEvoAiLine(bytes: Uint8Array): EvoAiLine;
/** AI\CLASSc\AI_cnTRACK.TXT, with its class and line number. */
export declare function matchEvoAiLineName(name: string, trackStem: string): {
    truckClass: number;
    line: number;
} | null;
/**
 * The course runs that make up a lap, judged against the recorded lines.
 *
 * Only runs at the end of the list are dropped, and only while each is off every line: the
 * lap is what the file lists first, and a run in the middle of it that happens to be
 * driven wide is still part of the order the course gives. With no recorded lines nothing
 * is dropped; the course is shown as stored.
 *
 * `runs` are .SIT course runs (x, height, z); `lines` are parsed AI lines.
 */
export declare function lapRuns<T extends {
    start: number[];
    end: number[];
}>(runs: T[], lines: readonly {
    points: number[][];
}[]): T[];
