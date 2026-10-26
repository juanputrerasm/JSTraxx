import { type Mtm2Terrain } from "../world/terrain.ts";
import type { SimBox } from "./box.ts";
/**
 * The height under (x, z) for a body whose centre is at `y` (`0x502350`): a ground box's top when
 * the cell has one whose lower height is below `y`, else the terrain (Snow-aware). `ra0` / `ra1`
 * are the level's lower and upper ground-box heights (2 ft steps).
 */
export declare function groundBoxHeightAt(terrain: Mtm2Terrain, ra0: Uint8Array | null, ra1: Uint8Array | null, x: number, z: number, y: number, snow?: boolean): number;
/** One frame of a moving object (§14.18): along `bvel` on x and z, at half its height above the ground. */
export declare function stepMovingObject(box: SimBox, bvel: ArrayLike<number>, terrain: Mtm2Terrain, ra0: Uint8Array | null, ra1: Uint8Array | null, dt: number, snow?: boolean): void;
