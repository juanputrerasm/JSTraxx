/** CRC-32 (ISO 3309, the PNG and zlib one). */
export declare function crc32(bytes: Uint8Array, crc?: number): number;
/** A zlib stream (RFC 1950) of `data`: one fixed-Huffman deflate block with LZ77 matches. */
export declare function deflateZlib(data: Uint8Array): Uint8Array;
/**
 * A grey PNG (colour type 0) of `width` x `height` samples, row by row, at 8 or 16 bits. A sample
 * outside the depth's range throws.
 */
export declare function encodeGreyPng(samples: ArrayLike<number>, width: number, height: number, bitDepth?: 8 | 16): Uint8Array;
