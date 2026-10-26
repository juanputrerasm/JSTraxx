export type SitOrigin = "MTM1" | "MTM2" | "CPR";
/** A placement. `type` is the box type (99 for a ramp, 98 for a top-crush part). */
export interface SitBox {
    position: [number, number, number];
    theta: number;
    phi: number;
    psi: number;
    length: number;
    width: number;
    height: number;
    modelName: string;
    mass: number;
    type: number;
    flags: number;
    /** Pass order among the checkpoints (type 6) of the Boxes section; -1 otherwise. */
    checkpointSequence: number;
    /** Velocity in ft/s as written, when the record carries one. */
    bvel?: [number, number, number];
    /** The record's `p,q,r` line as written, when it has one. */
    rates?: [number, number, number];
    /** The game loader's view (MONSTER.EXE 0x5495e0): feet, negative x and z wrapped by +8192. */
    positionFt?: [number, number, number];
    /** Full length, width and height in feet as written, unrounded (a model's extents replace them in game). */
    sizeFt?: [number, number, number];
    /**
     * The box's `priority` line: the game draws it only when this is at most the MONSTER.INI
     * detailLevel (MONSTER.EXE 0x54ec00). Absent means 0.
     */
    priority?: number;
    /**
     * The two names under "@sound effect entries": the sound the object makes when something hits
     * it (MONSTER.EXE 0x428bc0 plays it) and the one it makes by itself, looping (a train's rumble,
     * a crossing's bell, a stand's crowd). Null when the entry is NULL.WAV.
     */
    hitSound?: string | null;
    loopSound?: string | null;
    /**
     * Community Patch 3 `BOX_LIGHT` (type 12): the optional `L` block (ENGINE_LIMITS.md, "two new box types"), or its
     * defaults when a type 12 box has none. Absent on every other box.
     */
    light?: SitLight;
    /**
     * The `L` block's data line as written, field by field, on any box that carries one (an editor
     * keeps what the author typed; `light` is the engine's reading of it, for type 12 only).
     */
    lightFields?: number[];
    /** Top-crush parts: which record they came from, and which part they are. */
    crushGroup?: number;
    crushRole?: "body" | "cab";
}
/**
 * A Community Patch 3 track light (box type 12). Feet unless noted. `rad` is the lit pool's radius on the ground, `hgt` the lamp
 * head's height above the box's origin, `glow` 0 (no visible source), 1 (a glow sprite) or 2 (glow and cone), `bright` how
 * strongly it lights the ground (0.25 to 3.75; 1 is a truck headlight), `aimOff` how far along the box's facing the pool lands.
 */
export interface SitLight {
    rad: number;
    hgt: number;
    color: [number, number, number];
    glow: number;
    glowRad: number;
    coneLen: number;
    coneRim: number;
    coneBase: number;
    bright: number;
    aimOff: number;
}
/** The box types Community Patch 3 added: a static light, and a mover with no train sound, horn or light. */
export declare const BOX_LIGHT = 12;
export declare const BOX_MOVING = 13;
/**
 * The `L` block's data line, read as the engine reads it: tolerantly, missing trailing fields keeping their defaults and
 * surplus ones ignored; `bright` snapped to 0.25 steps within 0.25..3.75 and `rad` clamped to 4095.
 */
export declare function parseSitLight(line: string | null | undefined): SitLight;
export interface SitCourseSegment {
    /** Editor space, as sitWorldTriplet gives (2 units per foot horizontally, 2 ft height steps). */
    start: [number, number, number];
    end: [number, number, number];
    speedLimit: number;
    /** As stored; the parser's historical default when the `&` line is absent is 64. */
    trackWidth: number;
    /** The game loader's view (MONSTER.EXE 0x4e0970): feet, negative x and z wrapped by +8192. */
    startFt: [number, number, number];
    endFt: [number, number, number];
    /** 1 in every stock SIT: the file holds straights only; the game builds the arcs between them. */
    ctype: number;
    cspeedType: number;
    cdecPoint: number;
    cspeed: number;
    lastEntry: number;
    /** cTrackWidth in feet; the game defaults it to 32 when the `&` line is absent. */
    trackWidthFt: number;
}
export interface SitCourse {
    segments: SitCourseSegment[];
    /** course_direction from the `c1Count,course_direction` line. */
    direction: number;
    /** Extended courses: which of the four `[Course N]` slots (0..3) this one is. */
    slot?: number;
}
export interface SitTruck {
    position: [number, number, number];
    theta: number;
    phi: number;
    psi: number;
    name: string;
    /** The "Your Truck (Not used anymore)" slot: a saved player slot, not a grid vehicle. */
    playerSlot?: boolean;
    /** The game loader's view of ipos: feet, negative x and z wrapped by +8192. */
    positionFt?: [number, number, number];
    /** `!ap.courseToFollow`: the course this vehicle drives, 0 the primary and 1..4 the extended ones. */
    courseToFollow?: number;
}
export interface SitArena {
    modelName: string;
    x: number;
    y: number;
    sx: number;
    sy: number;
    /** The MTM2 `!stadiumFlag,x,z,sx,sz` form; false for the older `stadiumFlag,stadiumModelName`, which places nothing. */
    placed: boolean;
}
/**
 * A top-crush car as MONSTER.EXE reads it (`0x551660`): two parts sharing one rotation, the body
 * at `positionFt` and the cab at `position2Ft`, either named models or full sizes for both.
 */
export interface SitTopCrush {
    positionFt: [number, number, number];
    position2Ft: [number, number, number];
    theta: number;
    phi: number;
    psi: number;
    /** The model form: body and cab model names (normalized), else empty. */
    modelName: string;
    cabModelName: string;
    /** The size form: full `length, width, height` of the body and the cab (feet), else null. */
    sizeFt: [number, number, number] | null;
    size2Ft: [number, number, number] | null;
    mass: number;
    bvel: [number, number, number];
    /** p, q, r. */
    rates: [number, number, number];
}
export interface MtmSit {
    origin: SitOrigin;
    /** Line 0: the level file, normalized. */
    lvlName: string;
    lineCount: number;
    trackName: string | null;
    /**
     * The `Track Fly-By .AVI file` line as written. A leftover: MTM1's fly-by track preview was never
     * implemented, and no code plays it; MTM2 reuses the line for `sonicTrack`.
     */
    flyBy: string | null;
    /** The engine's hidden hard-track switch: the Fly-By line reads `Sonic` (MONSTER.EXE 0x551f90). */
    sonicTrack: boolean;
    localeName: string | null;
    /**
     * The header's file names, as written, or null where the SIT has no such line: the track's picture on the game's
     * setup screens ("Track Logo .BMP file"), its overhead map ("Track Map .BMP file", MTM1's zoom map), its description
     * ("Track Description .TXT file") and "Track Announcer .WAV file". The bitmaps and the text are `UI\` and `WORLD\`
     * entries of the game's UI archive.
     */
    logoBmp: string | null;
    mapBmp: string | null;
    descriptionTxt: string | null;
    announcerWav: string | null;
    /**
     * A drag strip's par time in seconds: MTM1 reads the fly-by line of a type 1 track as a number and draws the
     * computer's qualifying and simulated times within half a second of it (MONSTER.EXE 1.00, 0x4bbd60). Null when the
     * track is not a drag strip or the line is no number.
     */
    dragParTime: number | null;
    /** "Track Race Type" as stored; see sitTrackTypeName. */
    trackTypeCode: number | null;
    /** MTM1 and CPR: the CD audio track. */
    redbookTrack: number | null;
    /** MTM2 only. */
    ambientSound: number | null;
    /**
     * MTM2 only: the track length, ft. A Circuit's default lap count is `trunc(15000 / length + 1)`,
     * with 6000 when the line is missing (MONSTER.EXE CRace::init).
     */
    trackLength: number | null;
    weatherMask: number | null;
    /** Ramps, then boxes, then top-crush parts (body, cab) in file order. */
    boxes: SitBox[];
    primaryCourse: SitCourse | null;
    extendedCourses: SitCourse[];
    /** `*** Top Crush ***`: the cars as the engine reads them (the parts are also in `boxes`). */
    topCrush: SitTopCrush[];
    arena: SitArena | null;
    /** Null when the file has no *** Backdrop *** section. */
    backdropModelNames: string[] | null;
    trucks: SitTruck[];
    /**
     * `*** Cylinders ***`: the declared count and the section's lines as written. No engine draws
     * or collides with cylinders, so they are kept as text for a writer to carry over.
     */
    cylinders: {
        count: number;
        lines: string[];
    } | null;
    /** The "Track Longtitude, Latitude" value as written. */
    longitudeLatitude: string | null;
    /** What does not add up, such as a section declaring more records than it holds. */
    warnings: string[];
}
export declare function detectSitOrigin(lines: readonly string[], sitTitle?: string): SitOrigin;
export declare function sitTrackTypeName(code: number, origin: SitOrigin): string;
export declare function sitFeetTriplet(value: string): [number, number, number];
export declare function sitWorldTriplet(value: string): [number, number, number];
/** Parse a .SIT (MTM1, MTM2 or CPR). `sitTitle` lets the .SI2 extension settle the origin. */
export declare function parseMtmSit(input: Uint8Array | string, sitTitle?: string): MtmSit;
/** An MTM-family .LVL: the level's asset references and environment, by line. */
export interface MtmLvl {
    lineCount: number;
    /**
     * Line 1. MONSTER.EXE (0x4d4d70) treats 4 as an old MTM level: the old MTM palette, and
     * checkpoint models drawn. Every stock MTM2 level has 0.
     */
    levelType: number;
    /** Line 1: the track text file (DATA\\<stem>.TXT), as written; null when absent. */
    textName: string | null;
    /** Line 2: the heightfield .RAW. */
    rawName: string;
    /** Line 3: the colour (texture index) grid .CLR. */
    clrName: string;
    /** Line 4: the level palette .ACT; its fog map is the same stem with .MAP. */
    actName: string;
    /** Line 5: the terrain texture list .TEX; its type table is the same stem with .TTY. */
    texName: string;
    /** Lines 6 to 9: the blank-height .RAW, .PUP, .ANI and .TDF names, as written; null when absent. */
    zeroRawName: string | null;
    pupName: string | null;
    aniName: string | null;
    tdfName: string | null;
    /** Line 10: the sky .RAW, when the line is a .RAW that is not NULL. */
    skyRawName: string | null;
    /** Line 11: the sky's .ACT. */
    skyActName: string | null;
    /** Lines 12 and 13: the .DEF and .NAV names, as written; null when absent. */
    defName: string | null;
    navName: string | null;
    /** Line 14: the music file as written (null when absent). */
    musicName: string | null;
    /** Line 15: the fog table (FOG\\<stem>.FOG, 4096 bytes), as written; null when absent. */
    fogName: string | null;
    /** Line 16: the lighting map .LTE. */
    lteName: string | null;
    /** Lines 17-21. */
    sunVector: [number, number, number] | null;
    shadowIntensity: number | null;
    sunPosition: [number, number, number] | null;
    sunIntensity: number | null;
    levelValue: number | null;
    /** MTM2 only: the raw value after the !waterHeight label. */
    waterHeight: number | null;
}
/** Parse an MTM-family .LVL. Returns null when it has fewer than six lines. */
export declare function parseMtmLvl(input: Uint8Array | string): MtmLvl | null;
/**
 * The names a .TEX terrain texture list declares, normalized, in slot order. The same format in
 * every SIT- and LVL-family game: a count, then one name per line.
 */
export declare function parseTexList(input: Uint8Array | string): string[];
/** A .TTY entry: a texture's surface type (value / 100) and depth (value % 100). */
export interface TtyEntry {
    name: string;
    value: number;
    type: number;
    depth: number;
}
export declare function parseTty(input: Uint8Array | string): TtyEntry[];
