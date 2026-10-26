export declare const CPR_POINT_NAMES: readonly string[];
export declare const CPR_SLOT_OFF_TRACK = 0;
export declare const CPR_SLOT_CURB = 1;
export declare const CPR_SLOT_ROAD = 2;
export declare const CPR_SLOT_NAMES: readonly string[];
export declare const CPR_CROSS_SECTION_MIDPOINT = 10;
export declare const CPR_SURFACE_TYPES: readonly string[];
export declare const CPR_WALL_TYPE_NAMES: readonly string[];
export declare const CPR_TEXTURE_INDEX_MASK = 4095;
export declare const CPR_TEXTURE_SLICE_COUNT = 4;
export declare function cprTextureIndex(value: number | null | undefined): number;
export declare function cprTextureSlice(value: number | null | undefined): number;
export declare function cprTextureU(fixed: number | null | undefined): number;
/** One stacked layer of a wall: one of the four wallTexture parts, or the implied catch fence. */
export interface CprWallLayer {
    part?: number;
    fence?: boolean;
    /** Height in wall panels; the panel height itself is engine data this format does not carry. */
    units: number;
}
/** The tree wall type: a 60 ft card, never solid. */
export declare const CPR_TREE_WALL = 7;
export declare const CPR_WALL_LAYERS: Readonly<Record<number, readonly CprWallLayer[]>>;
export declare const CPR_CATCH_FENCE_NAMES: readonly string[];
/** One track record: a cross section, and the stretch from it to the next record. */
export interface CprTrackSurface {
    curveFlag: number;
    anchor: number[];
    /** Per section slot role (CPR_SLOT_*). */
    segmentTypes: number[];
    /** Cross section points [x, altitude, along], in feet. */
    points: number[][];
    /** Per section packed texture reference (see cprTextureIndex), the first `!texture` value. */
    textureIndexes: number[];
    /** Per section `index,u1,u2,u3,u4` as written. */
    textureCoordinates: number[][];
    /** Per point wall type (CPR_WALL_TYPE_NAMES). */
    wallTypes: number[];
    /** Per point, four packed texture references, one per wall part. */
    wallTextures: number[][];
    normal: number[];
    /** Lateral offset of each point from the centreline, in feet. */
    pointOffsets: number[];
    altitude: number;
    grade: number;
    interpolatedGrade: number;
    width: number;
    interpolatedWidth: number;
    heightOffsets: number[];
}
/** A .TTX entry: a texture RAW (archive path, normalized) and its painted surface type. */
export interface CprTtxEntry {
    name: string;
    /** Index into CPR_SURFACE_TYPES. */
    flags: number;
}
/** A parsed .TRK: the header values and the track records. */
export interface CprTrk {
    /** Record count as the header states it; `surfaces` can be shorter when a record is malformed. */
    trackCount: number;
    /** `CRaceTrack.trackBackground`, the terrain heightfield RAW, as written. */
    background: string | null;
    /** `CRaceTrack.scale`. */
    scale: number | null;
    /** `CRaceTrack.length`, the lap length in feet (Laguna: 11816.64). */
    length: number | null;
    surfaces: CprTrackSurface[];
}
export declare function parseCprTrk(input: Uint8Array | string): CprTrk | null;
export declare function parseCprTtx(input: Uint8Array | string): CprTtxEntry[];
export declare function isDegenerateSlot(surface: Pick<CprTrackSurface, "pointOffsets" | "points">, lane: number): boolean;
export declare function cprTrackIsClosed(surfaces: readonly Pick<CprTrackSurface, "points">[] | null | undefined): boolean;
/**
 * The [from, to] record pairs whose stretch exists, in order: each record to the next, plus
 * the last back to the first on a closed circuit.
 */
export declare function cprSegmentPairs(surfaces: readonly Pick<CprTrackSurface, "points">[] | null | undefined): [number, number][];
export declare function cprVisibleSlots(surface: Partial<Pick<CprTrackSurface, "points" | "wallTypes">> | null | undefined): {
    first: number;
    last: number;
};
export declare const CPR_COURSE_PURPOSES: readonly {
    name: string;
    detail: string;
    lap: boolean;
}[];
export type CprCheckpointRole = "pitEntry" | "pitSpeedLimit" | "pitSpeedLimitEnd" | "startFinish" | "gate";
export declare const CPR_CHECKPOINT_ROLES: readonly CprCheckpointRole[];
export declare function cprCheckpointRole(sequence: number, count: number): CprCheckpointRole;
export declare function isCprPitCheckpoint(role: string | null | undefined): boolean;
