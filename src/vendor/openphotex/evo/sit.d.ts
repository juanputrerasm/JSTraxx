/** One scene placement, in Evo world units on Evo axes (x east, y up, z north). */
export interface EvoSitBox {
    sourceClass: string;
    schemaVersion: number | null;
    /** What a child's `parent` field refers to: v6 `Box N`, v7 the number in the opening brace. */
    instanceId: number | null;
    /** Velocity for moving boxes (x, height, z); null when absent. */
    bvel: number[] | null;
    name: string;
    modelName: string;
    position: number[];
    /** (pitch, roll, heading) in radians; the third component is the heading. */
    orient: number[];
    size: number[] | null;
    boxType: number | null;
    boxFlags: number | null;
    parent: number;
    timePerFrame: number;
    castShadowOnMe: boolean;
    /** v7: every labelled field of the instance, verbatim. Null for v6. */
    sourceFields: Record<string, string> | null;
}
/** One starting-grid vehicle. */
export interface EvoSitVehicle {
    name: string;
    position: number[];
    orient: number[];
    courseToFollow: number;
}
export interface EvoCourseSegment {
    start: number[];
    end: number[];
    speedLimit: number;
    trackWidth: number;
}
/** One point of an object path (`EvoPath`), as 4x42.exe reads it (0x4f2840). */
export interface EvoPathPoint {
    position: number[];
    /** (pitch, roll, heading) in radians, the box `orient` order. */
    orient: number[];
    /** The speed at the point, mph (the game turns it into ft/s at 1.46667). */
    vel: number;
    /** Seconds the segment from this point takes, when over 0. */
    time: number;
    /** Seconds the object stops at this point. */
    pauseTime: number;
    /** 0 a curve (a cardinal spline through the neighbours), 1 a straight segment to the next point. */
    segmentFlag: number;
    /** 1 turns the object from this point's orientation to the next's; 0 along its way. */
    orientFlag: number;
    /** 1 holds this point's speed over the segment; 0 blends to the next point's. */
    velFlag: number;
    /** 1 sets the object on the ground and turns it with the ground. */
    followTerrainFlag: number;
    animationFlag: number;
    lightFlag: number;
    AIFlag: number;
    /** A sound played at the point, and one played along the segment; "" for none (NULL.WAV). */
    pointWavName: string;
    continuousWavName: string;
}
/** An object path: one placement moved through its points (4x42.exe `CObjectPath`, 0x4f2840 read, 0x4f3680 stepped). */
export interface EvoPath {
    /** 0 runs `cycles` times and stops; 1 loops. */
    type: number;
    /** 0 forward round the points; 1 forward and back. */
    direction: number;
    cycles: number;
    /** Seconds the whole path takes, its pauses apart, when over 0. */
    time: number;
    pauseTimeElapsed: number;
    /** Where the object starts: the segment, and the fraction of it (the whole and the fractional part). */
    t: number;
    /** The spline's tension, 0 a Catmull-Rom curve. */
    tension: number;
    /** 1 holds the object until a script starts it (startPathObject). */
    stopFlag: number;
    collisionType: number;
    /** The box it moves, counted from 1 in the box list (0 for an unused path). */
    object: number;
    points: EvoPathPoint[];
}
/** A parsed Evo .SIT scene script. */
export interface EvoSit {
    sourceName: string;
    version: number;
    /** 1 for Evo 1 (v6), 2 for Evo 2 (v7 and later). */
    game: 1 | 2;
    lvlName: string;
    trackName: string;
    author: string;
    raceType: number;
    ambientSound: number | null;
    trackLength: number;
    weatherMask: number | null;
    logoName: string;
    boxes: EvoSitBox[];
    vehicles: EvoSitVehicle[];
    courses: {
        segments: EvoCourseSegment[];
    }[];
    /** The object paths (`#*** Paths ***`, a v7 .SIT's last section), unused ones (object 0) included, in file order. */
    paths: EvoPath[];
    warnings: string[];
}
/** True when the .SIT bytes are an Evo scene script rather than an MTM-family one. */
export declare function isEvoSit(bytes: Uint8Array): boolean;
/** The Evo generation a .SIT version belongs to: v6 is Evo 1, v7 and later are Evo 2. */
export declare function evoGameForSitVersion(version: number): 1 | 2;
export declare function parseEvoSit(bytes: Uint8Array, sourceName: string): EvoSit;
export declare function evoTrackTypeName(raceType: number): string;
