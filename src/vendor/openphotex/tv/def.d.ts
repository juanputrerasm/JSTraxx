/** Engine angles are 16-bit fractions of a turn. */
export declare const TR_ANGLE_TO_RAD: number;
/** One enemy/object definition. */
export interface DefDefinition {
    complexAsset?: string;
    simpleAsset?: string;
    /** The model to draw: the complex asset when it is a .BIN, else the simple one. */
    binForHydration: string;
    /** The header's leading integers; six in every shipped definition. */
    prefix?: number[];
    /** World units; slot 2 of the six-integer header. */
    hitRadius?: number;
    /** TVCAD [Logic] index; slot 0. -1 when the header is not the six-integer shape. */
    logic?: number;
    /** The ground offset's Y (slot 4); the only thing that lifts a TV/F3 object. */
    groundOffsetY: number;
    description: string;
    /** Body line 1, slot 4 (TVCAD [Weapons]). */
    weapon?: number;
    /** Body line 2: powerup drop chance (0-100) and type (-1 random). */
    dropChance?: number;
    dropType?: number;
}
/** One placement, raw. */
export interface DefPlacement {
    defIndex: number;
    strength: number;
    x: number;
    y: number;
    z: number;
    pitch: number;
    roll: number;
    yaw: number;
}
export interface DefFile {
    definitions: DefDefinition[];
    placements: DefPlacement[];
}
/** Parse a .DEF. Returns null when its structure cannot be followed. */
export declare function parseDef(input: Uint8Array | string): DefFile | null;
export declare function defPlacementToEditor(pl: DefPlacement, def: DefDefinition, gridSize: number, origin: string): [number, number, number];
