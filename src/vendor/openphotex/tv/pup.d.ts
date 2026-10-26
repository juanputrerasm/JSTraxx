/**
 * Parses a .PUP file into powerup placements.
 *
 * Returns [] rather than throwing on malformed input.
 */
/** One powerup placement; `position` is editor-space [x, y, altitude]. */
export interface Powerup {
    index: number;
    position: [number, number, number];
    type: number;
    name: string;
    furyName: string;
    modelName: string;
}
export declare function parsePowerups(bytes: Uint8Array | null | undefined, gridSize: number, origin: string): Powerup[];
