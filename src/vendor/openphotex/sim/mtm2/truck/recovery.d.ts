import type { Mtm2Ground } from "../world/ground.ts";
import { type CourseSegment } from "../world/course.ts";
import type { Mtm2TruckParams } from "./params.ts";
import type { Mtm2TruckState } from "./state.ts";
export declare const STUCK_LIMIT_S = -5;
export declare const STUCK_SPEED = 15;
export declare const RESET_LIFT_FT = 10;
export declare const FLIGHT_S = 15;
export declare const FLIGHT_QUEUE_S = 5;
export declare const CARRY_S = 10;
export declare const HOVER_RATE = 5;
export declare const HOVER_DESCENT_S = 4;
export declare const HELI_KEY_TIMER = -15;
export declare const HELI_IDLE_RPM = 800;
/** What the race tells the stuck checks about one truck (§10.3). */
export interface RecoveryContext {
    /** The race clock runs and the game is not paused. */
    racing: boolean;
    /** The player's own truck (the reset applies to it). */
    player: boolean;
    /** Driven by the autopilot (CPU trucks, or the player on Full Autopilot). */
    autopilot: boolean;
    difficulty: number;
    /** Summit Rumble: no course, so the reset and lift keep the heading and position. */
    summit: boolean;
    /** A drag race before 3 course segments: the checks wait. */
    dragGated?: boolean;
    /** The truck's current course segment and the one before it, when there is a course. */
    segment: CourseSegment | null;
    previous: CourseSegment | null;
    /** Other trucks in flight on the same segment (each adds 5 s to a lift). */
    othersInFlight?: number;
    /** +0x17a8: a Professional CPU truck lifts off instead of being reset in place. */
    proLift?: boolean;
}
export type RecoveryAction = "reset" | "lift" | "cpuReset" | null;
/** The truck's radius (+0xfb8): to the outer edge of the front right tire. */
export declare function truckRadius(p: Mtm2TruckParams): number;
/**
 * The reset (0x46fd30): only while racing, with hull contacts and no wheel down. Returns whether
 * it happened. `contacts` is this step's hull contact count.
 */
export declare function resetTruck(s: Mtm2TruckState, rc: RecoveryContext, contacts: number): boolean;
/** The helicopter's carry rates, set at lift-off; per second, subtracted while carrying. */
export interface CarryRates {
    pitch: number;
    roll: number;
    heading: number;
    x: number;
    z: number;
}
/**
 * The lift-off (0x470190): while racing with hull contacts and no wheel down, or whenever the
 * stuck timer is below -5 s. Returns whether it happened.
 */
export declare function liftOff(s: Mtm2TruckState, p: Mtm2TruckParams, ground: Mtm2Ground, rc: RecoveryContext, contacts: number): boolean;
/** The Professional CPU reset (0x46f7b0): onto its segment's start, 10 ft up, facing along it. */
export declare function cpuResetTruck(s: Mtm2TruckState, rc: RecoveryContext): void;
/**
 * The stuck checks of the position integrator (§10.3), after the velocity update. `speed` is
 * the world speed, `contacts` this step's hull contact count, `atRest` whether the step zeroed
 * the velocity. Performs the reset or lift-off it decides on and returns which.
 */
export declare function updateStuck(s: Mtm2TruckState, p: Mtm2TruckParams, ground: Mtm2Ground, rc: RecoveryContext, speed: number, contacts: number, atRest: boolean, dt: number): RecoveryAction;
/**
 * One step of helicopter flight (0x46ed90), in place of the truck step while `heliTimer` is
 * positive.
 */
export declare function helicopterStep(s: Mtm2TruckState, ground: Mtm2Ground, dt: number): void;
/** The player's Helicopter key: call the helicopter, or drop the truck from it. */
export declare function pressHelicopterKey(s: Mtm2TruckState, rc: {
    dragRace: boolean;
    summit: boolean;
}): void;
