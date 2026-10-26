/** MRGL_MATERIAL, in the units BinMaterial reads back (16.16 values as numbers). Defaults are a plain lit material. */
export interface BinWriteMaterial {
    flags: number;
    reflectivity?: number;
    fresnelBias?: number;
    fresnelStrength?: number;
    /** Default 1. */
    baseAlpha?: number;
    /** Default 32. */
    specPower?: number;
    emissive?: number;
    /** Default [1, 1, 1]. */
    tint?: [number, number, number];
    alphaRef?: number;
    translucency?: number;
}
/** MRGL_MATERIAL2. */
export interface BinWriteMaterial2 {
    flags2: number;
    /** Default 1. */
    normalStrength?: number;
    /** Five words, default zero. */
    reserved?: number[];
}
export interface BinWriteFace {
    /** Zero-based, into the model's vertices. */
    vertexIndices: number[];
    /** Raw texture coordinates over 0xFF0000, as parseBin returns them; rounded to integers. Zero when absent. */
    u?: number[];
    v?: number[];
}
/** Faces drawn the same way: one texture, optionally a material, one facet opcode. */
export interface BinWriteGroup {
    /** The texture in effect; a record is written only when it differs from the previous group's. */
    texture: string;
    /** A facet parseBin reads: MRGL.ZFACETTMAP, ZGFACETTMAP, MATFACET, ZFACET and the like. */
    opcode: number;
    material?: BinWriteMaterial | null;
    material2?: BinWriteMaterial2 | null;
    faces: BinWriteFace[];
}
export interface BinWriteModel {
    /** The MRGL_MAGNIFY power. Default 65536. */
    magnify?: number;
    /** Raw vertex words, three per vertex, as parseBin returns them. */
    vertices: Int32Array | readonly number[];
    groups: BinWriteGroup[];
}
export interface BinWriteResult {
    bytes: Uint8Array;
    /** Faces left out because their first three corners have no area: no direction to store, nothing to draw. */
    degenerateFaces: number;
}
/**
 * Write an MRGL .BIN.
 *
 * @throws RangeError for a facet opcode parseBin does not read, a face with fewer than three
 *   corners, or a vertex index outside the model.
 */
export declare function writeBin(model: BinWriteModel): BinWriteResult;
export declare function binFaceNormal(vertices: Int32Array | readonly number[], indices: readonly number[]): [number, number, number] | null;
export declare function binPlaneTerm(normal: readonly number[], vertices: Int32Array | readonly number[], firstIndex: number): number;
