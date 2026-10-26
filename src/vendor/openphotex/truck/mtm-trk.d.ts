import type { Vec3 } from "./common.ts";
export type MtmTrkDialect = "MTM1" | "MTM2" | "MTM2.1";
export interface MtmTrkLight {
    index: number;
    /**
     * BinEdit's Truck.h enumerates 0 headlight, 1 brake, 3 roof, 4 special, 5 backup.
     * The property label is "type", matched here by prefix.
     */
    type?: number;
    pos?: Vec3;
    /** The fourth "body axis pos" value; null when the line has only three. */
    bitmapRadius?: number | null;
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
    /** Property labels exactly as written, for each property read. */
    propertyLabels: string[];
}
export interface MtmTrk {
    dialect: MtmTrkDialect;
    /** The header line as written ("MTM2 truckName"), or null for headerless MTM1. */
    header: string | null;
    truckName: string;
    /** "truckModelBaseName" (MTM2 stem) or "truckModelName" (MTM1 file name). */
    truckModelBaseName: string | null;
    /** "tireModelBaseName" or "tireModelName". */
    tireModelBaseName: string | null;
    axleModelName: string | null;
    shockTextureName: string | null;
    barTextureName: string | null;
    axlebarOffset: Vec3 | null;
    /** The MTM2.1 three-value form: front axle, rear axle and middle bar heights. */
    superiorAxlebarOffset: {
        frontAxleY: number;
        rearAxleY: number;
        middleY: number;
    } | null;
    driveshaftPos: Vec3 | null;
    /** Every "<key>.x/.y/.z" group, keyed by <key>; the four wheels are "faxle.rtire.static_bpos" etc. */
    wheelAnchors: Record<string, Vec3>;
    scrapePoints: Vec3[];
    instrumentCluster: string | null;
    waveFiles: string[];
    numberOfLights: number | null;
    lights: MtmTrkLight[];
    /** Any other label/value pair, verbatim, last occurrence wins. */
    unknownFields: Record<string, string>;
}
/** The four wheel anchor keys: front pair first, right before left, as the TRK lists them. */
export declare const MTM_WHEEL_KEYS: readonly ["faxle.rtire.static_bpos", "faxle.ltire.static_bpos", "raxle.rtire.static_bpos", "raxle.ltire.static_bpos"];
/**
 * Parse an MTM1/MTM2 TRK already split by `truckManifestLines`.
 *
 * Any line set that is not an MTM2 header is read as MTM1, the headerless dialect; use
 * `detectTruckManifest` first to refuse Evo and CPR manifests.
 */
export declare function parseMtmTrkLines(input: readonly string[]): MtmTrk;
