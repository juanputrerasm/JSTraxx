import { type CourseSegment } from "../world/course.ts";
import type { Mtm2TruckParams } from "./params.ts";
import type { Mtm2TruckState } from "./state.ts";
import { type TrafficTruck } from "./traffic.ts";
/** The game's angle wrap: `a - trunc(a / 2 pi) 2 pi`, then into [-pi, pi]. */
export declare function wrapGame(a: number): number;
/** The game's heading, `atan2(dx, dz)`, with its special cases for a zero component. */
export declare function headingOf(dx: number, dz: number): number;
export interface AutopilotContext {
    course: readonly CourseSegment[];
    /** The height query with box and ramp tops (`0x550090`). */
    height(x: number, z: number): number;
    dt: number;
    /**
     * The frame time the game's frame-dependent autopilot terms assume (the steering command, the
     * air integrator, the look-ahead and the speed controller all scale with the frame time); the
     * port's fixed step is shorter. Defaults to AUTOPILOT_FRAME_DT.
     */
    frameDt?: number;
    /** 0 Rookie, 1 Intermediate, 2 Professional. */
    difficulty: number;
    /** The SIT's `Sonic` flag (§6.5). */
    sonicTrack?: boolean;
    /** Drag mode: no 17 ft/s floor, rear steer x1.25. */
    dragMode?: boolean;
    /** The course is driven the other way round (GOLD mode, `0x647564`). */
    reversed?: boolean;
    /** Rubber-banding (§14.23): this truck's place, and whether it is a CPU truck while the player is not first. */
    place?: number;
    rubberBand?: boolean;
    /** Every truck in the race, this one included, for traffic (§14.25); none, no traffic. */
    traffic?: readonly TrafficTruck[];
}
/**
 * **Hypothesis** (MTM2_PHYSICS.md 14.22): the game was tuned at about 30 frames per second, and
 * the autopilot's frame-dependent terms use that frame time rather than the port's step.
 */
export declare const AUTOPILOT_FRAME_DT: number;
/** The average of the four tires' forward speeds (`v_fwd`, tire +0x50), ft/s. */
export declare function tireForwardSpeed(s: Mtm2TruckState, p: Mtm2TruckParams): number;
/**
 * The estimated time to the end of the truck's segment (`0x480ba0`, §14.24): on a straight,
 * accelerating then braking into the next corner's speed; on an arc, the arc left at the
 * current speed.
 */
export declare function segmentEta(s: Mtm2TruckState, p: Mtm2TruckParams, seg: CourseSegment, height: (x: number, z: number) => number): number;
/**
 * The next segment (§14.23): when the truck is closer to the segment's end line than its
 * `cdec_point`, it moves on. Returns whether it did. With the truck's parameters, the time to
 * the new segment's end is set too (§14.24).
 */
export declare function advanceAutopilotSegment(s: Mtm2TruckState, ctx: AutopilotContext, p?: Mtm2TruckParams): boolean;
/**
 * The autopilot's controls for this step (§14.22): steering, then throttle and brakes, written
 * into `s.controls`. Run at the start of the step, before `stepTruck`.
 */
export declare function applyAutopilot(s: Mtm2TruckState, p: Mtm2TruckParams, ctx: AutopilotContext): void;
