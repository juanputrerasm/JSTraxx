import { type Pod2AuditAction } from "./pod2.ts";
import type { PodEntry } from "./types.ts";
/** The size of one audit-trail record. */
export declare const POD2_AUDIT_RECORD_SIZE = 312;
/** One entry of a POD2 to be written. */
export interface Pod2DirectoryEntry {
    /** The path exactly as it is to be stored, conventionally with `\` separators. */
    name: string;
    /** Payload size in bytes. */
    length: number;
    /** Unix seconds; the stock packers stored the source file's modification time. */
    timestamp: number;
    /** CRC-32/MPEG-2 of the payload (`crc32Mpeg2`). */
    crc: number;
}
/** One audit-trail record to encode. Sizes and timestamps that do not apply are 0. */
export interface Pod2AuditInput {
    user: string;
    /** When the edit was made, Unix seconds. */
    timestamp: number;
    /** `add`, `remove`, `change`, or a raw action code to preserve one as read. */
    action: Pod2AuditAction | number;
    path: string;
    oldTimestamp?: number;
    oldSize?: number;
    newTimestamp?: number;
    newSize?: number;
}
/**
 * Encode a POD2 header, directory and name table, with 0 in the archive CRC slot. The payloads,
 * concatenated in the same order, follow it directly, then `auditCount` audit records. Patch
 * the archive CRC with `setPod2Checksum` once the rest is known.
 *
 * `comment` is either text (windows-1252, at most 79 bytes) or the 80-byte field's raw bytes,
 * which are stored as given so a comment read from an archive, trailing spaces and all, writes
 * back unchanged.
 *
 * @throws PodWriteError when the entries cannot be stored as a valid POD2.
 */
export declare function buildPod2Directory(comment: string | Uint8Array, entries: readonly Pod2DirectoryEntry[], auditCount?: number): Uint8Array;
/**
 * Encode one 312-byte audit-trail record, the inverse of `readPod2AuditTrail`.
 *
 * @throws PodWriteError (BAD_TEXT) for a user over 31 bytes, a path over 255, or text
 * windows-1252 cannot store.
 */
export declare function encodePod2AuditRecord(record: Pod2AuditInput): Uint8Array;
/**
 * Write the archive CRC into a complete POD2 held in memory: CRC-32/MPEG-2 of bytes 0x08..EOF,
 * stored at 0x04. A streaming writer computes the same value with `crc32Mpeg2Update` instead.
 */
export declare function setPod2Checksum(archive: Uint8Array): number;
/** The byte offset of the archive CRC, for a streaming writer that patches it last. */
export declare const POD2_CHECKSUM_OFFSET = 4;
/** Where the archive CRC's coverage starts: everything from here to EOF. */
export declare const POD2_CHECKSUM_START = 8;
/**
 * A complete POD2: directory, payloads, audit trail, with every CRC computed.
 *
 * `audit` is either records to encode or an existing trail's raw bytes (a multiple of 312),
 * which are copied as they are. Entry timestamps default to 0.
 *
 * @throws PodWriteError when the entries cannot be stored as a valid POD2.
 */
export declare function writePod2(comment: string | Uint8Array, entries: readonly {
    name: string;
    data: Uint8Array;
    timestamp?: number;
}[], audit?: Uint8Array | readonly Pod2AuditInput[]): Uint8Array;
/** The directory entries of a parsed POD2, in the form `buildPod2Directory` takes. */
export declare function pod2DirectoryEntries(entries: readonly PodEntry[]): Pod2DirectoryEntry[];
