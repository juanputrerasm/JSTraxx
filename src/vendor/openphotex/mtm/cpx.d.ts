export declare const CPX_MAGIC = "MCPX";
export declare const CPX_HEADER = 32;
export declare const CPX_DIRENTRY = 16;
export declare const CPX_RULE_SIZE = 32;
/** The record header every chunk but RULE starts with: count, record size, 0. */
export declare const CPX_CHUNKHEAD = 8;
export declare const CPX_BOX_STRIDE = 24;
export declare const CPX_WALL_STRIDE = 48;
export declare const CPX_POINT_STRIDE = 24;
export declare const CPX_COURSE_STRIDE = 8;
/** 100 slots of 8 copies. */
export declare const CPX_MAX_BOXES = 800;
export declare const CPX_MAX_WALLS = 64;
export declare const CPX_MAX_POINTS = 8192;
export declare const CPX_MAX_COURSES = 5;
export declare const CPX_WALL_NAME_LEN = 32;
/** Positions, wall lengths and heights are in 1/256 ft. */
export declare const CPX_UNITS_PER_FT = 256;
/** psi is in 1/65536 of a turn. */
export declare const CPX_PSI_UNITS = 65536;
export declare const CPX_MODE_DRAG = 1;
export declare const CPX_MODE_PARALLEL = 2;
export declare const CPX_MODE_RACE = 3;
export declare const CPX_ROLE_PRESTAGE = 1;
export declare const CPX_ROLE_STAGE = 2;
export declare const CPX_ROLE_LAUNCH = 3;
export declare const CPX_ROLE_FINISH = 4;
export declare const CPX_ROLE_GATE = 5;
export declare const CPX_SPLIT_NONE = 0;
export declare const CPX_SPLIT_ANY = 1;
export declare const CPX_SPLIT_LANE = 2;
export declare const CPX_WALL_CLOSED = 1;
export declare const CPX_WALL_NOLINE = 2;
export declare const CPX_COURSE_FIRST_PASS = 1;
export interface CpxRule {
    mode: number;
    laps: number;
    timeoutMs: number;
    penaltyMs: number;
    rearmMs: number;
}
export interface CpxBox {
    slot: number;
    role: number;
    split: number;
    lane: number;
    /** The byte as stored; bit 0 is the ground line. */
    groundLine: number;
    /** 1/65536 turn. */
    psi: number;
    /** 1/256 ft: x, y (height) and z. */
    x: number;
    y: number;
    z: number;
}
export interface CpxWriteWall {
    /** At most 31 characters. */
    name: string;
    /** The wall's first point in the point list, and how many it has. */
    first: number;
    count: number;
    side: number;
    /** CPX_WALL_CLOSED | CPX_WALL_NOLINE, as stored. */
    flags: number;
    /** 1/256 ft. */
    thickness: number;
    height: number;
}
export interface CpxWall extends CpxWriteWall {
    closed: boolean;
    noline: boolean;
}
export interface CpxWallPoint {
    /** 1/256 ft. */
    x: number;
    z: number;
    baseY: number;
    bend: number;
    above: number;
    /** The byte as stored; bit 0 is the gap. */
    gap: number;
}
export interface CpxWriteCourse {
    course: number;
    /** CPX_COURSE_FIRST_PASS, as stored. */
    flags: number;
    thenCourse: number;
}
export interface CpxCourse extends CpxWriteCourse {
    firstPassOnly: boolean;
}
export interface CpxChunkEntry {
    id: string;
    version: number;
    offset: number;
    size: number;
}
/**
 * Why part of a .CPX could not be read. Stable identifiers, reported in `errors` and by the CLI.
 * The file-level codes (NOT_CPX, NEWER_MAJOR, DIRECTORY_CUT) leave nothing decoded; a chunk's
 * code leaves that chunk's field null.
 */
export type CpxErrorCode = 
/** Shorter than the header, or not "MCPX". */
"NOT_CPX"
/** A major version above 1. */
 | "NEWER_MAJOR"
/** The header size or the directory does not fit the file. */
 | "DIRECTORY_CUT"
/** No RULE entry, or no CPBX entry. */
 | "NO_RULE" | "NO_CPBX"
/** A chunk of a version this reader does not know (`value` is the version). */
 | "RULE_VERSION" | "CPBX_VERSION" | "WALL_VERSION" | "WPNT_VERSION" | "COUR_VERSION"
/** A chunk that runs past the end of the file or is smaller than its fixed part. */
 | "RULE_CUT" | "CPBX_CUT" | "WALL_CUT" | "WPNT_CUT" | "COUR_CUT"
/** A WALL entry with no WPNT entry. */
 | "WALL_WITHOUT_WPNT"
/** A record count over the format's cap (`value` is the count). */
 | "BOXES_OVER_CAP" | "WALLS_OVER_CAP" | "POINTS_OVER_CAP" | "COURSES_OVER_CAP"
/** A record size below the format's, or more records than the chunk holds. */
 | "BOX_LIST_CUT" | "WALL_LIST_CUT" | "POINT_LIST_CUT" | "COURSE_LIST_CUT";
export interface CpxDefect {
    code: CpxErrorCode;
    /** The chunk id, or null for the header and directory. */
    chunk: string | null;
    /** The number the code is about (a version or a count), else null. */
    value: number | null;
    message: string;
}
export interface Cpx {
    major: number;
    minor: number;
    headerSize: number;
    /** Every directory entry, in file order (unknown ids and duplicates included). */
    directory: CpxChunkEntry[];
    rule: CpxRule | null;
    boxes: CpxBox[] | null;
    boxStride: number;
    /** null when the file has no usable WALL chunk; [] for a WALL chunk of 0 walls. */
    walls: CpxWall[] | null;
    wallStride: number;
    points: CpxWallPoint[] | null;
    pointStride: number;
    courses: CpxCourse[] | null;
    courseStride: number;
    errors: CpxDefect[];
}
export interface CpxWriteInput {
    rule: CpxRule;
    boxes: readonly CpxBox[];
    /** WALL and WPNT are written only when there is at least one wall. */
    walls?: readonly CpxWriteWall[];
    points?: readonly CpxWallPoint[];
    /** COUR is written only when there is at least one course. */
    courses?: readonly CpxWriteCourse[];
}
export declare function isCpx(bytes: Uint8Array): boolean;
/**
 * Read a .CPX. Never throws: what cannot be read is listed in `errors` (stable codes) and its part
 * is null. Unknown chunks are skipped, the first entry of an id wins, record sizes come from the
 * file, and a defect in one chunk does not stop the others being read. Whether the map is valid for
 * its mode is not checked here.
 */
export declare function readCpx(bytes: Uint8Array): Cpx;
/**
 * Write a .CPX exactly as Traxx 1.8.2 lays one out: RULE, CPBX, then WALL and WPNT when `walls` is
 * not empty, then COUR when `courses` is not empty, contiguous after the directory, every other
 * byte 0. The records are written as given (the caller sorts, ranks and validates them); this
 * throws a RangeError only for what the file cannot hold.
 */
export declare function writeCpx(input: CpxWriteInput): Uint8Array;
