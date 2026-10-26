import type { Mtm2Ground } from "./ground.ts";
export interface RoadTriangles {
    /** Nine numbers a triangle: three corners (x, y, z), game feet. */
    positions: ArrayLike<number>;
    /** One TTY surface value (`type * 100 + depth`) a triangle. */
    surfaceValues: ArrayLike<number>;
}
export interface RoadGround extends Mtm2Ground {
    /** The road's height at (x, z), or null where no road triangle covers the point. */
    roadHeight(x: number, z: number): number | null;
    /**
     * The same ground for one body: only triangles at or below `limit()` count, so a deck over the
     * body (a bridge it drives under, an arch) is not its ground and one under it is. `limit` is read
     * at every query; a truck gives a height a little under its own.
     */
    below(limit: () => number): Mtm2Ground;
}
export declare function createRoadGround(base: Mtm2Ground, road: RoadTriangles): RoadGround;
