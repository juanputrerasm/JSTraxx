export type Point3 = [number, number, number];
export interface CheckpointBox {
    /** Centre, world feet. */
    position: Point3;
    /** theta, phi, psi. */
    angles: Point3;
    /** Full width (x), height (y), length (z), feet. */
    size: Point3;
    /** Body-to-world rotation, row-major. */
    matrix: number[];
    /** Half diagonal, feet. */
    radius: number;
}
export interface Mtm2Checkpoint {
    index: number;
    gate: CheckpointBox;
    detector: CheckpointBox;
}
/** The SIT box fields the checkpoints use (OpenPhotex `SitBox`). */
export interface CheckpointBoxInput {
    type: number;
    positionFt?: readonly number[];
    sizeFt?: readonly number[];
    theta: number;
    phi: number;
    psi: number;
    modelName?: string;
}
/** A model's full extents in feet, width (x), height (y), length (z), or null if unknown. */
export type ModelExtentsFn = (modelName: string) => readonly [number, number, number] | null;
export declare const CHECKPOINT_TYPE = 6;
export declare const DETECTOR_WIDTH_SCALE = 3;
export declare const DETECTOR_HEIGHT_SCALE = 2;
export declare const SPHERE_PRETEST_FACTOR = 2;
/** The checkpoints of a level, from its boxes in file order. */
export declare function buildCheckpoints(boxes: readonly CheckpointBoxInput[], modelExtents?: ModelExtentsFn): Mtm2Checkpoint[];
/** The sphere pretest against a checkpoint box. */
export declare function withinCheckpointReach(b: CheckpointBox, truckPos: ArrayLike<number>, truckRadius: number): boolean;
/** A world-frame velocity's component along the checkpoint's axis (+z): positive is forwards. */
export declare function speedThroughCheckpoint(b: CheckpointBox, worldVelocity: ArrayLike<number>): number;
/** The race time at which the truck crossed, from the penetration depth found this tick. */
export declare function checkpointCrossingTime(raceTime: number, depth: number, speedThrough: number): number;
/** Whether a point lies inside a checkpoint box (helper for tests and tools). */
export declare function pointInCheckpointBox(b: CheckpointBox, p: ArrayLike<number>): boolean;
