import type { PodArchive } from "./types.ts";
export interface ParsePodOptions {
    /**
     * The size of the whole archive, when `bytes` holds only its start. Lets a caller parse the
     * directory without loading the payloads: read `podDirectoryEnd(...)` bytes and pass the
     * file's real size here. Payload bounds are checked against this size. Defaults to
     * `bytes.length`.
     */
    byteLength?: number;
}
/**
 * Parse a POD archive's header and directory.
 *
 * The format is identified from the bytes: a `"POD2"` signature means POD2, `"dtxe"` means
 * EPD, and anything else is validated as POD1. Payloads are not read or copied; use `readPodEntry` for those.
 *
 * @throws PodFormatError when the bytes are not a readable POD.
 * @throws RangeError when `options.byteLength` is given and `bytes` is too short a prefix to
 *   hold the directory (see `podDirectoryEnd`).
 */
export declare function parsePod(input: Uint8Array | ArrayBuffer, options?: ParsePodOptions): PodArchive;
/**
 * How many leading bytes of an archive `parsePod` needs to read its directory, judged from the
 * `prefix` read so far. Read that many (capped at the file size) and call again until the
 * answer stops growing; the directory is then complete. POD1 and EPD settle after one extra
 * read, POD2 after two (records, then the name table).
 *
 * Never throws: for bytes that are not a POD it returns an answer that `parsePod` will then
 * reject with the proper error.
 */
export declare function podDirectoryEnd(prefix: Uint8Array, byteLength: number): number;
