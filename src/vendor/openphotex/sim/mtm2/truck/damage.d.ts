export declare const DAMAGE_ZONES = 12;
/** The impact forces (lb) that end level 1 and level 2; above the second is level 3. */
export declare const DAMAGE_LEVEL_1_FORCE = 10000, DAMAGE_LEVEL_2_FORCE = 30000;
/** Model units per foot, as the BIN stores vertices. */
export declare const MODEL_UNITS_PER_FT = 256;
/** The push radius of zones 1 to 12 in model units (index 0 is unused): 512 for 1 to 4, 384 for 5 to 12. */
export declare const ZONE_RADIUS_UNITS: readonly number[];
/** The direction a zone pushes, three signs in body axes (x right, y up, z forward), zones 1 to 12 (index 0 unused). */
export declare const ZONE_PUSH: readonly (readonly [number, number, number])[];
/** The damage level a force gives: 0 for none, 1 up to 10000, 2 up to 30000, 3 above. */
export declare function damageLevelForForce(force: number): 0 | 1 | 2 | 3;
/** Zone `zone` (1 to 12)'s level in a damage code. */
export declare function zoneLevel(code: number, zone: number): number;
/** Whether any zone is damaged (the hull sound changes). */
export declare const isDamaged: (code: number) => boolean;
/** The new damage code after `force` hits `zone` (1 to 12); a zone only gets worse. */
export declare function recordZoneHit(code: number, zone: number, force: number): {
    code: number;
    level: number;
    raised: boolean;
};
/**
 * How far one vertex moves in one push, in model units: `((level + 1) * 0xfffe + rand) * 16 >> 16`
 * with `rand` 0 to 32767 (`random` in [0, 1)), which is 16 to 24 at level 0 and 64 to 72 at level 3.
 */
export declare function dentUnits(level: number, random: number): number;
/** A zone's push radius in feet and direction in body axes. */
export declare function zoneDent(zone: number): {
    radiusFt: number;
    direction: readonly [number, number, number];
};
/**
 * Push the vertices of `positions` (x, y, z in feet, flat, in place) that are within `radiusFt` of
 * `center` by `direction` times the level's dent, each vertex drawing its own amount from
 * `random`. Vertices that share a position (a mesh repeats them per face) get the same amount so
 * a model stays welded. `center` and `direction` are in the same axes as `positions`. Returns how
 * many vertices moved.
 */
export declare function dentVertices(positions: Float32Array | Float64Array | number[], center: readonly number[], direction: readonly number[], radiusFt: number, level: number, random?: () => number): number;
