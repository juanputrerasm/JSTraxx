type V3 = [number, number, number];
/** The six faces: left (-x), right (+x), bottom, top, front (+z), back (-z). */
export declare const FACES: readonly {
    axis: number;
    sign: number;
}[];
/** The order the game tries them in: hull points start with y, wheels with x. */
export declare const HULL_ORDER: readonly [2, 3, 4, 5, 0, 1];
export declare const WHEEL_ORDER: readonly [0, 1, 2, 3, 4, 5];
export interface FaceHit {
    /** Index into FACES, or -1. */
    face: number;
}
/**
 * The nearest face a ray crosses inside the face (at most two crossings are counted, as in the
 * game), trying the faces in `order`; later faces win ties. `directional`: only faces ahead of
 * the origin (t > 0) whose outward normal faces the ray count.
 */
export declare function nearestFace(half: V3, origin: V3, dir: V3, directional: boolean, order: readonly number[]): FaceHit;
/** A point's depth inside a face (positive inside), box frame. */
export declare function depthInside(half: V3, p: V3, face: number): number;
/** The face's outward normal in the box frame. */
export declare function faceNormal(face: number): V3;
export {};
