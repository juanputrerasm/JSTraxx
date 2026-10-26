import { G } from "../constants.ts";
import type { Mtm2Ground } from "../world/ground.ts";
import type { Mtm2TruckParams } from "./params.ts";
import type { Mtm2TruckState, TireState } from "./state.ts";
import { type ContactResult } from "./contacts.ts";
import { type RecoveryContext } from "./recovery.ts";
export interface StepContext {
    ground: Mtm2Ground;
    /** A human driver (the torque gain and grip rules differ for computer trucks). */
    human: boolean;
    difficulty: number;
    sonicTrack: boolean;
    dragMode?: boolean;
    /** The race's view of this truck, for the stuck checks (§10.3); none means no checks. */
    recovery?: RecoveryContext;
}
/** Total weight, lb: body, both axles and the (zero in stock trucks) +0x5a0 term (§14.1). */
export declare function truckWeight(p: Mtm2TruckParams): number;
/** C(alpha) from the stored table (§5.3), with the game's lookup. */
export declare function lateralCoefficient(alpha: number): number;
/** Tire geometry (§14.2): hub, contact point and contact velocity, body axes. */
export declare function tireGeometry(s: Mtm2TruckState, p: Mtm2TruckParams, i: number): void;
/** The hold rule shared by both tire forces (§14.4). */
export declare function holdRule(current: number, slope: number, hold: number): number;
export interface TireFrame {
    vFwd: number;
    vLat: number;
    nb: [number, number, number];
    cd: number;
    sd: number;
}
export declare function tireFrame(s: Mtm2TruckState, t: TireState, steer: number): TireFrame;
/**
 * Advance one truck by `dt` (§14.1 steps 2-8). The controls must already be set; collision
 * forces and the post-step come after.
 */
export declare function stepTruck(s: Mtm2TruckState, p: Mtm2TruckParams, ctx: StepContext, dt: number): ContactResult;
/** Euler angle rates and the gimbal guard (§9.4); a box uses it too (§14.16). */
export declare function integrateOrientation(s: Pick<Mtm2TruckState, "rates" | "euler" | "matrix">, dt: number): void;
/** The ground probe of a body point (§14.10): depth (vertical, less the sink) and normal. */
export declare function probeGround(s: Mtm2TruckState, ground: Mtm2Ground, px: number, py: number, pz: number, offset: number): {
    depth: number;
    normal: [number, number, number];
    water: number;
    point: [number, number, number];
};
/** Contact probing at the end of the step (§14.10): tire contact points 13-16. */
export declare function probeContacts(s: Mtm2TruckState, p: Mtm2TruckParams, ground: Mtm2Ground): void;
/** The post-step (§14.11): axle reset, push-out, wheels and solid axles, bottoming. */
export declare function postStepTruck(s: Mtm2TruckState, p: Mtm2TruckParams, ground: Mtm2Ground, dt: number): void;
export { G };
