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
 *
 * A file of exactly one byte per cell is the narrow form Hellbender's loader (HELLBEND.EXE
 * 0x412c3e) accepts by size: each byte is a texture index with no mirror or rotation. No shipped
 * level uses it.
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
 *
 * A face grid of exactly six bytes per cell is the narrow form Hellbender's loader accepts by
 * size (HELLBEND.EXE 0x412c3e): each byte is a texture index with no mirror or rotation.
 *
 * `depth` 16 reads a track format version 6 layer of u16 heights (mtm2GroundBoxDepth tells it by
 * size); `lower` and `upper` are then the 16-bit values, in the terrain's height steps
 * (mtm2GroundBoxHeightFt).
 */
export declare function decodeGroundBoxes(ra0: Uint8Array, ra1: Uint8Array, cl0: Uint8Array | null, gridSize: number, heightOffset?: number, depth?: 8 | 16): GroundBox[];
/** What encodeGroundBoxes needs of a box: its cell, heights and six faces, as decodeGroundBoxes gives them. */
export type GroundBoxCell = Pick<GroundBox, "x" | "y" | "lower" | "upper" | "faceTexture" | "faceRotation" | "faceMirror">;
/**
 * The inverse of decodeGroundBoxes: the .RA0, .RA1 and .CL0 grids of a layer. Cells without a
 * box are zero; a later box in the same cell replaces an earlier one. `heightOffset` is the one
 * decodeGroundBoxes was given, taken back off the heights. A box outside the grid, or one whose
 * heights do not fit a byte (upper 1..255), throws a RangeError, as the grids cannot hold it.
 * `depth` 16 writes a track format version 6 layer of u16 heights (upper 1..65535).
 */
export declare function encodeGroundBoxes(boxes: readonly GroundBoxCell[], gridSize: number, heightOffset?: number, depth?: 8 | 16): {
    ra0: Uint8Array;
    ra1: Uint8Array;
    cl0: Uint8Array;
};
export declare const MTM2_GRID_BYTES_PER_CELL: Readonly<Record<string, readonly number[]>>;
/** Refuse a version 6 grid file whose size is not N x N cells: a RangeError naming the file, else its bytes per cell. */
export declare function checkMtm2GridSize(name: string, length: number, cells: number): number;
/**
 * The depth of a ground box pair (.RA0/.RA1, .RA4/.RA5) of a version 6 track, told by size
 * (section 8.3): 8 for one byte a cell, 16 for two. The two files of a pair must agree.
 */
export declare function mtm2GroundBoxDepth(lower: Uint8Array, upper: Uint8Array, cells: number, names?: [string, string]): 8 | 16;
/**
 * A version 6 ground box height in feet (section 8.3): 8-bit base + 2 * byte, 16-bit
 * base + value / step, the terrain's rule. A top of 0 still means no box.
 */
export declare function mtm2GroundBoxHeightFt(value: number, depth: 8 | 16, step?: number, base?: number): number;
