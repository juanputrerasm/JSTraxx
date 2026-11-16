import { type Mtm2Terrain } from "../world/terrain.ts";
import type { SimBox } from "./box.ts";
/**
 * How a level's ground box grids count height: `stepFt` feet a step (2, MTM2's bytes) over `baseFt`. A track format
 * version 6 world (section 8.3) gives its terrainHeightBase, and a 16-bit layer 1 / terrainHeightStep.
 */
export interface GroundBoxScale {
    stepFt?: number;
    baseFt?: number;
}
/**
 * The height under (x, z) for a body whose centre is at `y` (`0x502350`): a ground box's top when
 * the cell has one whose lower height is below `y`, else the terrain (Snow-aware). `ra0` / `ra1`
 * are the level's lower and upper ground-box heights (2 ft steps; see GroundBoxScale for others). The cell mask and
 * row stride are the terrain's N (`terrain.cells`, 256 unless a track format version 6 world says 512).
 */
export declare function groundBoxHeightAt(terrain: Mtm2Terrain, ra0: ArrayLike<number> | null, ra1: ArrayLike<number> | null, x: number, z: number, y: number, snow?: boolean, { stepFt, baseFt }?: GroundBoxScale): number;
/** One frame of a moving object (§14.18): along `bvel` on x and z, at half its height above the ground. */
export declare function stepMovingObject(box: SimBox, bvel: ArrayLike<number>, terrain: Mtm2Terrain, ra0: ArrayLike<number> | null, ra1: ArrayLike<number> | null, dt: number, snow?: boolean, scale?: GroundBoxScale): void;
