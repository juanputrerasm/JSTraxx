import { type AutopilotContext } from "./autopilot.ts";
import type { Mtm2TruckParams } from "./params.ts";
import { type Mtm2TruckState } from "./state.ts";
export interface TrafficTruck {
    s: Mtm2TruckState;
    p: Mtm2TruckParams;
}
/**
 * Traffic for truck `s` this step (§14.25), given the segment heading `hs`, the clamped
 * correction `c` and the target speed of §14.22. Returns them, possibly changed, and updates
 * the truck's pass target, side and truck to follow.
 */
export declare function applyTraffic(s: Mtm2TruckState, p: Mtm2TruckParams, ctx: AutopilotContext, trucks: readonly TrafficTruck[], hs: number, c: number, target: number): {
    c: number;
    target: number;
};
