import type { Mtm2Ground } from "../world/ground.ts";
import type { Mtm2TruckState, TireState } from "./state.ts";
/** The surface value a tire held up by an object reads in place of water (Default). */
export declare const OBJECT_DRY_SURFACE = 0;
/**
 * Whether a tire on the ground is held up by an object rather than the terrain: its support source
 * (state.ts) is not the terrain's, or a ramp covers the point (ramps raise the ground's height).
 */
export declare function tireOnObject(t: Pick<TireState, "supportSource">, ground: Pick<Mtm2Ground, "ramps">, x: number, z: number): boolean;
/** A surface value for a tire held up by an object: water and deep water become Default, the rest is kept. */
export declare function objectSurfaceValue(value: number): number;
/** Whether a truck is in water for its sounds (retail 0x41bbd0, above); `weather` 5 is Snow. */
export declare function inWaterForSound(s: Mtm2TruckState, ground: Pick<Mtm2Ground, "waterLevelFt" | "waterLevelAt">, weather?: number): boolean;
