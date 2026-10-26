export interface DfmInfluence {
    bone: number;
    weight: number;
    position: [number, number, number];
}
export interface DfmTriangle {
    texture: number;
    vertices: [number, number, number];
    uv: [[number, number], [number, number], [number, number]];
}
export interface DfmLod {
    vertexCount: number;
    triangleCount: number;
    capTriangleCount: number;
    pixelHeight: number;
    shadowOnly: boolean;
    vertices: DfmInfluence[][];
    triangles: DfmTriangle[];
    capTriangleParts: Int32Array;
}
export interface DfmPart {
    name: string;
    dominantBone: number;
    adjacentParts: Int32Array;
    lods: {
        triangleCount: number;
        capTriangleCount: number;
    }[];
}
export interface DfmModel {
    version: number;
    textureSetCount: number;
    textureCount: number;
    boneCount: number;
    skeleton: string;
    lods: DfmLod[];
    parts: DfmPart[];
    textures: string[];
    boneOrigins: [number, number, number][];
    rootOffsetScale: [number, number, number];
    bias: [number, number, number];
    partForBone: Int32Array;
}
export declare function parseDfm(bytes: Uint8Array, name?: string): DfmModel;
