/** The spline version this port implements (terrainspline.h TERRAIN_SPLINE_VERSION). */
export declare const TERRAIN_SPLINE_VERSION = 2;
export declare const TERRAIN_COARSE = 256;
export declare const TERRAIN_FINE = 1024;
/**
 * One Hermite segment from p1 to p2 at t = k / 4 (k = 1..3), with p0 and p3 its neighbours,
 * clamped to 0..65535. Any other k gives p1 (clamped), as the C code does.
 */
export declare function terrainSplineSeg(p0: number, p1: number, p2: number, p3: number, k: number): number;
/**
 * Expand an N x N height map (row = Z, u16 heights; N = 256 by default) into the 4N x 4N smooth
 * grid. fine[4z * 4N + 4x] equals coarse[z * N + x]. Indices wrap at N: CP4 wraps at 256, and track
 * format version 6 (section 7.2) wraps a 512-cell world at 512. N must be a power of two.
 */
export declare function terrainSplineExpand(coarse: Uint16Array, size?: number): Uint16Array;
