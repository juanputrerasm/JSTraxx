export interface GeoTriangle {
    indices: Uint32Array;
    normals: Float32Array;
    planeDistances: Float32Array;
    dominantAxes: Uint32Array;
    groundTypes: Uint8Array;
}
export interface GeoCell {
    min: [number, number, number];
    max: [number, number, number];
    vertices: Float32Array;
    triangles: GeoTriangle;
    voxels: Uint8Array;
}
export interface NocturneGeo {
    version: number;
    grid: [number, number, number];
    worldMin: [number, number, number];
    worldMax: [number, number, number];
    cellSize: [number, number, number];
    cells: GeoCell[];
}
export declare function parseNocturneGeo(bytes: Uint8Array, name?: string): NocturneGeo;
