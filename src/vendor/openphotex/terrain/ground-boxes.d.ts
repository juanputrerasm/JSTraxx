export declare function decodeClrWord(word: number): {
    texture: number;
    mirror: number;
    rotation: number;
};
/** The inverse of decodeClrWord. A negative texture (a face with no texture) is written as 0. */
export declare function encodeClrWord(texture: number, mirror?: number, rotation?: number): number;
/**
 * A .CLR texture grid: one little-endian word per cell, row by row. Returns null when the file
 * is shorter than the grid.
 */
export declare function decodeClrGrid(bytes: Uint8Array, gridSize?: number): Uint16Array | null;
/** The bytes of a .CLR texture grid. */
export declare function encodeClrGrid(words: ArrayLike<number>): Uint8Array;
/** One box, in cell coordinates and legacy height steps; `mid*` in editor units (64 per cell). */
export interface GroundBox {
    x: number;
    y: number;
    width: number;
    height: number;
    lower: number;
    upper: number;
    midX: number;
    midY: number;
    midZ: number;
    faceTexture: number[];
    faceRotation: number[];
    faceMirror: number[];
}
/**
 * Decode a ground-box layer. Returns [] when a grid is shorter than the level's cell count;
 * `faces` may be null, leaving every face at texture -1.
 */
export declare function decodeGroundBoxes(ra0: Uint8Array, ra1: Uint8Array, cl0: Uint8Array | null, gridSize: number, heightOffset?: number): GroundBox[];
/** What encodeGroundBoxes needs of a box: its cell, heights and six faces, as decodeGroundBoxes gives them. */
export type GroundBoxCell = Pick<GroundBox, "x" | "y" | "lower" | "upper" | "faceTexture" | "faceRotation" | "faceMirror">;
/**
 * The inverse of decodeGroundBoxes: the .RA0, .RA1 and .CL0 grids of a layer. Cells without a
 * box are zero; a later box in the same cell replaces an earlier one. `heightOffset` is the one
 * decodeGroundBoxes was given, taken back off the heights. A box outside the grid, or one whose
 * heights do not fit a byte (upper 1..255), throws a RangeError, as the grids cannot hold it.
 */
export declare function encodeGroundBoxes(boxes: readonly GroundBoxCell[], gridSize: number, heightOffset?: number): {
    ra0: Uint8Array;
    ra1: Uint8Array;
    cl0: Uint8Array;
};
