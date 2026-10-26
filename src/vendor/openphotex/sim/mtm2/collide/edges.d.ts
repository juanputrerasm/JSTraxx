import type { Mtm2TruckParams } from "../truck/params.ts";
import type { Mtm2TruckState } from "../truck/state.ts";
type V3 = [number, number, number];
/** The distance from Q to the infinite line through P1 and P2, 999999 when they coincide (`0x48e9d0`). */
export declare function lineDistance(P1: ArrayLike<number>, P2: ArrayLike<number>, Q: ArrayLike<number>): number;
/** The obstacle an edge belongs to: position, rotation, velocity and rates (its own axes). */
export interface EdgeObstacle {
    pos: ArrayLike<number>;
    matrix: ArrayLike<number>;
    vel: ArrayLike<number>;
    /** Rates on (x, y, z), obstacle axes. */
    rates: ArrayLike<number>;
}
/** The game's pair globals the edge system reads but only some pairs write (§14.26.1, §14.26.9). */
export interface EdgeState {
    /** The edge's two face normals, obstacle axes (`0x6cef60`, `0x6cef50`). */
    faceA: V3;
    faceB: V3;
    /** The pair's effective mass (`0x6f1bf0`) and class (`0x6f5168`: 1 the other moves, 2 the truck). */
    mEff: number;
    mover: number;
}
export declare function createEdgeState(): EdgeState;
/** The last force record of the edge contacts (§14.26.9): truck force and moment (body), the obstacle's (its axes). */
export interface EdgeForces {
    truck: {
        f: V3;
        m: V3;
    };
    other: {
        f: V3;
        m: V3;
    };
}
export interface EdgeContext {
    /** The ground normal under (x, z) for an edge acting as ground (`0x550460`). */
    groundNormal(x: number, z: number): V3;
    dt: number;
}
/**
 * One edge, from `W0` to `W1` (world), against a truck (§14.26.1): the pretest, the wheels
 * (§14.26.9), then the hull box (§14.26.2). Returns the last force record the wheel contacts
 * made, or null; a ramp pair discards it, a top-crush pair applies it.
 */
export declare function edgeAgainstTruck(W0: ArrayLike<number>, W1: ArrayLike<number>, o: EdgeObstacle, s: Mtm2TruckState, p: Mtm2TruckParams, es: EdgeState, ctx: EdgeContext): EdgeForces | null;
export {};
