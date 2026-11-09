/** Decompress a raw DEFLATE stream starting at `start`. `sizeHint` presizes the output. */
export declare function inflateRaw(data: Uint8Array, start?: number, sizeHint?: number): Uint8Array;
/** Decompress a zlib stream (2-byte header, DEFLATE body; the Adler-32 trailer is not checked). */
export declare function inflateZlib(data: Uint8Array, sizeHint?: number): Uint8Array;
