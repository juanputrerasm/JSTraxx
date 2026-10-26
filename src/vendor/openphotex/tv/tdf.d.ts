export declare const TUNNEL_LOGIC_NAMES: string[];
/**
 * Parses a .TDF file into tunnel records.
 *
 * Returns [] rather than throwing on malformed input.
 */
/** One tunnel record; positions are editor-space [x, y, altitude]. */
export interface TunnelDef {
    index: number;
    levelName: string;
    entrancePosition: [number, number, number];
    exitPosition: [number, number, number];
    entranceLogic: number;
    exitLogic: number;
    entranceLogicName: string;
    exitLogicName: string;
    entranceTexture: string;
    exitTexture: string;
    entranceGroundTexture: string;
    exitGroundTexture: string;
    exitsIntoChamber: boolean;
}
export declare function parseTunnelDefs(bytes: Uint8Array | null | undefined, gridSize: number, origin: string): TunnelDef[];
