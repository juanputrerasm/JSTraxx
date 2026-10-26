import type { Mtm2TruckParams } from "../truck/params.ts";
import type { Mtm2TruckState } from "../truck/state.ts";
type V3 = [number, number, number];
/** How far behind a face it is solid, feet. */
export declare const FACE_DEPTH_FT = 2;
/** A wall face: its corners, its outward unit normal, and the sphere round it. */
export interface SimFace {
    a: V3;
    b: V3;
    c: V3;
    normal: V3;
    centre: V3;
    radius: number;
}
/**
 * A wall face from its three corners (world feet), facing the way `outward` points (any vector on the open side), or
 * the corners' winding (a, b, c counter-clockwise seen from outside) without it. Null for a face with no area.
 */
export declare function createFace(a: V3, b: V3, c: V3, outward?: V3): SimFace | null;
/**
 * A truck against a wall face, after the truck step and before the post-step, as `collideTruckImmovableBox`.
 * `s.prevPos` and `s.prevMatrix` are the truck's pose before this step's move.
 */
export declare function collideTruckFace(s: Mtm2TruckState, p: Mtm2TruckParams, f: SimFace, dt: number): void;
export {};
