import type { Mtm2Ground } from "../world/ground.ts";
/**
 * What the solver reads and writes: a truck (16 points) or a box (8 corners, §14.16). Points are
 * body feet; depths and normals (world) are the stored contacts; `contactCount` 0 means none.
 */
export interface ContactBody {
    pos: ArrayLike<number>;
    matrix: ArrayLike<number>;
    bvel: ArrayLike<number>;
    /** p, q, r. */
    rates: ArrayLike<number>;
    points: ArrayLike<number>;
    /** A truck's contact-point slots (+0x670), which the solver reads instead of `points` when given (§14.26.6). */
    contactPoints?: ArrayLike<number>;
    depths: ArrayLike<number>;
    normals: ArrayLike<number>;
    contactCount: number;
    impactForce: number;
}
export interface ContactResult {
    /** Contact force and moment (about the body origin), body axes. */
    force: [number, number, number];
    moment: [number, number, number];
    /** Contacts in this step's list (before keeping four). */
    count: number;
}
type V = [number, number, number];
/** `inertia` is I1, I2, I3 (about z, x, y). */
export interface HullFriction {
    /** The friction limit's factor on the support (MTM2 0.5, `HULL_FRICTION_K`). */
    factor: number;
    /** The surface's friction coefficient by ground type. */
    mu(type: number): number;
}
export declare function solveHullContacts(s: ContactBody, inertia: ArrayLike<number>, ground: Mtm2Ground, external: V, mass: number, weight: number, dt: number, friction?: HullFriction): ContactResult;
export {};
