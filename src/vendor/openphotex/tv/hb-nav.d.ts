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
export declare const HBNAV_ORIENTATION = 10;
export declare const HBNAV_RANDOM = 11;
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
    /**
     * A sync point the game inserted rather than the author: HELLBEND.EXE's loader (0x470bd0)
     * adds a type 7 after every tunnel exit and before every tunnel entrance, jump zone and tunnel
     * exit that lacks one, labelled "Sync point: auto added", and the editor saves them with that
     * label. True for type 7 entries carrying it.
     */
    autoAdded: boolean;
}
export declare function parseHbNavPoints(bytes: Uint8Array | null | undefined, gridSize: number): HbNavPoint[];
