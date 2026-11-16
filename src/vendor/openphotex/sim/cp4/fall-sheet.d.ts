/** The hotfix's sheet constants (16.3). */
export declare const FALL_SHEET: {
    /** A column merges when its path step comes within this x spacing of a neighbour's polyline (16.3.4). */
    readonly mergeSpacing: 0.25;
    /** ... measured over the neighbour's rows r +- this. */
    readonly mergeRows: 64;
    /** A vertex further than this x spacing (3D) from the other column may be torn (16.3.5). */
    readonly splitSpacing: 3;
    /** The ridge that tears a rung stands this far above both waters, ft, sampled every foot. */
    readonly splitRiseFt: 8;
    /** The strip zipper's tie, x spacing. */
    readonly zipTieSpacing: 1;
    /** Ribbon width: clamp(0.35 x weight x spacing, 2 ft, weight x spacing) (16.3.6). */
    readonly ribbonShare: 0.35;
    readonly ribbonMinFt: 2;
    /** A ribbon end ties to a kept neighbour within this many ribbon widths. */
    readonly ribbonTieWidths: 2;
    /** A draped ribbon vertex is put back on the ground plus this. */
    readonly ribbonDrapeFt: 0.3;
    /** The across arc's vertical allowance, ft (16.3.7). */
    readonly acrossSlackFt: 0.25;
    /** ADVECT: |dv / ds| at most this, 1/s (16.3.8). */
    readonly advectSlope: 1.25;
    /** Relaxation: a neighbour's path further than this x spacing flags the vertex; rows +- 8 relax; 64 iterations. */
    readonly relaxSpacing: 0.5;
    readonly relaxRows: 8;
    readonly relaxIterations: 64;
    /** The spread factor: below this share of the crest spacing the water thickens, at most by 1 / 0.25. */
    readonly spreadShare: 0.95;
    readonly spreadMin: 0.25;
    /** Slab (16.3.10). */
    readonly crestDepthFt: 2;
    readonly drapeMaxFt: 2.5;
    readonly drapeMinFt: 0.5;
    readonly bulkFt: 25;
    readonly thickMinFt: 0.05;
    readonly thickMaxFt: 8;
    readonly crestTaperFt: 1;
    readonly footTaperFt: 3;
    /** The fold clamp keeps at least this share of the gap between neighbours. */
    readonly foldKeep: 0.5;
    /** The zipper's weight on the tie's distance, and its passes. */
    readonly zipWeight: 1.75;
    readonly zipPasses: 256;
    readonly zipPairs: 196608;
    /** The ribbon join pair table. */
    readonly ribbonPairs: 32768;
};
/** One column of the written grid (the build pass's rows, the sink last when `sink`), feet. */
export interface SheetColumn {
    x: number[];
    y: number[];
    z: number[];
    tau: number[];
    speed: number[];
    air: number[];
    path: number[];
    end: number[];
    drop: number[];
    sink: boolean;
    /** Crest arc position, flow dir and the vertex `edge`. */
    s: number;
    fx: number;
    fz: number;
    edge: number;
}
export interface SheetOptions {
    spacing: number;
    crestY: number;
    /** Crest speed, ft/s. */
    speed: number;
    ground: (x: number, z: number) => number;
    /** wfDepthScale / 100 and waterfallBulk / 100 (1 when <= 0). */
    depthScale: number;
    bulk: number;
    /** The fall's build slot (the vertex `fall` field). */
    slot: number;
}
export interface Sheet {
    /** Vertex records (16 numbers each, positions in feet): sheet column by column, ribbons, back face. */
    verts: Float64Array;
    sheetCount: number;
    ribbonCount: number;
    backCount: number;
    /** Triangles over the vertex ids: back face first (reversed), then the front (strips, junctions, ribbons). */
    tris: Int32Array;
    backTris: number;
    frontTris: number;
    ribbonTris: number;
    /** Per column after the tubes: written vertices, first id, merged into a neighbour, sink kept. */
    rows: number[];
    base: number[];
    merged: boolean[];
    sink: boolean[];
    /** Per sheet vertex: the ribbon width when it has a ribbon, else 0. */
    ribbonWidth: Float64Array;
    merges: number;
    droppedTris: number;
}
/** Ribbon width W for a merge weight (16.3.6). */
export declare function fallRibbonWidth(weight: number, spacing: number): number;
/**
 * The slab thickness at one sheet vertex, ft (16.3.10): `v0` the crest speed, `vE` the vertex's speed, `air`, `drop`
 * (ft below the crest), `s` its path and `lEnd` the column's last path, `a` and `b` its column counts to the tube's
 * two sides (the lens), `k` the spread factor times the merge weight, `columns` the fall's columns, `ds` and `bulk`
 * wfDepthScale / 100 and waterfallBulk / 100.
 */
export declare function fallSlabThickness(o: {
    v0: number;
    vE: number;
    air: number;
    drop: number;
    s: number;
    lEnd: number;
    a: number;
    b: number;
    k?: number;
    columns: number;
    ds?: number;
    bulk?: number;
}): number;
/**
 * The hotfix's sheet from the build pass's columns (`cols`, unchanged by the call). See the header for the stages.
 */
export declare function buildFallSheet(cols: readonly SheetColumn[], o: SheetOptions): Sheet;
/**
 * CountBack (16.3.3): the back-face vertices and triangles of the full grid cut at R rows, over the 12.2.9 pattern,
 * `rows[c]` the column's grid rows and `flags[c][r]` its air flags (row 0 taking row 1's, a sink the water row's).
 * None for fewer than 3 columns.
 */
export declare function fallCountBack(rows: readonly number[], flags: ReadonlyArray<ArrayLike<number>>): {
    verts: number;
    tris: number;
};
