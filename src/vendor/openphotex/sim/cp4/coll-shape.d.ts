export type V3 = [number, number, number];
export interface CollGrid {
    origin: V3;
    cell: V3;
    dims: V3;
    /** Triangles of cell c are items[start[c] .. start[c + 1]). Cells run x fastest, then y, then z. */
    start: Int32Array;
    items: Int32Array;
}
export interface CollShape {
    /** Nine numbers per triangle, box frame, feet. */
    tris: Float64Array;
    count: number;
    min: V3;
    max: V3;
    /** The k-DOP is flat or failed: the model keeps its classic box (11.2). */
    degenerate: boolean;
    /** The k-DOP's volume, ft^3, and its vertex count. */
    hullVolume: number;
    hullVertices: number;
    /** Null when the grid overflowed CP4's limits: the model keeps its classic box. */
    grid: CollGrid | null;
    /** Surface type code per triangle (type id x 100) from the model's .SRF, -2 untyped; null without a .SRF. */
    surfaceTypes: Int16Array | null;
    /** Box corners against the triangles, cached by corner layout (phantom corners, 11.8). */
    corners?: {
        layout: Float64Array;
        dist: Float64Array;
    };
    /** Which query last tried each triangle (`mark`), so a query tries a triangle once however many cells list it. */
    marks?: Uint32Array;
    mark?: number;
}
export interface RayHit {
    t: number;
    /** Unit geometric normal turned to face the ray's origin. */
    normal: V3;
    point: V3;
    tri: number;
}
export interface CylinderHit {
    /** r - distance, positive when the triangle is inside the cylinder. */
    penetration: number;
    /** The closest point on the triangle and the unit triangle normal turned toward the axis. */
    point: V3;
    normal: V3;
    tri: number;
}
/** The 26-DOP of a set of points: its volume and vertex count. */
export declare function kdopHull(points: ArrayLike<number>): {
    volume: number;
    vertices: number;
};
/** A shape from a soup (nine numbers per triangle, box frame). */
export declare function buildCollShape(positions: ArrayLike<number>, surfaceTypes?: Int16Array | null): CollShape;
/** Whether CP4 would collide with this shape by its triangles (11.2). */
export declare function shapeUsable(s: CollShape | null | undefined): s is CollShape;
/**
 * The nearest triangle a ray meets within `maxLen` (11.2): `dir` a unit vector, box frame. Ties go to
 * the lower triangle index. Null for none.
 *
 * The segment is clipped to the grid's box (slab method; a component under 1e-20 is parallel) and the cells
 * it crosses are visited in order; each triangle listed in them is tried once (Moller-Trumbore, double-sided,
 * det eps 1e-8).
 */
export declare function rayQuery(s: CollShape, origin: V3, dir: V3, maxLen: number): RayHit | null;
/** The closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
export declare function closestOnTriangle(p: V3, a: V3, b: V3, c: V3): V3;
/**
 * The deepest triangle inside a tire cylinder (11.3): centre `c`, unit `axis`, radius `r`, half width
 * `halfW`, extra reach `slack`; with `treadClip` the cylinder is cut at its sidewalls, otherwise a capsule.
 * Box frame. Ties go to the lower triangle index.
 */
export declare function cylinderQuery(s: CollShape, c: V3, axis: V3, r: number, halfW: number, slack: number, treadClip: boolean): CylinderHit | null;
/** The distance from a point to the nearest triangle (box frame). */
export declare function pointDistance(s: CollShape, p: V3): number;
/** A shape's triangle normal (unit), box frame. */
export declare function triangleNormal(s: CollShape, t: number): V3;
