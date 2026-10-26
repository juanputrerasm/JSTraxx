import type { Vec3 } from "../math.ts";
import { type SimRamp } from "../collide/ramp.ts";
import { type Mtm2Terrain } from "./terrain.ts";
import { type Mtm2Rules } from "../constants.ts";
import { type Mtm2SurfaceMap } from "./surface.ts";
export interface Mtm2Ground {
    /** Ground height in feet under (x, z). */
    height(x: number, z: number): number;
    /** Upward unit ground normal at (x, z), into `out`. */
    normal(x: number, z: number, out: Vec3): Vec3;
    /** TTY value (`type * 100 + depth`) of the surface at a point. */
    surface(x: number, y: number, z: number): number;
    /** The water level in feet, or null. */
    waterLevelFt: number | null;
    /** Weather state 0..8. */
    weather: number;
    /** This frame's listed ramps, in list order; the caller keeps it up to date. */
    ramps: SimRamp[];
    /** Which game's rules apply (constants.ts); MTM2's when absent. */
    rules?: Mtm2Rules;
}
/** The grip factor of the ground's weather under its rules. */
export declare function groundWeatherGrip(ground: Mtm2Ground): number;
export declare function createTerrainGround(terrain: Mtm2Terrain, surface: Mtm2SurfaceMap | null, weather?: number, waterLevelFt?: number | null, rules?: Mtm2Rules): Mtm2Ground;
