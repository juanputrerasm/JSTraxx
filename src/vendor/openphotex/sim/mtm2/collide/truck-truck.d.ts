import { type Mtm2Rules } from "../constants.ts";
import type { Mtm2TruckParams } from "../truck/params.ts";
import type { Mtm2TruckState } from "../truck/state.ts";
type V3 = [number, number, number];
export interface TruckBody {
    s: Mtm2TruckState;
    p: Mtm2TruckParams;
}
/** What two trucks met with in a step: their hulls, their tires, both or neither. */
export interface TruckContact {
    hull: boolean;
    wheels: boolean;
}
/**
 * The pair test of two trucks (§14.20). `a` is the pair's first truck. Pair forces go to each
 * truck's `extForce` / `extMoment`; the faster truck is moved out of the slower one. Returns what
 * met (for a host's sounds and effects).
 */
export declare function collideTrucks(a: TruckBody, b: TruckBody, dt: number, rules?: Mtm2Rules): TruckContact;
/**
 * The velocity a wheel contact's force is made from, in A's axes. MTM2: half the relative
 * velocity. MTM1: axis by axis, the larger in magnitude of the two points' velocities (B's on a
 * tie), replaced by the relative velocity when that is smaller in magnitude.
 */
export declare function impactVelocity(vA: ArrayLike<number>, vB: ArrayLike<number>, rel: ArrayLike<number>, rules: Mtm2Rules): V3;
export {};
