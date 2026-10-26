/** Altitude bias on the cavern grids, in heightfield steps. */
export declare const HB_UNDERGROUND_BIAS = -256;
/** A Hellbender level's cavern: floor and ceiling heights (unbiased bytes), the draw mask, and textures. */
export interface HbUnderground {
    gridSize: number;
    hollowCellCount: number;
    /** Hollow cells grown by one cell; see below. */
    mask: Uint8Array;
    floorHeights: Uint8Array;
    ceilingHeights: Uint8Array;
    /** Floor and ceiling texture words, split out of .CL1 into plain 2-byte .CLR grids. */
    floorClr: Uint8Array;
    ceilingClr: Uint8Array;
}
/**
 * Decode a Hellbender cavern from its .RA2 (floor), .RA3 (ceiling) and .CL1 (textures).
 *
 * Returns null when the level has no cavern, or when the floor or ceiling grid is missing or
 * the wrong size; a viewer that loses this layer still draws the surface.
 */
export declare function decodeHbUnderground(ra2: Uint8Array | null, ra3: Uint8Array | null, cl1: Uint8Array | null, gridSize: number): HbUnderground | null;
