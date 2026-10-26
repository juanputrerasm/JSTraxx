import type { PodEntry } from "./types.ts";
export type PodWriteErrorCode = 
/** No entries, or more than 8192. */
"BAD_ENTRY_COUNT"
/** An entry name is empty, has control characters, a ':', or leading/trailing whitespace. */
 | "BAD_NAME"
/** A name (with its palette record, if any) does not fit the 32-byte name field. */
 | "NAME_TOO_LONG"
/** Two entries share a path, ignoring case and separator style. */
 | "DUPLICATE_NAME"
/** A palette record on an entry that is not a `.RAW`, or one that does not name a `.ACT`. */
 | "BAD_PALETTE"
/** A character windows-1252 cannot store, or a comment longer than 79 bytes. */
 | "BAD_TEXT"
/** The archive would exceed the 2 GiB the engine can address. */
 | "TOO_LARGE";
export declare class PodWriteError extends Error {
    readonly code: PodWriteErrorCode;
    /** The index of the offending entry, when the error concerns one. */
    readonly entryIndex: number | null;
    constructor(code: PodWriteErrorCode, message: string, entryIndex?: number | null);
}
/** One entry of a POD1 to be written: its stored path and payload size. */
export interface Pod1DirectoryEntry {
    /**
     * The path exactly as it is to be stored. By convention upper case with `\` separators, as
     * every shipped archive has it; the engine upper-cases names when mounting.
     */
    name: string;
    /** Payload size in bytes. */
    length: number;
    /**
     * Optional palette record for a `.RAW` entry: the bare `.ACT` name written after the path, as
     * the MTM1/TV/Fury3/Hellbender packers did. Pass it only to preserve one read from an existing
     * archive (`PodEntry.paletteName`); never invent one.
     */
    paletteName?: string | null;
}
/**
 * Encode a POD1 header and directory. The payloads, concatenated in the same order, follow it
 * directly: entry `i` is stored at `directory.length + sum(lengths before i)`.
 *
 * Returning only the directory lets a caller stream or `Blob` the payloads without copying
 * them. Given an archive's own entries, comment and palette records, in directory order, this
 * reproduces that archive's directory byte for byte.
 *
 * @throws PodWriteError when the entries cannot be stored as a valid POD1.
 */
export declare function buildPod1Directory(comment: string, entries: readonly Pod1DirectoryEntry[]): Uint8Array;
/**
 * A complete POD1: `buildPod1Directory` followed by every payload, in order.
 *
 * @throws PodWriteError when the entries cannot be stored as a valid POD1.
 */
export declare function writePod1(comment: string, entries: readonly {
    name: string;
    data: Uint8Array;
    paletteName?: string | null;
}[]): Uint8Array;
/** The directory entries of a parsed archive, in the form `buildPod1Directory` takes. */
export declare function pod1DirectoryEntries(entries: readonly PodEntry[]): Pod1DirectoryEntry[];
