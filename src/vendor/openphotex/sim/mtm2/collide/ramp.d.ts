import type { Mtm2TruckParams } from "../truck/params.ts";
import type { Mtm2TruckState } from "../truck/state.ts";
import type { LevelBoxSource, ModelBounds } from "./box.ts";
import { type EdgeContext, type EdgeState } from "./edges.ts";
export interface SimRamp {
    pos: [number, number, number];
    /** Full width (x), length (z) and height (y), feet. */
    width: number;
    length: number;
    height: number;
    radius: number;
    sinPsi: number;
    cosPsi: number;
    /** Body-to-world rotation, row-major. */
    matrix: Float64Array;
}
/** A ramp from its SIT record, sized by its model's bounds when it has one. Null without a position. */
export declare function createRamp(src: Omit<LevelBoxSource, "type">, bounds?: ModelBounds | null): SimRamp | null;
/** The ramp's top under (x, z), or null when the point is outside its footprint (`0x54feb0`). */
export declare function rampHeightAt(r: SimRamp, x: number, z: number): number | null;
type V3 = [number, number, number];
/** The wedge's top over a point in ramp axes, and whether the wedge holds it (`0x48c230`, §14.19). */
export declare function insideRamp(r: SimRamp, P: ArrayLike<number>): {
    inside: boolean;
    top: number;
};
/** The slope's outward normal, world (`+0xf8`, §14.19): `unit(0, 2b, -H)` turned with the ramp. */
export declare function rampSlopeNormal(r: SimRamp): V3;
/** The five edges the edge system tests, world (`0x4b17c0`, §14.19): c0 c2, c1 c3, c2 c4, c3 c5, c2 c3. */
export declare function rampEdges(r: SimRamp): [V3, V3][];
/**
 * The ramp's sides and front end as walls for a truck's wheels, then its hull points
 * (`0x4b2580`, §14.19); then, given the edge state, its edges (`0x4b17c0`, §14.26). The edge
 * contacts' forces are discarded, as the game's ramp pair does.
 */
export declare function collideTruckRamp(r: SimRamp, s: Mtm2TruckState, p: Mtm2TruckParams, edges?: {
    state: EdgeState;
    ctx: EdgeContext;
}): void;
export {};
