export type TvLvlOrigin = "TV/F3" | "HB";
export interface TvLvl {
    origin: TvLvlOrigin;
    lineCount: number;
    /** Whether the header runs to line 21; shorter files are not level headers. */
    complete: boolean;
    /** Line 22, when it is a real name (not a label, comment or "null"). */
    displayName: string | null;
    /** Header slots 0-21, normalized as archive paths; null past the end of the file. */
    briefingName: string | null;
    rawOrTnlName: string | null;
    clrName: string | null;
    actName: string | null;
    texName: string | null;
    pupName: string | null;
    aniName: string | null;
    tdfName: string | null;
    skyName: string | null;
    skyActName: string | null;
    defName: string | null;
    navName: string | null;
    /** Line 14 as written. */
    musicLine: string | null;
    lteName: string | null;
    sunVector: [number, number, number] | null;
    shadowIntensity: number | null;
    sunPosition: [number, number, number] | null;
    sunIntensity: number | null;
    levelValue: number | null;
}
/** `NULL.xxx`, or nothing: the slot names no file. */
export declare function isNullAssetName(name: string | null | undefined): boolean;
/** Hellbender's .LVL carries a "!New ground additions" block; TV and Fury3 never do. */
export declare function detectTvLvlOrigin(lines: readonly string[]): TvLvlOrigin;
export declare function parseTvLvl(input: Uint8Array | string): TvLvl;
/** A level's name from its entry name when the header carries none: the title without .LVL. */
export declare function tvLvlFallbackName(entryName: string): string;
