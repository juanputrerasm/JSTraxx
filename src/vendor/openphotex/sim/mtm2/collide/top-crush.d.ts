import type { Mtm2TruckParams } from "../truck/params.ts";
import type { Mtm2TruckState } from "../truck/state.ts";
import type { ModelBounds } from "./box.ts";
import { type EdgeContext, type EdgeState } from "./edges.ts";
type V3 = [number, number, number];
/** One part: half extents x (a), z (b) and its bottom and top in y, car axes about the part's centre. */
export interface CrushPart {
    a: number;
    b: number;
    bottom: number;
    top: number;
    /** Full height (y). */
    height: number;
}
export interface SimTopCrush {
    /** The body's centre and the cab's (its y on the body's bottom, §14.27.2). */
    pos: V3;
    pos2: V3;
    matrix: Float64Array;
    body: CrushPart;
    cab: CrushPart;
    mass: number;
    /** From the SIT, never integrated; the edge tests see them as the car's motion. */
    bvel: V3;
    /** p, q, r. */
    rates: V3;
    radius: number;
    /** The crushed fraction (+0x84): 0 intact. */
    crush: number;
}
export interface TopCrushSource {
    positionFt: ArrayLike<number>;
    position2Ft: ArrayLike<number>;
    theta: number;
    phi: number;
    psi: number;
    sizeFt: ArrayLike<number> | null;
    size2Ft: ArrayLike<number> | null;
    mass: number;
    bvel: ArrayLike<number>;
    rates: ArrayLike<number>;
}
/** A car at load (`0x54a000`): a model's bounds replace that part's sizes (length z, width x, height y). */
export declare function createTopCrush(src: TopCrushSource, bodyBounds?: ModelBounds | null, cabBounds?: ModelBounds | null): SimTopCrush;
/** The part's eight corners in the box order of §14.15, car axes about its centre. */
export declare function crushCorners(part: CrushPart): V3[];
export interface TopCrushContext extends EdgeContext {
    /** The edge system's pair state, kept across pairs (§14.26). */
    edges: EdgeState;
}
/**
 * A truck against a top-crush car (`0x489f90`, §14.27.4): the mass class, hull points, wheels and
 * tire points against both parts, then the edges; the edge contacts' last force goes to the truck.
 */
export declare function collideTruckTopCrush(car: SimTopCrush, s: Mtm2TruckState, p: Mtm2TruckParams, ctx: TopCrushContext): void;
export {};
