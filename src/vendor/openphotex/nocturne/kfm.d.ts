export interface KfmCorner {
    vertex: number;
    u: number;
    v: number;
}
export interface KfmPolygon {
    type: number;
    texture: number;
    plane: [number, number, number, number] | null;
    corners: KfmCorner[];
}
export interface KfmModel {
    version: number;
    binary: boolean;
    vertexCount: number;
    polygonCount: number;
    textureCount: number;
    partCount: number;
    frameCount: number;
    useCollisionList: boolean;
    transparentPixel: boolean;
    disableBackfaceCulling: boolean;
    envMapList: boolean;
    vertices: Int32Array;
    polygons: KfmPolygon[];
    envMapOpacity: Uint8Array;
    textures: string[];
    parts: {
        vertexCount: number;
        polygonCount: number;
    }[];
}
export declare function parseKfm(bytes: Uint8Array, name?: string): KfmModel;
