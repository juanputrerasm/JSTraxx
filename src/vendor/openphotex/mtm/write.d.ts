import type { Vec3 } from "../truck/common.ts";
import type { MtmSit, SitFog } from "./sit.ts";
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
    /**
     * A truck in the middle of a race, as MONSTER.EXE's own writer (0x4c0360) prints it for "Save situation" and a
     * saved game: its motion, gear, autopilot, damage and race progress. Without it the record is a stock grid slot,
     * at rest with a zeroed race state and no `@damageCode` line.
     */
    state?: Mtm2SitTruckState;
}
/** A truck's live state in a SIT record (0x4c0360). Times are seconds; positions and speeds feet. */
export interface Mtm2SitTruckState {
    /** bvel: body-axis velocity, ft/s. */
    bvel: readonly [number, number, number];
    /** p, q, r: body rates, rad/s. */
    rates: readonly [number, number, number];
    /** faxle.angle, faxle.steering_angle and the rear axle's. */
    frontAxle?: readonly [number, number];
    rearAxle?: readonly [number, number];
    /** The tires' on-ground flags, right then left, as the game keeps them (-1 and 1 at rest). */
    frontOnGround?: readonly [number, number];
    rearOnGround?: readonly [number, number];
    /** xm.gear (`+0x58c`): 0 reverse ... 4 first; the game's numbering. */
    gear: number;
    /** ap.autopilot (1 on) and ap.cnumber, the course segment it follows. */
    autopilot: number;
    cnumber: number;
    /** ap.speed_control, ap.course_control, ap.lasterror. */
    apControl?: readonly [number, number, number];
    /**
     * `@damageCode` (`+0x1764`), the 32-bit crash damage code. Null for a level's own grid slot, which has no such line:
     * the record is then written in the stock grid layout, with these values in it.
     */
    damageCode: number | null;
    /** heliTimer, heliTheta, heliPhi, heliPsi, and heliPos. */
    heli?: readonly [number, number, number, number];
    heliPos?: readonly [number, number, number];
    /** segments (`+0x8f0`), laps (`+0x8f4`), staged (`+0x8fc`), bonusLaps (`+0x900`), finishedRace (`+0x904`), nextcheckpoint (`+0xfa8`). */
    segments: number;
    laps: number;
    staged?: number;
    bonusLaps?: number;
    finished: number;
    nextCheckpoint: number;
    /** totalracetime (`+0xfa4`), fastestLap (`+0xfa0`), dragTimer (`+0x90c`). */
    totalRaceTime: number;
    fastestLap: number;
    dragTimer?: number;
    /** Up to 20 laps' times (`+0xf50`), and each lap's up to 20 checkpoint times (`+0x910`); missing ones are 0. */
    lapTimes: readonly number[];
    checkpointTimes: readonly (readonly number[])[];
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
    /** Community Patch 4's `F` block (type 14 fog volumes), written after the sounds and any light block. */
    fog?: SitFog;
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
/**
 * A parsed MTM2 SIT (`parseMtmSit`) as `writeMtm2Sit` input, for an editor that reads a level, changes its data and
 * writes it back: `writeMtm2Sit(mtm2SitFromParsed(parseMtmSit(bytes)))` reads back as the same level.
 *
 * Positions are taken in feet as the game loader keeps them (`positionFt`, `startFt`), so a negative x or z comes back
 * wrapped by +8192, which the game reads as the same place. A course segment gets the game's track width
 * (`trackWidthFt`, 32 when the file had no `&` line). Numbers are written in the stock layout (two decimals, six for
 * mass, speeds and lengths), and the header lines no reader interprets are carried over as written.
 *
 * Throws on what `writeMtm2Sit` cannot express: a SIT that is not MTM2, or a top-crush car in the size form, which no
 * stock MTM2 level uses.
 */
export declare function mtm2SitFromParsed(sit: MtmSit): Mtm2Sit;
/**
 * The lines of one SIT truck record (after its delimiter), as `writeMtm2Sit` writes it: for a caller that rewrites
 * the vehicles of an existing SIT (`replaceSitVehicles`).
 */
export declare function sitTruckLines(vehicle: Mtm2SitTruck): string[];
/**
 * An existing SIT's text with its `*** Vehicles ***` section put in place of `vehicles`, and, when given, its
 * `$racetime, raceStartTime, dragDebugTimer` line: what MONSTER.EXE's "Save situation" writer (0x553230) changes in a
 * level's SIT, the live trucks and the race clock. The rest is kept line for line. Lines end CRLF.
 */
export declare function replaceSitVehicles(sitText: string, vehicles: readonly Mtm2SitTruck[], { raceTimes }?: {
    raceTimes?: readonly number[];
}): string;
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
