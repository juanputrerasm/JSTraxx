export declare const WFL_MAGIC = "MWFL";
export declare const WFL_HEADER = 32;
export declare const WFL_DIRENTRY = 16;
export declare const WFL_CHUNKHEAD = 8;
export declare const WFL_STRIDE = 128;
export declare const WFL_STRIDE_V11 = 132;
export declare const WFL_MAX_FALLS = 64;
export declare const WFL_MAX_POINTS = 8;
export declare const WFL_NAME_LEN = 16;
/** Feet per crest point unit. */
export declare const WFL_POINT_FT: number;
/** Feet per second per flow speed unit. */
export declare const WFL_SPEED_FT: number;
/** Feet per crest height unit (the .WTR / .LVL water scale). */
export declare const WFL_HEIGHT_FT = 0.5;
export declare const WFL_FLAG_FREEZE = 1;
export declare const WFL_FLAG_SPLASH = 2;
export declare const WFL_FLAG_SOUND = 4;
export interface WflFall {
    /** The record's id byte (index + 1 as written; readers ignore it). */
    id: number;
    /** Source lake index + 1, or 0 for a spring. */
    source: number;
    flags: number;
    freeze: boolean;
    splash: boolean;
    sound: boolean;
    /** Flow speed at the crest, 1/16 ft/s. */
    speed: number;
    speedFtPerSec: number;
    /** Crest height, 0.5 ft units. */
    height: number;
    heightFt: number;
    /** Crest points in 1/16 ft, as stored. */
    points: Array<{
        x: number;
        z: number;
    }>;
    opacity: number;
    mist: number;
    volume: number;
    /** Mist depth and height %, 100 when the file is v1.0. */
    mistDepth: number;
    mistHeight: number;
    soundName: string;
    textureName: string;
}
export interface Wfl {
    major: number;
    minor: number;
    stride: number;
    falls: WflFall[];
}
export declare function isWfl(bytes: Uint8Array): boolean;
/** Read a .WFL with Traxx 1.7.1's rules; a file Traxx would refuse throws a RangeError naming why. */
export declare function parseWfl(bytes: Uint8Array): Wfl;
export interface WflWriteFall {
    source: number;
    flags: number;
    speed: number;
    /** The height to store: Traxx writes the effective one (the lake's for a lake-fed fall). */
    height: number;
    points: ReadonlyArray<{
        x: number;
        z: number;
    }>;
    opacity: number;
    mist: number;
    volume: number;
    /** 0 or 100 is the default; anything else makes the file v1.1. */
    mistDepth?: number;
    mistHeight?: number;
    soundName?: string;
    textureName?: string;
}
/**
 * Write a .WFL exactly as Traxx 1.7.1 lays one out: v1.0 (128-byte records) unless some fall's mist
 * depth or height is neither 0 nor 100, then v1.1 (132). Fall i gets id i + 1. Validation of the
 * falls themselves (crest shape, source, names in the pod) is the caller's: this checks only what
 * the file cannot hold.
 */
export declare function writeWfl(falls: readonly WflWriteFall[]): Uint8Array;
/** A fall's crest points in feet (a point is stored in 1/16 ft). */
export declare function wflPointsFt(fall: Pick<WflFall, "points">): Array<[number, number]>;
