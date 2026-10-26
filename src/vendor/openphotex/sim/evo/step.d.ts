import { type StepContext } from "../mtm2/truck/dynamics.ts";
import { type ContactResult } from "../mtm2/truck/contacts.ts";
import { type Mtm2TruckState } from "../mtm2/truck/state.ts";
import type { EvoTruckParams } from "./params.ts";
export interface EvoState {
    /** Wheelspin per tire, FR, FL, RR, RL (tire +0x11c). */
    slip: number[];
    /** Centre split offsets and the live split, front and rear. */
    splitOffset: number[];
    split: number[];
    /** Differential shares per axle, [left, right]. */
    shares: number[][];
    /** The rpm the engine takes in Neutral (+0x688) and the live torque (+0x5d4). */
    neutralRpm: number;
    torque: number;
    /** Transfer case: 0 two-wheel drive, 1 4WD High, 2 4WD Low (+0x1240). */
    transfer: number;
    /** The handbrake (+0x1244). */
    handbrake: boolean;
    /** The effective final ratio of this step (+0x6c8). */
    finalRatio: number;
}
export type EvoTruckState = Mtm2TruckState & {
    evo: EvoState;
};
/** A vehicle at `pos` facing `heading`, in `gear`, with its Evo state. */
export declare function createEvoTruckState(pos: ArrayLike<number>, heading: number, gear: number, p: EvoTruckParams): EvoTruckState;
/** The grip setup (§3.1): each tire's CF this step, FR, FL, RR, RL. */
export declare function evoTireCF(s: EvoTruckState, p: EvoTruckParams): number[];
/** Advance one vehicle by `dt`. The controls must already be set; collisions and the post-step come after. */
export declare function stepEvoTruck(s: EvoTruckState, p: EvoTruckParams, ctx: StepContext, dt: number): ContactResult;
/** The forward gear (1 = first) the gauges show, or 0 in Park, Reverse and Neutral. */
export declare function evoForwardGear(gear: number): number;
