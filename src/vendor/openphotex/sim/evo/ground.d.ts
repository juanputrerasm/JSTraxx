/** Sub-heights per cell side, and their spacing in feet. */
export declare const EVO_SUB = 4, EVO_SUB_FT = 8;
/**
 * The fine grid of a 256 x 256 heightfield of corners (the level .RAW, 1/32 ft units, rows along z):
 * 1024 x 1024 heights in the same units, 8 ft apart, rows along z, the world wrapping as the corners do.
 * Sub-height (sz, sx) of cell (row, col) is at `(row * 4 + sz) * 1024 + col * 4 + sx`.
 */
export declare function evoSmoothHeights(corners: ArrayLike<number>): Uint16Array;
