import type { CollShape } from "../../cp4/coll-shape.ts";
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
    /**
     * Community Patch 4 (CP4_EXE_ANALYSIS.md 11.2): the model's triangles in the box frame, and whether the box
     * is a ground box (RA0/RA1), which always stays classic. Read only under rules with `collisionMode` 1.
     */
    shape?: CollShape | null;
    ground?: boolean;
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
 * Whether a truck that is not the player's own brings a box into the frame's object list by being
 * near it (§14.15; retail 0x554802..0x554844, CP4 0x1403b39c0..0x1403b3a10, the same rule): not a
 * box in a checkpoint's footprint (type 11) nor a box with no model, unless the count at
 * `[0x646c40] + 0xc` (CP4 `[0x140945560] + 0x18`; believed to be a network game's other drivers)
 * is at least 1. The player's truck, ramps and listed boxes bring in every box; once listed, a box
 * meets every truck.
 */
export declare function listedByComputerTruck(type: number, hasModel: boolean, networkDrivers?: number): boolean;
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
 * step, for a level whose steps are not MTM2's 2 ft (Hellbender's are 1.5). A track format version 6 world passes
 * its cells (N, 256 or 512) and its terrain base in feet; a 16-bit layer passes its u16 grids with `stepFt` 1 / step
 * (section 8.3: base + 2 * byte, or base + value / step).
 */
export declare function groundBoxesAround(ra0: ArrayLike<number>, ra1: ArrayLike<number>, x: number, z: number, out?: SimBox[], stepFt?: number, cells?: number, baseFt?: number): SimBox[];
