import { truckManifestLines, type Vec3 } from "../truck/common.ts";
export { truckManifestLines };
export interface EvoTrkLight {
    index: number;
    type?: number;
    pos?: Vec3;
    bitmapRadius?: number;
    heading?: number;
    pitch?: number;
    spinSpeed?: number;
    coneLength?: number;
    coneBaseRadius?: number;
    coneRimRadius?: number;
    coneTexture?: string;
    sourceBitmap?: string;
    msOn?: number;
    msOff?: number;
}
export interface EvoTrkColor {
    hue: number;
    saturation: number;
    brightness: number;
    /** Swatch channels as written (not rounded or clamped). */
    red: number;
    green: number;
    blue: number;
    textureName: string;
}
/** Any value in `specs`: a number, a number tuple, text, or a counted numeric list. */
export type EvoTrkSpec = number | number[] | string;
export interface EvoTrk {
    sourceName: string;
    /** 6 or 7. */
    version: number;
    /** 1 for 4x4 Evolution, 2 for 4x4 Evolution 2. */
    game: 1 | 2;
    truckName: string;
    truckModelBaseName: string | null;
    tireModelBaseName: string | null;
    axleModelName: string | null;
    shockTextureName: string | null;
    barTextureName: string | null;
    axlebarOffset: Vec3 | null;
    driveshaftPos: Vec3 | null;
    /** Keyed by the manifest labels in EVO_WHEEL_KEYS. */
    wheelAnchors: Record<string, Vec3>;
    scrapePoints: Vec3[];
    instrumentCluster: string | null;
    numberOfLights: number | null;
    lights: EvoTrkLight[];
    colors: EvoTrkColor[];
    stockParts: string[];
    waveFiles: string[];
    /**
     * Every other label/value pair: scalars as numbers, comma tuples as number arrays, text as
     * text (truckMake, truckModel, truckClass and teamRequirement always stay text). Counted
     * numeric lists are stored under their "<name>[]" label.
     */
    specs: Record<string, EvoTrkSpec>;
    signature: string;
    /** The raw value line of each scalar label/value pair, including the named fields above. */
    rawValues: Record<string, string>;
    /** Scalar labels and counted-list labels ("<name>[]") in file order, repeats included. */
    fieldOrder: string[];
}
/** The four wheel-anchor labels, front right, front left, rear right, rear left. */
export declare const EVO_WHEEL_KEYS: readonly ["faxle.rtire.static_bpos", "faxle.ltire.static_bpos", "raxle.rtire.static_bpos", "raxle.ltire.static_bpos"];
/** True when these lines open with the Evo "version" / 6|7 pair rather than an MTM header. */
export declare function isEvoTrkLines(lines: readonly string[]): boolean;
/** True when these bytes are an Evo TRK. */
export declare function isEvoTrk(bytes: Uint8Array): boolean;
/**
 * Parse an Evo TRK.
 *
 * @throws Error when the bytes are not an Evo manifest.
 */
export declare function parseEvoTrk(bytes: Uint8Array, sourceName: string): EvoTrk;
/** Parse an Evo TRK already split by `truckManifestLines`. */
export declare function parseEvoTrkLines(lines: readonly string[], sourceName: string): EvoTrk;
/** Scalars stay numbers, comma tuples become number arrays, anything else stays text. */
export declare function trkSpecValue(value: string): EvoTrkSpec;
