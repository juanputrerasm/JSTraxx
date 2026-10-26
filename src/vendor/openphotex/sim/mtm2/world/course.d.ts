export type Point3 = [number, number, number];
export interface CourseStraight {
    ctype: number;
    cspeedType: number;
    start: Point3;
    end: Point3;
    /** Distance before the end at which the truck starts slowing (ft). */
    decPoint: number;
    /** Target speed, ft/s: the next arc's corner speed once built. */
    speed: number;
    speedLimit: number;
    trackWidth: number;
    lastEntry: boolean;
}
export interface CourseArc {
    ctype: 2;
    cspeedType: 1;
    /** Centre x, ground height there, z. */
    centre: Point3;
    /** Headings from the centre (atan2(dx, dz)) of the arc's start and end. */
    entryAngle: number;
    exitAngle: number;
    radius: number;
    decPoint: number;
    speed: number;
    /** Bank angle, rad (positive: the outside is higher). */
    bank: number;
    lastEntry: boolean;
}
export type CourseSegment = CourseStraight | CourseArc;
export declare function isArc(s: CourseSegment): s is CourseArc;
/** Ground height in feet at (x, z), including box and ramp tops. */
export type GroundHeightFn = (x: number, z: number) => number;
export interface CourseBuildOptions {
    /** The level's track is named "Sonic": corner speeds use k = 0.75. */
    sonicTrack?: boolean;
    /** The tire grip factor K in the corner speed law. */
    gripK?: number;
}
/** The game's angle wrap to [-π, π]. */
export declare function wrapAngle(a: number): number;
/**
 * Where lines AB and CD cross in x and z (0x468ee0), y = 0. Parallel lines give non-finite
 * values, as in the game. When either line has no extent in x, the game takes a shortcut that
 * lands on the crossing only when the far line's parameter comes out negative; it is kept.
 */
export declare function lineIntersection(a: Point3, b: Point3, c: Point3, d: Point3): Point3;
/**
 * One arc (0x487c60): `from` and `to` are the ends of the two legs, `corner` the point they
 * meet. `farSide` is the sharp-turn flag; `fillet` false is the touching-straights case.
 */
export declare function buildArc(from: Point3, corner: Point3, to: Point3, farSide: boolean, fillet: boolean, ground: GroundHeightFn, options?: CourseBuildOptions): CourseArc;
/** The arc that joins straight `s` to straight `t` (0x4e13b0's choice of case and flag). */
export declare function arcBetween(s: CourseStraight, t: CourseStraight, ground: GroundHeightFn, options?: CourseBuildOptions): CourseArc;
/** Straights as the SIT reader gives them, in feet. */
export interface SitStraightInput {
    startFt: readonly number[];
    endFt: readonly number[];
    ctype: number;
    cspeedType: number;
    cdecPoint: number;
    cspeed: number;
    speedLimit: number;
    trackWidthFt: number;
}
/**
 * The driven course from the SIT straights: straight, arc, straight, arc..., index 0 being
 * segment number 1.
 */
export declare function buildCourse(straights: readonly SitStraightInput[], ground: GroundHeightFn, options?: CourseBuildOptions): CourseSegment[];
/**
 * The course as driven. On a reversed course (`0x647564`, MTM2_PHYSICS.md 14.22) each segment
 * is turned round for the autopilot: a straight's start and end swap, an arc's entry and exit
 * angles swap, and segment 1 takes the speed of the last segment.
 */
export declare function orientedCourse(course: readonly CourseSegment[], reversed?: boolean): readonly CourseSegment[];
/**
 * The segment the autopilot moves on to: the next, the first after the last entry; on a
 * reversed course the one before, the last one from the first.
 */
export declare function nextSegmentIndex(course: readonly CourseSegment[], i: number, reversed?: boolean): number;
