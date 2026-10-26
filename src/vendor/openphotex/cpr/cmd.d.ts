import type { Vec3 } from "../truck/common.ts";
/** Positions and part centres are in 1/256 ft. */
export declare const CMD_POSITION_SCALE: number;
/** Normals are in 1/65536; normalize after scaling. */
export declare const CMD_NORMAL_SCALE: number;
/** Texture coordinates are divided by this; V runs top-down. */
export declare const CMD_UV_SCALE = 16711680;
/** The face type every stock car uses. */
export declare const CMD_FACE_TYPE = 41;
export interface CmdCorner {
    vertexIndex: number;
    u: number;
    v: number;
}
export interface CmdFace {
    type: number;
    /** The four-value plane line, as written. */
    plane: number[];
    corners: CmdCorner[];
}
export interface CmdPart {
    name: string;
    vertexCount: number;
    faceCount: number;
    center: Vec3;
    angle: Vec3;
    /** x, y, z per vertex, relative to `center`, fixed point as written. */
    vertices: Float64Array;
    /** nx, ny, nz per vertex, fixed point as written. */
    normals: Float64Array;
    faces: CmdFace[];
}
export interface CmdModel {
    displayName: string;
    lowDetailName: string;
    lowDetailCenterZ: number;
    /** The material: a .RAW texture file name. */
    textureName: string;
    parts: CmdPart[];
    /** Face types other than 0x29 (once each), and parts with a non-zero angle. */
    warnings: string[];
}
/**
 * Parse a .CMD.
 *
 * @throws Error naming the line when a label, count, number, corner count or vertex index is
 *   missing or invalid.
 */
export declare function parseCprCmd(input: Uint8Array | string, sourceName: string): CmdModel;
/** The parts of each wing package, or null when the model carries no alternate package. */
export declare function cmdWingPackages(partNames: Iterable<string>): {
    roadCourse: string[];
    speedway: string[];
} | null;
/** Corner-index triples for a face whose corner positions are `points`. */
export declare function cmdFaceTriangles(points: readonly Vec3[]): number[][];
