/** Terrain cell size, in world units. */
export declare const EVO_CELL_SIZE = 32;
/**
 * Divisor turning a raw uint16 height into world units: Evo terrain is 11.5 fixed point,
 * uint16LE / 32.0, fraction kept. CPR's grid is the same size and byte order but 10.6
 * (uint16LE / 64.0), so the two must never share a decoder chosen by cell width; see
 * terrain/height.ts.
 */
export declare const EVO_HEIGHT_DIVISOR = 32;
export declare const EVO_WATER_HEIGHT_DIVISOR = 2;
/** Evo terrain grids are always 256 square. */
export declare const EVO_GRID_SIZE = 256;
/** The world is one grid of cells on a side. */
export declare const EVO_WORLD_SIZE: number;
/** Terrain height in world units at a grid cell, clamped to the grid. */
export declare function evoHeightAtCell(rawData: Uint8Array | null | undefined, gridX: number, gridZ: number): number;
/** Terrain height in world units under an Evo world (x, z), bilinearly sampled. */
export declare function evoHeightAt(rawData: Uint8Array | null | undefined, worldX: number, worldZ: number): number;
