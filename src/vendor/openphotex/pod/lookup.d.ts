import type { PodArchive, PodEntry } from "./types.ts";
/**
 * The entry at `path`, compared case-insensitively and with `/` and `\` treated alike.
 * `null` when the archive has no such path.
 */
export declare function findPodEntry(archive: PodArchive, path: string): PodEntry | null;
/**
 * The first entry, in directory order, whose file name (last path component) matches the
 * last component of `name`, ignoring case. Useful where the games refer to assets by bare name.
 */
export declare function findPodEntryByTitle(archive: PodArchive, name: string): PodEntry | null;
/**
 * Every entry whose file name ends with `suffix`, ignoring case, in directory order.
 * Pass the dot (".RAW") to match an extension exactly.
 */
export declare function findPodEntriesByExtension(archive: PodArchive, suffix: string): PodEntry[];
/**
 * A copy of an entry's payload.
 *
 * Always a new buffer, never a view into `bytes`, so the result can be transferred to another
 * worker or mutated without touching the archive. Pass `{ offset, length }` with a smaller
 * length to read just the start of an entry.
 *
 * @throws PodFormatError (ENTRY_OUT_OF_BOUNDS) if the range does not lie inside `bytes`.
 */
export declare function readPodEntry(input: Uint8Array | ArrayBuffer, entry: Pick<PodEntry, "offset" | "length">): Uint8Array;
