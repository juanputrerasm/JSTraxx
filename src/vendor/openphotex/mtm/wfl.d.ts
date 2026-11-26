import { type V6HeightWindow } from "./wtr.ts";
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
/** Rough from: 0 = the engine's default speed, 255 = rough water off. */
export declare const WFL_ROUGH_DEFAULT = 0;
export declare const WFL_ROUGH_OFF = 255;
/** The engine's default rough-from speed, ft/s (beta 0.53 hotfix 3). */
export declare const WFL_ROUGH_DEFAULT_FT = 25;
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
    /** Rough from, the byte as stored (0 when the file is v1.0): 0 default, 1..250 ft/s, 255 off, 251..254 invalid. */
    roughFrom: number;
    soundName: string;
    textureName: string;
}
export interface Wfl {
    major: number;
    /** The header's tiles a side: 256 in version 1, N in version 2. */
    cells: number;
    minor: number;
    stride: number;
    falls: WflFall[];
}
export declare function isWfl(bytes: Uint8Array): boolean;
/**
 * Read a .WFL with Traxx 1.7.1's rules; a file Traxx would refuse throws a RangeError naming why. Version 2 (track
 * format version 6, section 9.3) holds N x N in its header and i32 crest heights. `cells`, the track's world size,
 * refuses a file authored for another one (a version 1 file is 256).
 */
export declare function parseWfl(bytes: Uint8Array, opts?: {
    cells?: number;
}): Wfl;
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
    /** Rough from (byte 130): 0 (the default) keeps v1.0; anything else makes the file v1.1. */
    roughFrom?: number;
    soundName?: string;
    textureName?: string;
}
/**
 * Whether a fall's height fits version 1, the 256-cell world's file: 0..4096 half-feet (the engine accepts 1..4096;
 * 0 is left to its record check, as Traxx writes it). With `heightWindow` (a 256-cell .SI3's step and base) a height in
 * the track's window 2 * base + 1 .. 2 * (base + 65536 / step) fits too, as with the lakes (wtrV1HeightOk).
 */
export declare function wflFallFitsV1(f: Pick<WflWriteFall, "height">, heightWindow?: V6HeightWindow): boolean;
/**
 * Write a .WFL exactly as Traxx 1.7.3 lays one out: v1.0 (128-byte records) unless some fall's mist
 * depth or height is neither 0 nor 100, or its rough from is not 0, then v1.1 (132). Fall i gets id i + 1. Validation of the
 * falls themselves (crest shape, source, names in the pod) is the caller's: this checks only what
 * the file cannot hold.
 *
 * `cells` is the world's size (track format version 6), and it picks the version (section 9.3):
 * 256 writes version 1 (a fall above 4096 half-feet throws, unless it is in `heightWindow`, the 256-cell .SI3's height
 * window), 512 version 2.
 */
export declare function writeWfl(falls: readonly WflWriteFall[], opts?: {
    cells?: number;
    heightWindow?: V6HeightWindow;
}): Uint8Array;
/** A fall's crest points in feet (a point is stored in 1/16 ft). */
export declare function wflPointsFt(fall: Pick<WflFall, "points">): Array<[number, number]>;
