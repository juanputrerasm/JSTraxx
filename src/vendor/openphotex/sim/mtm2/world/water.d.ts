/** The game's fixed-point sine: phase 0..0xffff is one turn, result ±65536. */
export declare function fixedSin(phase: number): number;
/**
 * The water level in feet at `raceTimeS` seconds into the race, or null when the level has no
 * water. `lvlValue` is the LVL `!waterHeight` (half feet).
 */
export declare function waterLevelFt(lvlValue: number | null, raceTimeS?: number, snow?: boolean): number | null;
