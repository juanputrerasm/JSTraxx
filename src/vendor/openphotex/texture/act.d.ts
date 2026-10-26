/** Bytes in an .ACT palette: 256 RGB triples. Longer files carry extra data after it. */
export declare const ACT_PALETTE_SIZE: number;
/**
 * Resolve an .ACT into 8-bit RGB: 768 bytes, `[r0, g0, b0, r1, ...]`. Always a new buffer.
 * `null` when there are fewer than 768 bytes.
 */
export declare function decodeActPalette(actBytes: Uint8Array | null | undefined): Uint8Array | null;
/**
 * Which channel depth `decodeActPalette` reads a palette as: 6 when its largest channel byte
 * is exactly 63, otherwise 8. `null` for fewer than 768 bytes.
 */
export declare function actPaletteDepth(actBytes: Uint8Array): 6 | 8 | null;
