/** What ground and box quakes share. */
export interface HbQuakeBase {
    index: number;
    mode: number;
    /** Upper and lower limits, engine units (128 per height step). */
    upper: number;
    lower: number;
    /** The same limits in height steps. */
    upperStep: number;
    lowerStep: number;
    startDirection: number;
    /** Travel and wait times, in the engine's frame-clock units. */
    riseTime: number;
    topWait: number;
    fallTime: number;
    bottomWait: number;
    endMode: number;
    /** The flag fields of the end-mode line, after endMode, in file order. */
    flags: number[];
    /** Rise, fall, at top, at bottom and the fifth sound; null for NULL. */
    sounds: (string | null)[];
    /** The value after "!--Additional quake info--". */
    additionalInfo: number;
    /** The four unnamed integers. */
    unnamed: number[];
}
export interface HbGroundQuake extends HbQuakeBase {
    /** Cell rectangle, inclusive, wrapping on the 128 grid. */
    x0: number;
    z0: number;
    x1: number;
    z1: number;
    /** 1 surface, 2 cavern floor, 3 cavern ceiling. */
    layer: number;
}
export interface HbBoxQuake extends HbQuakeBase {
    x: number;
    z: number;
    /** 1 the surface ground boxes; any other value the cavern's. */
    layer: number;
    switchFlag: number;
    switchTextures: (string | null)[];
}
export interface HbQuakes {
    groundQuakes: HbGroundQuake[];
    boxQuakes: HbBoxQuake[];
    /** True when every declared entry was read. */
    complete: boolean;
}
/** Engine units per height step in a .QKE limit. */
export declare const HB_QUAKE_HEIGHT_UNIT = 128;
/**
 * Parses a Hellbender .QKE. Returns null when the file does not start with the ground quake
 * count; an entry that does not parse ends the reading, with `complete` false.
 */
export declare function parseHbQuakes(bytes: Uint8Array | null | undefined): HbQuakes | null;
