import type { Vec3 } from "../math.ts";
export interface Mtm2Terrain {
    /** The level `.RAW`: 65536 height steps, row-major, rows along z. */
    heights: Uint8Array;
    /** The water level in feet, or null when the level has no water. */
    waterLevelFt: number | null;
    /**
     * The corner heights in feet, in the same order, for a level whose heightfield is finer than
     * MTM2's 2 ft steps (CART Precision Racing, 4x4 Evolution). When present it is used and
     * `heights` is not.
     */
    heightsFt?: Float32Array;
    /**
     * A finer grid over the same world, when the level has one (4x4 Evolution 2's smoothed ground,
     * sim/evo/ground.ts): `cells` per side, each `cellFt` across, heights in feet, rows along z. It is
     * split into triangles as the coarse grid is, by its own rows and columns, and stands in for it.
     */
    fine?: {
        cells: number;
        cellFt: number;
        heightsFt: Float32Array;
    };
    /**
     * Community Patch 4's lakes (WORLD\<stem>.WTR, mtm/wtr.ts): a 32 ft tile's lake id (0 none, x + z * 256) and each
     * id's surface in feet (`levelFt[id]`). On a lake tile the water level is the lake's, elsewhere the track's
     * (OpenMTM2 docs/CP4_EXE_ANALYSIS.md 2).
     */
    lakes?: {
        tileMap: Uint8Array;
        levelFt: Float32Array;
    };
}
export declare function createTerrain(heights: Uint8Array, waterLevelFt?: number | null): Mtm2Terrain;
/**
 * A terrain from corner heights in feet (see `Mtm2Terrain.heightsFt`): the same grid, cells and split. `fineFt`, a
 * square grid of a multiple of 256 heights a side, is a finer grid over it (`Mtm2Terrain.fine`).
 */
export declare function createTerrainFt(heightsFt: Float32Array, waterLevelFt?: number | null, fineFt?: Float32Array | null): Mtm2Terrain;
/** Give a terrain Community Patch 4 lakes: the .WTR's tile map and each lake id's surface in feet (index 0 unused). */
export declare function setTerrainLakes(t: Mtm2Terrain, tileMap: Uint8Array, levelFt: Float32Array): Mtm2Terrain;
/** The lake id (0 none) of the 32 ft tile under (x, z). */
export declare function terrainLakeAt(t: Mtm2Terrain, x: number, z: number): number;
/** The water level at (x, z): a lake's surface on its tiles, else the track's water (null for none). */
export declare function terrainWaterLevelAt(t: Mtm2Terrain, x: number, z: number, trackLevelFt?: number | null): number | null;
/** True when the cell at (row, col) splits along (row, col)-(row + 1, col + 1). */
export declare function cellSplitsMainDiagonal(row: number, col: number): boolean;
/** Bare terrain height in feet, without the Snow rule. */
export declare function terrainHeightAt(t: Mtm2Terrain, x: number, z: number): number;
/** Ground height with the Snow rule: frozen water carries the trucks. */
export declare function groundHeightAt(t: Mtm2Terrain, x: number, z: number, snow?: boolean): number;
/**
 * The upward unit normal of the triangle under (x, z), into `out`. Flat over frozen water in
 * Snow.
 */
export declare function groundNormalAt(t: Mtm2Terrain, x: number, z: number, out: Vec3, snow?: boolean): Vec3;
