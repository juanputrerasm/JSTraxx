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
 * Expand a 256 x 256 height map (row = Z, u16 heights) into the 1024 x 1024 smooth grid.
 * fine[4z * 1024 + 4x] equals coarse[z * 256 + x].
 */
export declare function terrainSplineExpand(coarse: Uint16Array): Uint16Array;
