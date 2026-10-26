export declare const NAV_TARGET_LIST = 0;
export declare const NAV_TUNNEL_ENTRANCE = 1;
export declare const NAV_CHECKPOINT = 2;
export declare const NAV_JUMP_ZONE = 3;
export declare const NAV_TUNNEL_EXIT = 4;
export declare const NAV_BOSS = 5;
export declare const NAV_START_POINT = 6;
export declare const NAV_TYPE_NAMES: Record<number, string>;
/**
 * Parses a .NAV file into ordered navigation points.
 *
 * Returns [] rather than throwing on malformed input: a viewer that loses its marker layer
 * should still show the track.
 */
/** One TV-family navigation point; `position` is editor-space [x, y, altitude]. */
export interface NavPoint {
    index: number;
    type: number;
    typeName: string;
    position: [number, number, number];
    description: string;
    targets: number[];
    secondaryTargets: number[];
    tunnelLevel: string | null;
    bossEnemy: number;
    musicName: string | null;
    heading: number;
}
export declare function parseNavPoints(bytes: Uint8Array | null | undefined, gridSize: number): NavPoint[];
/**
 * The level's start point, or null. Multiplayer maps carry several, in which case the first
 * is the one to open on.
 */
export declare function findStartPoint(navPoints: readonly NavPoint[] | null | undefined): NavPoint | null;
