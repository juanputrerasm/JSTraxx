import type { Vec3 } from "../truck/common.ts";
/**
 * A SIT value: a number is written with two decimals, as stock SITs write positions and angles;
 * a string is written as given, for a caller that has already formatted it.
 */
export type SitValue = number | string;
export type SitTriple = readonly [SitValue, SitValue, SitValue];
/** A truck record: the "Your Truck" slot or a grid vehicle. */
export interface Mtm2SitTruck {
    /** Default "POWERBIG.TRK", the stock grid's placeholder; the player's pick replaces it. */
    truckFile?: string;
    /** ipos: x, altitude, z in the SIT's own units. */
    position: SitTriple;
    /** theta, phi, psi. */
    orient: SitTriple;
    /** "!ap.courseToFollow": every racer follows extended course 2 in all fifteen stock levels. */
    courseToFollow?: number;
}
/** A *** Ramps *** record: a model, or a wedge's length, width and height. */
export interface Mtm2SitRamp {
    position: SitTriple;
    orient: SitTriple;
    modelName?: string;
    extents?: SitTriple;
    /** A number is written with six decimals. */
    mass?: SitValue;
    /** Default "0,0,0". */
    bvel?: SitTriple;
    /** p, q, r. Default "0,0,0". */
    rates?: SitTriple;
}
/** A *** Boxes *** record: a model, or a checkpoint's extents. */
export interface Mtm2SitBox extends Mtm2SitRamp {
    /** 0 normal, 6 checkpoint, 7 drive thru, 8 always face. */
    type: number;
    flags?: number;
    /** Default 0. */
    priority?: number;
    /** The "@sound effect entries": the sound when something hits the box, then its own loop. Default "NULL.WAV". */
    hitSound?: string;
    loopSound?: string;
    /**
     * The `L` block's twelve fields (rad, hgt, r, g, b, glow, glowRad, coneLen, coneRim, coneBase,
     * bright, aimOff), written after the sounds when given. Community Patch 3 reads it on type 12.
     */
    light?: readonly SitValue[];
}
/** A *** Top Crush *** record: the base model at `position`, the keyframed cab at `position2`. */
export interface Mtm2SitTopCrush {
    position: SitTriple;
    position2: SitTriple;
    orient: SitTriple;
    /** Written "NULL" when absent. */
    modelName?: string;
    cabModelName?: string;
    mass?: SitValue;
    bvel?: SitTriple;
    rates?: SitTriple;
}
export interface Mtm2SitCourseSegment {
    start: SitTriple;
    end: SitTriple;
    speedLimit?: SitValue;
    trackWidth?: SitValue;
    /** The `ctype,cspeed_type` value. Default "1,0", a straight. */
    types?: string;
    /** The `cdec_point,cspeed,lastentry` value. Default "30,0,0". */
    speeds?: string;
}
/** The *** Stadium *** record. */
export interface Mtm2SitStadium {
    /** The MTM2 form `!stadiumFlag,x,z,sx,sz,stadiumModelName`; false writes `stadiumFlag,stadiumModelName`. Default true. */
    placed?: boolean;
    /** 1 for an arena. */
    flag: number;
    x?: number;
    z?: number;
    sx?: number;
    sz?: number;
    modelName: string;
}
export interface Mtm2Sit {
    /** Line 0: the level file. */
    lvlName: string;
    trackName: string;
    /** Default "EVO CONVERSION" is the converter's; stock files name a place. */
    localeName: string;
    /** Default "7947984,7947988". */
    longitudeLatitude?: string;
    /** Write the MTM2 "!ambient sound,track length,weather mask" lines. Default true; MTM1 has none. */
    ambientLine?: boolean;
    /** The saved race-state values, as written. Defaults "0,16384,-16383,24832,98304", "0,0,0", "0,1,0,0,0" and "0,0". */
    viewState?: string;
    raceTimes?: string;
    controlFlags?: string;
    stageFlags?: string;
    /** The track PICTURE (257x210): "Track Logo" holds it in every stock level, despite the name. */
    pictureBmp: string;
    /** The 32x24 list ICON, in the slot named "Track Map". */
    iconBmp: string;
    /** Default "Sonic". */
    flyByAvi?: string;
    /** Default "Track". */
    announcerWav?: string;
    descriptionTxt: string;
    raceType?: number;
    /** Default 2. */
    redbookTrack?: number;
    ambientSound?: number;
    trackLength?: SitValue;
    weatherMask?: number;
    yourTruck: Mtm2SitTruck;
    /** The grid; stock levels have 8. */
    vehicles: Mtm2SitTruck[];
    /** Default none. */
    ramps?: Mtm2SitRamp[];
    boxes: Mtm2SitBox[];
    /** The *** Cylinders *** count and its lines, written as given. Default none. */
    cylinders?: {
        count: number;
        lines: readonly string[];
    };
    /** Default none. */
    topCrush?: Mtm2SitTopCrush[];
    course: Mtm2SitCourseSegment[];
    /** Default 0. */
    courseDirection?: number;
    /** The four extended courses; a null or missing slot is written empty ("0,0"). */
    extendedCourses: (Mtm2SitCourseSegment[] | null)[];
    /** Default 0 for each slot. */
    extendedCourseDirections?: readonly number[];
    /** Default off: "stadiumFlag,stadiumModelName" / "0,none". */
    stadium?: Mtm2SitStadium;
    /** Default type 0 and no models. */
    backdrop?: {
        type?: number;
        modelNames: readonly string[];
    };
}
export declare function writeMtm2Sit(sit: Mtm2Sit): Uint8Array;
/** An MTM2 .LVL. Every name is written as given; the side files share the level's stem in stock levels. */
export interface Mtm2Lvl {
    /** Line 1. */
    descriptionTxt: string;
    rawName: string;
    clrName: string;
    /** The level palette; its fog map is `fogName`. */
    actName: string;
    texName: string;
    /** Line 6. Default "ZERO.RAW". */
    line6?: string;
    pupName: string;
    aniName: string;
    tdfName: string;
    /** Default "CLOUDY2.RAW" and "CLOUDY2.ACT". */
    skyRawName?: string;
    skyActName?: string;
    defName: string;
    navName: string;
    /** Default "ROCKX.WAV". */
    musicName?: string;
    fogName: string;
    lteName: string;
    /** Line 17: the direction the sunlight travels, (east, up, north), 16.16 fixed point. */
    sunVector: readonly [number, number, number];
    /**
     * Lines 18-21. The same in all fifteen stock MTM2 levels apart from the shade scalar
     * (23000..40960): defaults 40960, "32000,-46333,0", 64000 and 255.
     */
    shadowIntensity?: number;
    sunPosition?: readonly [number, number, number];
    sunIntensity?: number;
    levelValue?: number;
    /** The value after the !waterHeight label, in the level's own height units. */
    waterHeight: number;
}
export declare function writeMtm2Lvl(lvl: Mtm2Lvl): Uint8Array;
/** A .TEX texture list: the count, then one name per line. */
export declare function writeTexList(names: readonly string[]): Uint8Array;
/**
 * A .TTY texture type table: the count, then `name,value` per typed texture, where the value is
 * the surface type * 100 + its depth (see parseTty). An empty list writes "0".
 */
export declare function writeTty(entries: readonly {
    name: string;
    value: number;
}[]): Uint8Array;
/** A count-prefixed side file with no records (.TTY, .PUP, .ANI, .TDF, .DEF, .NAV). */
export declare function writeEmptyList(): Uint8Array;
export declare function emptyGroundBoxGrids(gridSize?: number): Record<"RA0" | "RA1" | "RA2" | "RA3" | "RA4" | "RA5" | "CL0" | "CL1" | "CL2", Uint8Array>;
export declare function buildMtm2Lte(raw: Uint8Array, sun: readonly [number, number, number]): Uint8Array;
/** The MTM2 2.1 truck manifest's fields, in the shape parseMtmTrkLines reads back. */
export interface Mtm2Trk {
    truckName: string;
    truckModelBaseName: string;
    tireModelBaseName: string;
    axleModelName: string;
    shockTextureName: string;
    barTextureName: string;
    axlebarOffset: Partial<Vec3> | null;
    driveshaftPos: Partial<Vec3> | null;
    /** Keyed by MTM_WHEEL_KEYS; a missing wheel is written at the origin. */
    wheelAnchors: Record<string, Partial<Vec3> | undefined>;
    scrapePoints: Partial<Vec3>[];
    instrumentCluster: string;
    waveFiles: string[];
    lights: Mtm2TrkLight[];
    /** The 2.1 second axle-bar set, written last as the extension appends it. */
    superiorAxlebarOffset?: {
        frontAxleY: number;
        rearAxleY: number;
        middleY: number;
    } | null;
}
export interface Mtm2TrkLight {
    type?: number;
    pos?: Partial<Vec3>;
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
}
export declare function writeMtm2Trk(truck: Mtm2Trk): Uint8Array;
