/** One animation frame of a group: per-vertex data in Evo axes, as written. */
export interface SmfFrame {
    /** x, y (up), z per vertex. */
    positions: Float64Array;
    /** nx, ny, nz per vertex. */
    normals: Float64Array;
    /** u, v per vertex; v runs top-down. */
    uvs: Float64Array;
}
export interface SmfMaterial {
    /** The material line's comma-separated fields, trimmed, verbatim. */
    fields: string[];
    /**
     * Fields 0-2: lighting scalars. Stock values are a small set (1/0.25/32, 1/1/64, 1/1/32,
     * 1/0/0, 1.25/0/0) consistent with specular strength, specular level and a Phong exponent,
     * but that reading is not confirmed, so they are not named.
     */
    scalars: [number, number, number];
    /** Field 3. Only glass and light lenses carry it in the stock trucks. */
    transparent: boolean;
    /** Field 4. */
    reflective: boolean;
    /** Field 5, trimmed, as written (may be empty or a NULL sentinel; see smfTextureReference). */
    textureName: string;
    /** Whether the group used the Evo 2 "v1" bump-material form. */
    bumpForm: boolean;
    /** The bump form's texture line, trimmed, as written (usually quoted). Null without the form. */
    bumpTextureName: string | null;
}
export interface SmfGroup {
    name: string;
    /** False when the group's visible line is "0". Always true before file version 2. */
    visible: boolean;
    objectVersion: number;
    /** The fourth field of the counts line, verbatim; meaning unknown. */
    objectInfo: string;
    vertexCount: number;
    /** Declared frame count, at least 1; `frames.length`. */
    frameCount: number;
    /** Declared face count. `indices` may hold fewer when faces were invalid (see warnings). */
    faceCount: number;
    /** Whether the name marks a reduced-detail track group (OPAQUEL, TRANSPL). */
    lodGroup: boolean;
    material: SmfMaterial;
    frames: SmfFrame[];
    /** Valid faces, three vertex indices each, in the file's winding. */
    indices: Uint32Array;
}
export interface SmfModel {
    fileVersion: number;
    lodEnabled: boolean;
    lodSwitchHeight: number;
    groups: SmfGroup[];
    warnings: string[];
}
/** True when these bytes begin with the C3DModel magic line. */
export declare function isSmfModel(bytes: Uint8Array | null | undefined): boolean;
/**
 * Parse an .SMF model.
 *
 * @throws Error when the file is not a C3DModel, has an unsupported version, implausible counts,
 *   or ends inside a vertex or face block. Recoverable problems go to `warnings`.
 */
export declare function parseSmf(bytes: Uint8Array, sourceName: string): SmfModel;
/**
 * A texture reference from an .SMF material, as an upper-case archive file name, or null when
 * there is none: empty, or one of the NULL sentinels the stock trucks write (NULL, NULL.RAW,
 * NULL.TIF). Quotes are removed.
 */
export declare function smfTextureReference(field: string | null | undefined): string | null;
