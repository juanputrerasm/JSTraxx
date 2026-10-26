import type { Mtm2Ground } from "../world/ground.ts";
import type { Mtm2TruckParams } from "./params.ts";
import type { Mtm2TruckState } from "./state.ts";
/** Speed above which entering water splashes, ft/s. */
export declare const SPLASH_SPEED = 14.67;
export interface FluidAreas {
    /** Density times area, per body axis. */
    rhoA: [number, number, number];
    /** Water was met fast enough to splash. */
    splash: boolean;
}
/**
 * A wheel's areas in water `depth` deep, `[side (x), under (y), front (z)]`; zero when dry.
 * The depth counts up to the wheel's diameter.
 */
export declare function wheelWaterAreas(depth: number, radius: number, width: number): [number, number, number];
/**
 * The submerged area of one hull face. `corners` are hull point numbers (1-12) in the game's
 * order, `axis` the body axis the face faces. Returns the area and the density at its first wet
 * corner (0 when dry).
 */
export declare function hullFaceWaterArea(s: Mtm2TruckState, ground: Mtm2Ground, corners: readonly [number, number, number, number], axis: number): {
    area: number;
    density: number;
};
/** `rhoA` per body axis for this step (§14.7.1). Tires are FR, FL, RR, RL. */
export declare function fluidAreas(s: Mtm2TruckState, p: Mtm2TruckParams, ground: Mtm2Ground): FluidAreas;
