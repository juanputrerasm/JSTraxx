export declare const HBNAV_TARGET_LIST = 0;
export declare const HBNAV_TUNNEL_ENTRANCE = 1;
export declare const HBNAV_CHECKPOINT = 2;
export declare const HBNAV_JUMP_ZONE = 3;
export declare const HBNAV_TUNNEL_EXIT = 4;
export declare const HBNAV_BOSS = 5;
export declare const HBNAV_START_POINT = 6;
export declare const HBNAV_SYNC_POINT = 7;
export declare const HBNAV_RESCUE_BEACON = 8;
export declare const HBNAV_END_OF_NAVS = 9;
export declare const HBNAV_ESCORT = 12;
export declare const HBNAV_RETRIEVE = 13;
export declare const HBNAV_PURSUE = 14;
export declare const HBNAV_TYPE_NAMES: Record<number, string>;
/**
 * Parses a Hellbender .NAV into ordered navigation points.
 *
 * Returns whatever it read rather than throwing, so a malformed side file costs its own
 * marker layer and nothing else - the same contract as the TV reader.
 */
/** One Hellbender navigation point; `position` is editor-space [x, y, altitude]. */
export interface HbNavPoint {
    index: number;
    type: number;
    typeName: string;
    position: [number, number, number];
    underground: boolean;
    description: string;
    priority: number;
    time: number;
    completionSound: string | null;
    proximitySound: string | null;
    targets: number[];
    secondaryTargets: number[];
    followsPlacement: number;
    bossEnemy: number;
    musicName: string | null;
    heading: number;
    positionIsPlaceholder: boolean;
}
export declare function parseHbNavPoints(bytes: Uint8Array | null | undefined, gridSize: number): HbNavPoint[];
