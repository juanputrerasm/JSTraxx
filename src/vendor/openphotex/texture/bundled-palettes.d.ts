export type BundledPaletteId = "metalcr2Mtm1" | "metalcr2Cpr" | "vgaHB" | "vgaTV";
export declare const BUNDLED_PALETTE_IDS: readonly BundledPaletteId[];
/**
 * A bundled palette's 768 bytes. The same array is returned on every call; copy it before
 * changing it.
 */
export declare function bundledPalette(id: BundledPaletteId): Uint8Array;
