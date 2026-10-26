import { type Mtm2Terrain } from "./terrain.ts";
export interface Mtm2SurfaceMap {
    /** The level `.CLR`: one texture word per terrain cell, row-major, rows along z. */
    clr: Uint16Array;
    /** The type value (`type * 100 + depth`) of each texture index. */
    textureValues: Int32Array;
}
/** Type values per texture index, from the `.TEX` names and the parsed `.TTY` entries. */
export declare function textureTypeValues(textureNames: readonly string[], tty: readonly {
    name: string;
    value: number;
}[]): Int32Array;
export declare function createSurfaceMap(clr: Uint16Array, textureValues: Int32Array): Mtm2SurfaceMap;
/** The type value of a texture word (unknown textures read 0). */
export declare function textureWordValue(map: Mtm2SurfaceMap, word: number): number;
/**
 * The terrain's type value at (x, z): the cell texture, or water below the level. `waterLevelFt`
 * null is treated as the game's level 0.
 */
export declare function terrainSurfaceValue(terrain: Mtm2Terrain, map: Mtm2SurfaceMap, x: number, z: number, waterLevelFt: number | null, snow?: boolean, deepWater?: boolean): number;
export declare function surfaceType(value: number): number;
/** How far a wheel sinks, in feet: the depth is in inches. */
export declare function surfaceSinkFt(value: number): number;
/** Base friction coefficient of a ground type. */
export declare function surfaceMu(type: number): number;
/** Fluid density used for drag over a ground type, slug/ft³. */
export declare function surfaceDragDensity(type: number, waterDensity?: number): number;
/** Tire-cut factor: cut 0 shallow, 1 medium, 2 deep. */
export declare function cutFactor(type: number, cut: number): number;
/** A tire's friction coefficient, μ_tire = cutFactor · K · μ · weather (§5.1). */
export declare function tireMu(type: number, cut: number, weather: number, k?: number): number;
