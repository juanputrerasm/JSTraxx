export declare const NOCTURNE_FOG_GRID_SIDE = 16;
export declare const NOCTURNE_FOG_GRID_BYTES = 4096;
export interface NocturneFog {
    density: Uint8Array;
    encoding: "EFD" | "LZW" | "raw" | null;
    payload: Uint8Array;
    imageWidth: 320;
    imageHeight: 240;
}
export declare function parseNocturneFog(bytes: Uint8Array, name?: string): NocturneFog;
