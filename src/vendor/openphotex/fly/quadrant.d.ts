/** Corner heights along each side of a quadrant. */
export declare const FLY_ALT_SIDE: number;
/** A cell's .TYP line. */
export interface FlyCellType {
    /** 0 plain; 1 finer heights in .AL2; 2 finer heights and a 2 x 2 block of sub-textures. */
    kind: number;
    /** How many steps the cell is divided into along each side: 1, 2 or 4. */
    divisions: number;
}
/** Everything a quadrant's files say, in cell order (index x * 32 + y). */
export interface FlyQuadrant {
    /** Corner heights in feet, index x * 33 + y. */
    heights: Float32Array;
    cellTypes: FlyCellType[];
    /** The .TEX texture names, which .REF indexes. */
    textures: string[];
    /** Each cell's texture, an index into `textures`. */
    cellTextures: Int32Array;
    /**
     * For a kind 2 cell, its four sub-textures in [x][y] order (x0y0, x0y1, x1y0, x1y1); -1
     * where there is none. Null for every other cell.
     */
    cellSubTextures: (number[] | null)[];
    /**
     * For a cell with finer heights, its (divisions + 1)^2 heights, index x * (divisions + 1) + y.
     * Its corners repeat the .ALT corners. Null for a plain cell.
     */
    cellHeights: (Float32Array | null)[];
}
/** The 33 x 33 corner heights of a .ALT file, in feet, index x * 33 + y. */
export declare function parseFlyAlt(bytes: Uint8Array, sourceName?: string): Float32Array;
/** The texture names of a .TEX file. */
export declare function parseFlyTex(bytes: Uint8Array, sourceName?: string): string[];
/** The cell types of a .TYP file. */
export declare function parseFlyTyp(bytes: Uint8Array, sourceName?: string): FlyCellType[];
/** The texture indices of a .REF file, which depend on the cell types. */
export declare function parseFlyRef(bytes: Uint8Array, cellTypes: readonly FlyCellType[], sourceName?: string): {
    cellTextures: Int32Array;
    cellSubTextures: (number[] | null)[];
};
/** The finer heights of a .AL2 file, which depend on the cell types. */
export declare function parseFlyAl2(bytes: Uint8Array, cellTypes: readonly FlyCellType[], sourceName?: string): (Float32Array | null)[];
/** A whole quadrant from its five files. `.AL2` may be empty or absent for a flat quadrant. */
export declare function parseFlyQuadrant(files: {
    alt: Uint8Array;
    typ: Uint8Array;
    tex: Uint8Array;
    ref: Uint8Array;
    al2?: Uint8Array | null;
}, sourceName?: string): FlyQuadrant;
