export declare const NOCTURNE_ZTH_WIDTH = 64;
export declare const NOCTURNE_ZTH_HEIGHT = 48;
export declare const NOCTURNE_ZTH_MAP_BYTES: number;
export interface NocturneZth {
    width: 64;
    height: 48;
    depthMaps: Uint32Array[];
}
/** Read the 24-bit depth thumbnails stored in SET camera order. Zero means no sampled surface. */
export declare function parseNocturneZth(bytes: Uint8Array, name?: string): NocturneZth;
