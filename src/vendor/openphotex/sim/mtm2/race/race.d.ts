import { type SimBox } from "../collide/box.ts";
import { type AutopilotContext } from "../truck/autopilot.ts";
import type { Mtm2TruckParams } from "../truck/params.ts";
import { type RecoveryContext } from "../truck/recovery.ts";
import { type Mtm2TruckState } from "../truck/state.ts";
import type { Mtm2Ground } from "../world/ground.ts";
import { type CourseSegment } from "../world/course.ts";
import type { Mtm2Checkpoint } from "../world/checkpoints.ts";
import { type Summit } from "./summit.ts";
type V3 = [number, number, number];
/** The countdown before the start (§6.1), seconds. */
export declare const COUNTDOWN_S = 3;
export interface RaceTruck {
    s: Mtm2TruckState;
    p: Mtm2TruckParams;
    /** The player's truck (missed checkpoints are announced, not recovered). */
    player: boolean;
    /** The next checkpoint, an index into the race's checkpoints (+0xfa8). */
    checkpoint: number;
    /** Checkpoints passed in all (+0xfac) and course segments counted on passes (+0x8fc). */
    passed: number;
    passCount: number;
    /** Laps completed (+0x8f4); each lap's time (+0xf50); the race time over them (+0xfa4); the fastest (+0xfa0, 0 none). */
    laps: number;
    lapTimes: number[];
    raceTime: number;
    fastestLap: number;
    /** This lap's splits, each the time since the last checkpoint. */
    splits: number[];
    /** The lap the truck finishes on (the race's laps, or less once the race is over). */
    finishLap: number;
    finished: boolean;
    /** The last checkpoint result: 0 none, 2 pass, 3 miss (+0x908). */
    state: number;
    /** Progress in the current segment, 0..1 (+0x8c8), and the place (+0x8f8). */
    progress: number;
    place: number;
}
export interface Race {
    trucks: RaceTruck[];
    checkpoints: {
        gate: SimBox;
        detector: SimBox;
        psi: number;
    }[];
    course: readonly CourseSegment[];
    laps: number;
    /** The race clock (0x6f61d8) and the moment of the start (raceStartTime). */
    clock: number;
    startTime: number;
    /** The first truck has completed the laps (a Summit Rumble: the round has run out). */
    over: boolean;
    difficulty: number;
    /** Summit Rumble: the scoring state, and the round's length in seconds (§6.3); else null. */
    summit: Summit | null;
    roundSeconds: number;
}
/** The checkpoints as boxes: gate and detector (§6.2), with the checkpoint's heading. */
export declare function raceCheckpoints(cps: readonly Mtm2Checkpoint[]): Race["checkpoints"];
export declare function createRace(trucks: readonly {
    s: Mtm2TruckState;
    p: Mtm2TruckParams;
    player?: boolean;
}[], checkpoints: Race["checkpoints"], course: readonly CourseSegment[], laps: number, difficulty: number, mode?: "circuit" | "summit"): Race;
/** Whether the countdown has run out. */
export declare function raceStarted(race: Race): boolean;
/**
 * The checkpoint-mode hull test (§14.24 step 2): the deepest hull point that crossed the box's
 * back face (-z), with its depth and body point; null when none.
 */
export declare function backFaceCrossing(s: Mtm2TruckState, p: Mtm2TruckParams, box: SimBox, dt: number): {
    depth: number;
    point: V3;
} | null;
/** One truck's checkpoint test (§14.24); returns 2 on a pass, 3 on a miss, 0 otherwise. */
export declare function testCheckpoint(race: Race, t: RaceTruck, dt: number, recover?: {
    ground: Mtm2Ground;
    rc: RecoveryContext;
}): number;
/**
 * Progress in the current segment (+0x8c8, §14.24): 1 minus the share left, measured from the
 * hull's front point, or its rear point while passing.
 */
export declare function segmentProgress(t: RaceTruck, course: readonly CourseSegment[], difficulty: number): number;
/** How far from its segment's line a truck may stray, feet, and how far past its end, as a share of it (`0x486630`). */
export declare const OFF_COURSE_FT = 160, OFF_COURSE_PAST = 1.1;
/**
 * The off-course re-pick (§14.24, `0x486630`): a truck more than 160 ft from its segment's line, or
 * more than 10% past its end, is put on the arc whose centre is nearest it (x, z), then on the
 * straight before or after that arc when its progress there is below 0 or above 1. The segments it
 * moves by count as passed. Returns whether the segment changed.
 */
export declare function offCourseRepick(t: RaceTruck, course: readonly CourseSegment[], difficulty: number, reversed?: boolean): boolean;
/** The places of every truck (+0x8f8). */
export declare function raceOrder(race: Race): void;
/**
 * The race tick (§14.24), after the trucks have stepped: checkpoints, segments and progress for
 * each truck, then the order and the clock. `ap` is each truck's autopilot context (its course).
 */
export declare function raceTick(race: Race, dt: number, ap: AutopilotContext, recover?: {
    ground: Mtm2Ground;
    rc: (t: RaceTruck) => RecoveryContext;
}): void;
export {};
