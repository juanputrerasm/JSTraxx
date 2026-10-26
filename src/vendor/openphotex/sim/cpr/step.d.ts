import { type StepContext } from "../mtm2/truck/dynamics.ts";
import { type ContactResult } from "../mtm2/truck/contacts.ts";
import { type Mtm2TruckState } from "../mtm2/truck/state.ts";
import type { Mtm2TruckParams, Triplet } from "../mtm2/truck/params.ts";
import type { CprSetup } from "../../cpr/garage.ts";
export interface CprSpec {
    setup: CprSetup;
    weightLb: number;
    inertia: Triplet;
    /** Wheel centres FR, FL, RR, RL and the 12 hull points, body feet (the `.CAR`). */
    wheelAnchors: Triplet[];
    scrapePoints: Triplet[];
}
/** The car's figures: the constructor's, its anchors and hull points, and a setup (the stock one when none). */
export declare function cprSpec(anchors: readonly Triplet[], scrapePoints: readonly Triplet[], setup?: CprSetup | null): CprSpec;
export interface CprTruckParams extends Mtm2TruckParams {
    cpr: {
        spec: CprSpec;
        /** Spring per wheel at the wheel (rate x installation ratio), FR, FL, RR, RL, lb/ft. */
        wheelRate: [number, number, number, number];
        /** Overall ratio of each forward gear, first to sixth. */
        gears: number[];
        /** The driving aids (`CprAids`). */
        aids: CprAids;
    };
}
/** MTM2's params shape (so collisions, the post-step, recovery and the autopilot work as they are) with CPR's figures beside it. */
/**
 * The driving aids the car model carries (CPR_PHYSICS.md 14.3): anti-lock brakes (always on for a computer car, 0x477ae0),
 * traction control (0x475580), and the player's grip by the Skill Level (0x5e7334: 1 on Rookie, 0.8 above) with the
 * Professional off-road grip (x0.4 on grass, dirt and rocks, 6.2).
 */
export interface CprAids {
    abs: boolean;
    tractionControl: boolean;
    gripScale: number;
    offroadGrip: number | null;
}
/** ABS holds a braked wheel at no less than 80% of its rolling speed above 10 ft/s (0x5b2500, 0x5b24f0). */
export declare const CPR_ABS_SLIP = 0.2, CPR_ABS_MIN_SPEED = 10;
/** Traction control: past 15% rear slip the rev limit falls to the rear wheels' rpm at 15% slip (0x5b20f8, 0x5b2108). */
export declare const CPR_TC_SLIP = 0.15;
export declare function createCprParams(spec: CprSpec, tire?: {
    radiusFt?: number | null;
    widthFt?: number | null;
}, setup?: {
    cpu?: boolean;
    autoShift?: boolean;
    difficulty?: number;
    aids?: Partial<CprAids>;
}): CprTruckParams;
export interface CprState {
    /** The rear axle's spin, rad/s, and each tire's slip ratio and combined slip, for the gauges and the effects. */
    slipRatio: number[];
    combinedSlip: number[];
    /** Tire temperatures, degrees above ambient (0..400, CPR_PHYSICS.md 6.3). */
    temperature: number[];
    /** Drag and downforce of the last step, lb. */
    drag: number;
    downforce: number;
    /** The draft factor (1 alone; the caller sets it from the car ahead with `cprDraft`). */
    draft: number;
}
export type CprTruckState = Mtm2TruckState & {
    cpr: CprState;
};
export declare function createCprTruckState(pos: ArrayLike<number>, heading: number, gear: number, p: CprTruckParams): CprTruckState;
/** The overall ratio of an MTM2 gear number (1 Park, 2 Reverse, 3 Neutral, 4 first...): six forward gears, reverse the game's -20. */
export declare function cprGearRatio(p: CprTruckParams, gear: number): number;
/**
 * Drag and downforce coefficients from the wings (CPR_PHYSICS.md 7: a body term plus each wing's angle x 0.05 x its slope,
 * plus the Gurney flaps), and the front axle's share of the downforce. The slopes and body terms are the port's, set for
 * about 3,000 lb of downforce and 225 mph flat out with the stock setup.
 */
export declare function cprAero(setup: CprSetup): {
    cd: number;
    cl: number;
    frontShare: number;
};
/** Advance one car by `dt`. The controls must already be set; collisions and the post-step come after, as MTM2's. */
export declare function stepCprTruck(s: CprTruckState, p: CprTruckParams, ctx: StepContext, dt: number): ContactResult;
/** The forward gear (1 = first) the gauges show, or 0 in Park, Reverse and Neutral. */
export declare const cprForwardGear: (gear: number) => number;
