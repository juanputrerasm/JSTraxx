import type { Mtm2TruckState } from "../truck/state.ts";
/** A coordinate brought into the world, [0, 8192). */
export declare function wrapCoord(v: number): number;
/** A difference of two coordinates taken the short way round: in [-4096, 4096). */
export declare function wrapDelta(d: number): number;
/** The whole worlds to add to `v` so that it is the copy nearest `to`. */
export declare function nearestShift(v: number, to: number): number;
/**
 * Wrap a truck's position as the game does each frame: x and z alone, a world at a time. Its last position goes with
 * it (the game keeps none; the pair tests here cast rays from it). Returns the `[dx, dz]` added, zeros when it stayed.
 */
export declare function wrapTruck(s: Mtm2TruckState): [number, number];
/**
 * Run `test` with the truck moved by whole worlds to the copy nearest (x, z), then move it back by the same, keeping
 * whatever the test did to it. For a pair test against something that stands across the seam.
 */
export declare function withNearest<T>(s: Mtm2TruckState, x: number, z: number, test: () => T): T;
