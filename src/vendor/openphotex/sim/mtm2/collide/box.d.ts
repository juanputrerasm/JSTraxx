export interface SimBox {
    pos: [number, number, number];
    /** Body-to-world rotation, row-major. */
    matrix: Float64Array;
    /** World velocity (the game's ivel). */
    vel: [number, number, number];
    /** Half extents along the box's x, y, z. */
    half: [number, number, number];
    /** Slugs; 0 = immovable. */
    mass: number;
    /** Bounding sphere radius. */
    radius: number;
    /** The SIT box type, for a level box (-1 for a ground box). */
    type: number;
    /** Stepped as a rigid body once something moves it: mass at least 1 (§14.15, §14.16). */
    dynamic: boolean;
    /** Body velocity, rates (p, q, r) and angles (theta, phi, psi). */
    bvel: Float64Array;
    rates: Float64Array;
    euler: Float64Array;
    /** The pair tests' force and moment on the box, box axes; used and cleared by its step. */
    force: Float64Array;
    moment: Float64Array;
    /** The 8 corners (body feet, the game's order) and their stored contacts (§14.16). */
    points: Float64Array;
    depths: Float64Array;
    normals: Float64Array;
    /** Corners the last post-step pushed out (the contact solver runs only when it is not 0). */
    contactCount: number;
    impactForce: number;
}
/** A box from its centre, full sizes (x, y, z) and angles (theta, phi, psi). */
export declare function createBox(pos: ArrayLike<number>, size: ArrayLike<number>, mass?: number, angles?: ArrayLike<number>): SimBox;
/** The level box fields this module reads (a parsed SIT box has them all). */
export interface LevelBoxSource {
    positionFt?: [number, number, number];
    theta: number;
    phi: number;
    psi: number;
    /** Length (z), width (x), height (y), feet. */
    sizeFt?: [number, number, number];
    mass: number;
    type: number;
    priority?: number;
}
/** A model's vertex bounds in feet, game frame. */
export interface ModelBounds {
    min: ArrayLike<number>;
    max: ArrayLike<number>;
}
/** Whether a level box is a collision object at a MONSTER.INI detail level (§14.15). */
export declare function levelBoxCollides(box: Pick<LevelBoxSource, "type" | "priority">, detailLevel?: number): boolean;
/**
 * A level box as a collision object (§14.15): centred on its position, rotated by its angles,
 * sized by its model's vertex bounds when it has a model (else the SIT's sizes). Camera-facing
 * types 8 and 9 take the larger of length and width for both, halved. Null without a position.
 */
export declare function createLevelBox(box: LevelBoxSource, bounds?: ModelBounds | null): SimBox | null;
/** For a truck of `truckMass` slugs, a box is pushable only when 0 < mass < truckMass (§7.3). */
export declare function boxIsImmovableFor(box: Pick<SimBox, "mass">, truckMass: number): boolean;
export declare const GROUND_BOX_CELL_FT = 32;
export declare const MAX_GROUND_BOXES = 600;
/**
 * The ground boxes around a point (§14.14): every cell of the 3 x 3 around it whose lower
 * (`ra0`) and upper (`ra1`) heights differ. Heights are 2 ft steps; neighbours wrap at the map
 * edge. Each box is placed beside the point, whichever side of the edge its cell is on (the port's:
 * the game places it by its own cell, a world away from a truck at the other edge). Every face is
 * solid, as in the game: a wheel climbs onto a box only when its hub was above the top the step
 * before (§14.14 step 3), so a step taller than the hub is a wall. `stepFt` is the feet to a height
 * step, for a level whose steps are not MTM2's 2 ft (Hellbender's are 1.5).
 */
export declare function groundBoxesAround(ra0: Uint8Array, ra1: Uint8Array, x: number, z: number, out?: SimBox[], stepFt?: number): SimBox[];
