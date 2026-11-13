import type { Mtm2TruckParams } from "../mtm2/truck/params.ts";
import type { Mtm2TruckState } from "../mtm2/truck/state.ts";
import type { SimBox } from "../mtm2/collide/box.ts";
import type { Mtm2Rules } from "../mtm2/constants.ts";
import { truckMass, type Pair, type Touch } from "../mtm2/collide/truck-pair.ts";
import { type CollShape } from "./coll-shape.ts";
/** Whether a box takes the triangle path under these rules (11.2). */
export declare function triangleBox(box: SimBox, rules: Mtm2Rules | undefined): box is SimBox & {
    shape: CollShape;
};
/** Hull points 1 to 12 against the triangles: a ray from last step's reference point to each point now. */
export declare function triHullPoints(s: Mtm2TruckState, box: SimBox & {
    shape: CollShape;
}, pair: Pair, dt: number): void;
/** Clear every hold this box keeps (a box removed or reset). */
export declare function clearHolds(box: SimBox): void;
/**
 * The wheel's support from the box's triangles (11.4, 11.5): the nine spokes, then the cylinder, then the
 * hold; the winner goes to the tire under MTM2's rule that the deepest support wins.
 */
export declare function triWheelSupport(s: Mtm2TruckState, p: Mtm2TruckParams, box: SimBox & {
    shape: CollShape;
}, i: number, side: number, touch: Touch, rules: Mtm2Rules): void;
/** Tire `i`'s wall contact (point 13 + i) against the box's triangles. */
export declare function triTireWall(s: Mtm2TruckState, p: Mtm2TruckParams, box: SimBox & {
    shape: CollShape;
}, i: number, pair: Pair, dt: number, rules: Mtm2Rules): void;
/** Whether box corner `c` is near enough the triangles to be tested against the tires. */
export declare function cornerNearTriangles(box: SimBox & {
    shape: CollShape;
}, c: number, rules: Mtm2Rules): boolean;
export { truckMass };
