/** The most records the game's ring holds. */
export declare const REPLAY_RING_RECORDS = 2240;
/** The record interval, in the file's time unit (1/65536 s): 0.25 s. */
export declare const REPLAY_FRAME_TICKS = 16384;
export declare const REPLAY_TICKS_PER_SECOND = 65536;
/** The heading of the extension block after the counted records (see the top of this file), and its version. */
export declare const REPLAY_SAMPLES_HEADING = "OpenMTM2 samples";
export declare const REPLAY_SAMPLES_VERSION = 1;
/** A vehicle's pose between two records (the extension block). */
export interface MtmReplaySample {
    /** In 1/65536 s. */
    time: number;
    number: number;
    ipos: [number, number, number];
    angles: [number, number, number];
    steering: [number, number];
    tires: [number, number, number, number];
    throttle: number;
    /** ft/s. */
    speed: number;
}
export interface MtmReplayVehicle {
    truck: string;
    driver: string;
}
export interface MtmReplayRecord {
    /** 0 a vehicle, 1 a moving object, 2 a top-crush object (MONSTER_EXE_ANALYSIS.md, "Instant replay"). */
    type: 0 | 1 | 2;
    /** In 1/65536 s. */
    time: number;
    ipos: [number, number, number];
    /** Velocity in body axes. */
    bvel: [number, number, number];
    /** theta (pitch), phi (roll), psi (yaw). */
    angles: [number, number, number];
    /** Angular rates p, q, r in body axes. */
    rates: [number, number, number];
    /** The vehicle's number (0 is the player), or the object's index in the SIT's boxes. */
    number: number;
    /** Vehicles only. */
    steering?: [number, number];
    tires?: [number, number, number, number];
    throttle?: number;
    brakeFront?: number;
    brakeRear?: number;
    course?: number;
    damageCode?: number;
    gear?: number;
}
export interface MtmReplay {
    level: string;
    weather: number;
    detailLevel: number;
    vehicles: MtmReplayVehicle[];
    /** Where each SIT object started: x, y, z, theta, phi, psi. */
    objects: [number, number, number, number, number, number][];
    records: MtmReplayRecord[];
    /** The extension block's samples, oldest first (none in a file the game wrote). */
    samples?: MtmReplaySample[];
}
/** Read a replay; null when it is not one (no `demoLevel` header). */
export declare function parseMtmReplay(input: Uint8Array | string): MtmReplay | null;
/** The file's text for a replay, CRLF lines as the game writes. */
export declare function writeMtmReplay(replay: MtmReplay): string;
