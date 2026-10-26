export declare const NOCTURNE_THM_WIDTH = 320;
export declare const NOCTURNE_THM_HEIGHT = 240;
export declare const NOCTURNE_THM_SLOTS = 10;
export interface NocturneThumbnail {
    rgba: Uint8ClampedArray;
    empty: boolean;
}
export interface NocturneThm {
    width: 320;
    height: 240;
    thumbnails: NocturneThumbnail[];
}
/** Read Nocturne's ten-slot, half-resolution RGBX thumbnail bank. */
export declare function parseNocturneThm(bytes: Uint8Array, name?: string): NocturneThm;
