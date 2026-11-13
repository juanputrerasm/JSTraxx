import type { WflFall } from "../../mtm/wfl.ts";
import type { Mtm2Heights } from "../../mtm/heights.ts";
import type { SitFog } from "../../mtm/sit.ts";
/** Column spacings tried in order, ft (12.2.2). */
export declare const FALL_SPACINGS_FT: readonly number[];
/** A spacing with more columns than this has none (12.2.2). */
export declare const FALL_MAX_COLUMNS = 1100;
/** Floats per vertex (64 bytes). */
export declare const FALL_VERTEX_FLOATS = 16;
/** Vertex budget of one fall (12.1.5). */
export declare const FALL_MAX_FALL_VERTICES = 16384;
/** The track's vertex buffer (16 MiB of 64-byte vertices) and index buffer (6 MiB of u32). */
export declare const FALL_MAX_TRACK_VERTICES = 262144;
export declare const FALL_MAX_TRACK_INDICES = 1572864;
/** Falls built at most (and records accepted at most). */
export declare const FALL_MAX_BUILT = 64;
/** Rows a column walk can emit: row 0, 4000 steps, the sink. */
export declare const FALL_MAX_ROWS = 4002;
/** The walk's constants (12.2.4, 12.2.5, 12.2.7). */
export declare const FALL_WALK: {
    readonly dt: number;
    /** Added to vy each step after the move (-32 ft/s^2 * dt). */
    readonly gravityPerStep: number;
    readonly steps: 4000;
    /** The sheet stays this far above the ground when draped. */
    readonly drapeFt: 0.3;
    /** Every component of v, each draped step. */
    readonly drag: 0.98;
    /** Not draped: air 1 when higher than this above the drape height. */
    readonly airGapFt: 0.05;
    /** Comes to rest when draped, the ground normal's y above cos 5 deg and |v| below this. */
    readonly restCos: 0.9961947;
    readonly restSpeedFtPerSec: 2;
    /** The trim's "flat contact": air 0 and the ground normal's y above cos 10 deg. */
    readonly flatCos: 0.9848078;
    /** The trim keeps this much path past where the water got within `trimRiseFt` of its final height. */
    readonly trimPathFt: 8;
    readonly trimRiseFt: 1;
    /** The sink vertex goes this far below the water row. */
    readonly sinkFt: 4;
    /** Speed smoothing: prev * exp(-chord / this). */
    readonly speedDecayFt: 8;
    /** The end fade on a column without a sink: (path left) / this. */
    readonly endFadeFt: 6;
};
/** The vertex layout as the shader reads it (12.0.1, 12.2.7): float offsets. */
export declare const FALL_VERTEX: {
    readonly posX: 0;
    readonly posY: 1;
    readonly posZ: 2;
    readonly u: 3;
    readonly tau: 4;
    readonly speed: 5;
    readonly air: 6;
    readonly edge: 7;
    readonly end: 8;
    readonly kind: 9;
    readonly fall: 10;
    readonly drop: 11;
    readonly normalX: 12;
    readonly normalY: 13;
    readonly normalZ: 14;
    readonly path: 15;
};
/** Vertex positions are in this many units a foot, relative to the fall's anchor. */
export declare const FALL_VERTEX_UNITS_PER_FT = 256;
/** Column end kinds (12.2.4): 1 water, 2 at rest on the ground, 3 out of steps. */
export declare const FALL_END_WATER = 1;
export declare const FALL_END_REST = 2;
export declare const FALL_END_LIMIT = 3;
/** The record flags (12.1.2). */
export declare const FALL_FLAG_FREEZE = 1;
export declare const FALL_FLAG_SPLASH = 2;
export declare const FALL_FLAG_SOUND = 4;
/** The weather that is Snow (FREEZE stops sound, mist snow bit, droplets, rings; look 3). */
export declare const FALL_WEATHER_SNOW = 5;
/** Terrain height in feet at world feet (x, z); x and z may be unwrapped. */
export type FallGround = (x: number, z: number) => number;
/** The water surface in feet at (x, z) for a fall of lake `source` (0 a spring), or null for none. */
export type FallWater = (x: number, z: number, source: number) => number | null;
/** The loaded lake table and tile map (a parsed .WTR fits): the lakes the WTR loader kept. */
export interface FallLakes {
    lakes?: ReadonlyArray<{
        id: number;
        height: number;
    }>;
    tileMap?: Uint8Array | null;
}
/**
 * The engine's ground for the walk (12.2.3): terrain only, the integer triangle rule. Classic (8 or 16-bit) on the
 * 256 x 256 corners at 32 ft, spline and Full Map on the 1024 x 1024 grid at 8 ft; heights as the engine holds them
 * (v >> 1 at 1/64 ft, times 4), the fraction in 16.16, `(a * b) >> 16` per edge, the parity split. Feet in, feet out.
 */
export declare function fallGround(heights: Pick<Mtm2Heights, "mode" | "coarse" | "fine">): FallGround;
/**
 * Terrain height in feet at (x, z) on a grid of `cells` x `cells` corner heights in 1/64 ft (rows along z): 256 for
 * the classic 32 ft grid, 1024 for the 8 ft fine grid (12.2.3).
 */
export declare function fallTerrainHeight(corners: ArrayLike<number>, cells: 256 | 1024, x: number, z: number): number;
/**
 * The walk's water (12.2.3): the 32 ft tile's lake, unless the tile is dry or the fall's own source lake, where the
 * track's .LVL water counts instead, and none when that is below 1/256 ft (or absent). `lvlWaterFt` is the .LVL
 * `!waterHeight` in feet (the raw value * 0.5). A tile naming a lake not in `lakes` (one the WTR loader refused) has
 * no water.
 */
export declare function fallWater(wtr: FallLakes | null, lvlWaterFt: number | null): FallWater;
/**
 * The engine parser's status (12.1.2): 0 read, 1 empty file, 2 bad magic, 3 truncated header, 4 a major other than
 * 1 (the "needs a newer build" message), 5 a directory past the end, 6 another terrain size, 7 no usable FALL list.
 */
export type FallFileStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** The status texts the "damaged (%s)" message names (12.1.3); 0 and 4 have their own messages. */
export declare const FALL_FILE_STATUS_TEXT: Readonly<Record<FallFileStatus, string>>;
/** The directory and chunk counters, which never raise "skipped" (12.1.3). */
export interface FallFileCounters {
    unknown: number;
    duplicate: number;
    outOfBounds: number;
    badVersion: number;
    badStride: number;
    truncated: number;
}
export interface FallFile {
    status: FallFileStatus;
    major: number;
    minor: number;
    stride: number;
    counters: FallFileCounters;
    /**
     * Every record in the (clamped) count, as parseWfl shapes them, for `checkFallRecords` / `buildFallMeshes`: a point
     * count outside 2..8 keeps that many placeholder points (the record is rejected before its coordinates are read), and
     * a name without a NUL in its 16 bytes keeps all 16 characters (badName).
     */
    falls: WflFall[];
}
/**
 * Read a .WFL as the engine's parser does (12.1.2), which differs from Traxx's reader (`parseWfl`) on damaged files:
 * the status codes of the on-screen messages, only the first FALL entry considered, the record count clamped to the
 * chunk (truncated), and bad records left to the record checks instead of refusing the file. Never throws.
 */
export declare function readFallFile(bytes: Uint8Array): FallFile;
export type FallRecordError = "badId" | "dupId" | "badPoints" | "badCoord" | "badSpeed" | "badHeight" | "badFlags" | "badName" | "over";
export type FallRecordCounters = Record<FallRecordError, number>;
export type FallRefusal = "FALL_POINTS" | "FALL_TURN" | "FALL_WIDTH" | "FALL_SOURCE" | "FALL_HEIGHT" | "FALL_DIRECTION";
/** A record as the engine keeps it: parseWfl's fall with opacity, mist and volume clamped. */
export type FallRecord = WflFall;
export interface FallRecordCheck {
    /** Accepted records, in file order, clamped; `index` is the position in the input. */
    accepted: Array<{
        index: number;
        fall: FallRecord;
    }>;
    rejected: Array<{
        index: number;
        id: number;
        reason: FallRecordError;
    }>;
    counters: FallRecordCounters;
}
/**
 * The parser's record checks (12.1.2) in its order: id 1..255, unique (marked used before the later checks), 2..8
 * points, coordinates below 0x20000, speed 16..1600, height 1..4096, no flag above bit 2, names that fit 15
 * characters, at most 64 accepted. parseWfl already refuses a point count outside 2..8 and more than 64 records; a
 * stem without a NUL in its 16 bytes cannot reach here from parseWfl, so badName only catches a longer name passed in.
 */
export declare function checkFallRecords(falls: readonly WflFall[]): FallRecordCheck;
/**
 * The loader's per-fall validation (12.1.4), in its order; null when the fall may be built. Springs (source 0) skip
 * SOURCE, HEIGHT and DIRECTION. `lakes` are the loaded WTR bodies (a refused lake has no entry), `tileMap` the TMAP.
 */
export declare function validateFall(fall: Pick<WflFall, "points" | "source" | "height">, ctx?: FallLakes): FallRefusal | null;
export interface FallDebugColumn {
    /** Arc position along the crest (the vertex u), start position and flow dir, ft. */
    s: number;
    x: number;
    z: number;
    fx: number;
    fz: number;
    end: number;
    /** Every emitted row, ft (unwrapped), t in s, raw speed, air, chord path. */
    rows: Array<{
        x: number;
        y: number;
        z: number;
        t: number;
        speed: number;
        air: number;
        path: number;
    }>;
    /** Rows the trailing-flat trim keeps (all of them on a water column). */
    keptRows: number;
}
/**
 * Re-walk every column of a fall at one spacing (as waterfallDebug does, 12.1.6): the rows of the count pass before
 * the row cut, with the trim's verdict. Null when the spacing has no columns.
 */
export declare function fallDebugColumns(fall: Pick<WflFall, "points" | "source" | "height" | "speed">, spacing: number, opts: Pick<FallBuildOptions, "ground" | "water">): FallDebugColumn[] | null;
export interface BuiltFall {
    /** Build slot 0..63 (the vertex `fall` field). */
    slot: number;
    /** Position of the record in the input list. */
    index: number;
    id: number;
    source: number;
    flags: number;
    /** The anchor, crest point 0 at the crest height: ft, and the engine's ints in 1/256 ft (x0 * 16, height * 128, z0 * 16). */
    anchorFt: [number, number, number];
    anchor: [number, number, number];
    firstVertex: number;
    vertexCount: number;
    sheetVertexCount: number;
    foamVertexCount: number;
    /** Into the track's index buffer; the indices are global (the fall's vertex base added). */
    firstIndex: number;
    indexCount: number;
    spacing: number;
    shortened: boolean;
    /** The row cut R when shortened, else null. */
    rowLimit: number | null;
    columns: number;
    /** Fewest and most vertices written in a column (sink included). */
    rowsMin: number;
    rowsMax: number;
    /** Columns that ended in water (kept or cut by R), at rest, out of steps. */
    ends: {
        water: number;
        rest: number;
        limit: number;
    };
    /** Vertex units (1/256 ft, anchor-relative), foam included. */
    bounds: {
        min: [number, number, number];
        max: [number, number, number];
    };
    /** ft, unwrapped; (dirX, dirZ) the landing direction. */
    landing: {
        x: number;
        y: number;
        z: number;
        width: number;
        drop: number;
        dirX: number;
        dirZ: number;
    };
    crestLengthFt: number;
    crestSpeedFtPerSec: number;
    crestYFt: number;
    opacity: number;
    mist: number;
    volume: number;
    mistDepth: number;
    mistHeight: number;
    soundName: string;
    textureName: string;
    /** The per-fall droplet RNG seed, id * 0x3c6ef362 + 0x9e3779b1 (u32). */
    rngSeed: number;
}
export interface FallBuildOptions extends FallLakes {
    ground: FallGround;
    water: FallWater;
}
export interface FallMeshes {
    /** 16 floats a vertex (FALL_VERTEX), every built fall, one track buffer. */
    vertices: Float32Array;
    /** u32 triangle list over `vertices`. */
    indices: Uint32Array;
    falls: BuiltFall[];
    /** Records the parser drops (12.1.2). */
    rejected: FallRecordCheck["rejected"];
    counters: FallRecordCounters;
    /** Falls the validation refuses (12.1.4). */
    refused: Array<{
        index: number;
        id: number;
        reason: FallRefusal;
    }>;
    /** Falls the budget leaves out (12.1.5); `left` is the vertex budget that was left. */
    dropped: Array<{
        index: number;
        id: number;
        left: number;
    }>;
    /** "Some of this track's waterfalls were skipped." (any record counter, or a refusal) */
    skipped: boolean;
    /** "Some of this track's waterfalls were too big and were left out." (a drop) */
    tooBig: boolean;
}
/**
 * The loader's build (12.1.5, 12.2): the record checks, the validation, then each accepted fall in order into one
 * track vertex and index buffer, at the first spacing that fits its budget, or shortened at the coarsest.
 */
export declare function buildFallMeshes(falls: readonly WflFall[], opts: FallBuildOptions): FallMeshes;
/** Fog volume slots, shared by the .SIT fog volumes (type 14) and the falls' mist. */
export declare const FOG_VOLUME_SLOTS = 64;
/** All nine weathers, and without Snow (bit 5) for a FREEZE fall. */
export declare const FALL_MIST_WEATHER_ALL = 511;
export declare const FALL_MIST_WEATHER_NO_SNOW = 479;
/** A mist volume may be added while the SIT volumes plus the mist volumes so far are below 64. */
export declare function fallMistSlotFree(sitFogVolumes: number, mistVolumes: number): boolean;
export interface FallMist {
    density: number;
    /** Box size, ft: W across the landing, L along it, H tall. */
    widthFt: number;
    lengthFt: number;
    heightFt: number;
    /** Centre x, z in [0, 8192) and the floor y, ft. */
    centre: [number, number];
    floorFt: number;
    /** Unit horizontal axes of W and L. */
    axisW: [number, number];
    axisL: [number, number];
    /** The fog parameters, as a SIT fog record (base 0: the floor is `floorFt`). */
    fog: SitFog;
}
type MistRecord = Pick<WflFall, "mist" | "mistDepth" | "mistHeight" | "flags">;
/** A built fall's mist fog volume (12.4), or null when it has none. `waterfallMistPct` is `[Graphics] waterfallMist`. */
export declare function fallMist(fall: BuiltFall, record?: MistRecord, opts?: {
    waterfallMistPct?: number;
}): FallMist | null;
/** Every built fall's mist in build order, with the 64 shared slots: `noSlot` lists falls that found none. */
export declare function fallMists(falls: readonly BuiltFall[], opts?: {
    sitFogVolumes?: number;
    waterfallMistPct?: number;
}): {
    mists: Array<{
        slot: number;
        mist: FallMist;
    }>;
    noSlot: number[];
};
/** The track's looping-sound table, shared with the SIT continuous sounds; the room left is the caller's. */
export declare const FALL_SOUND_LOOP_ROOM = 30;
/** The engine's default sound range (the falloff's R). */
export declare const FALL_SOUND_RANGE = 1000;
export type FallSound = {
    silent: null;
    stem: string;
    file: string;
    position: [number, number, number];
    volume: number;
    hearing: number;
} | {
    silent: "no-sound-flag" | "no-stem" | "frozen";
};
/**
 * A built fall's looping sound (12.7): the landing point, wrapped, its volume and hearing. Silent without the SOUND
 * flag (no log line), with an empty stem (there is no default roar) and, with `snow`, on a FREEZE fall.
 */
export declare function fallSound(fall: BuiltFall, record?: Pick<WflFall, "flags" | "soundName" | "volume">, opts?: {
    snow?: boolean;
}): FallSound;
/** The continuous-sound falloff at distance d: volume * (1 - sqrt(d) / (sqrt(R) * hearing)), 0 from R on. */
export declare function fallSoundGain(volume: number, hearing: number, d: number, range?: number): number;
/** The four looks (12.0.1, 12.8.3). */
export declare const FALL_LOOK_ORIGINAL = 0;
export declare const FALL_LOOK_ENHANCED = 1;
export declare const FALL_LOOK_REALISTIC = 2;
export declare const FALL_LOOK_ICE = 3;
/** gpuWaterfallsAvailable bits: 1 draws at all, 4 has the ice look. */
export declare const FALL_GPU_DRAW = 1;
export declare const FALL_GPU_ICE = 4;
/**
 * The look of a fall (12.8.3): ice when Snow, FREEZE and the DLL has the ice bit; else the water mode, waterRealism
 * before enhancedWater. Null when the DLL cannot draw falls (bit 0).
 */
export declare function fallLook(o: {
    waterRealism: boolean;
    enhancedWater: boolean;
    weather: number;
    flags: number;
    gpu: number;
}): number | null;
/** The default texture (12.8.1): the retail ripple, RIPPL100 .. RIPPL800 .. RIPPL200, 14 frames ping-pong. */
export declare const FALL_RIPPLE_FRAMES: readonly string[];
/** A ripple frame lasts 16384 ticks (0.25 s); it does not advance in Snow or in the mirror passes. */
export declare const FALL_RIPPLE_FRAME_TICKS = 16384;
export declare const FALL_RIPPLE_FRAME_SEC = 0.25;
/** The ripple frame name after `seconds` of advancing clock. */
export declare function fallRippleFrame(seconds: number): string;
/** A custom texture stem without a '.' gets ".RAW" (12.8.2). */
export declare function fallTextureName(stem: string): string;
/** The `[Graphics]` keys the falls read, with their defaults (12.0.1, 12.1.1, 12.4, 12.5). */
export declare const FALL_GRAPHICS_DEFAULTS: {
    readonly waterfalls: 1;
    readonly waterBodyLog: 0;
    readonly waterfallDebug: 0;
    readonly waterfallMist: 100;
    readonly waterfallDroplets: 100;
    readonly wfRingDecay: 15;
    readonly wfRingStrength: 100;
    readonly wfChurn: 100;
    readonly wfEdge: 100;
    readonly wfLift: 40;
    readonly wfDepthPull: 4;
    readonly wfFoam: 100;
};
export {};
