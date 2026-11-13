import { type BinModel } from "./bin.ts";
export interface CollSoup {
    /** Nine numbers per triangle: three corners, feet, game frame. */
    positions: Float32Array;
    /** The texture name of each triangle's face (upper case), as an index into `textures`; -1 for none. */
    textureIndex: Int16Array;
    textures: string[];
    /** Faces with fewer than three corners or an index past the vertex list. */
    skipped: number;
}
/** The soup of a parsed model, or null when it has no geometry or no magnify. */
export declare function binCollisionSoup(model: BinModel): CollSoup | null;
/** The soup of a .BIN's bytes. */
export declare function binBytesCollisionSoup(bytes: Uint8Array | ArrayBuffer): CollSoup | null;
