import type { Mtm2Ground } from "../mtm2/world/ground.ts";
import type { SimBox } from "../mtm2/collide/box.ts";
/** Untyped faces (no .SRF entry matched): skipped by the lookup. */
export declare const UNTYPED_SURFACE = -2;
/** CP4 keeps at most this many surface boxes (5). */
export declare const MAX_SURFACE_BOXES = 64;
/** The typed face under (x, y, z): its type value and height, or null. */
export declare function surfaceMeshHit(boxes: readonly SimBox[], x: number, y: number, z: number): {
    value: number;
    y: number;
} | null;
/**
 * Give the ground CP4's surface meshes for the tires' grip (in place; returns it). `limit`: how many of the
 * boxes count, in their order; CP4 takes the first 64 and ignores the rest. A host may pass more.
 */
export declare function withSurfaceMeshes(ground: Mtm2Ground, boxes: readonly SimBox[], { limit }?: {
    limit?: number;
}): Mtm2Ground;
