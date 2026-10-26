import type { PodArchive } from "./types.ts";
/**
 * CRC-32/MPEG-2: polynomial 0x04C11DB7, initial value 0xFFFFFFFF, not reflected, no final XOR.
 * The checksum POD2 uses for the archive and for each entry.
 */
export declare function crc32Mpeg2(bytes: Uint8Array): number;
export interface PodChecksumReport {
    /** Whether the stored archive CRC matches bytes 0x08..EOF. */
    archive: {
        stored: number;
        computed: number;
        ok: boolean;
    };
    /** Entries whose stored CRC does not match their payload, in directory order. */
    mismatches: {
        index: number;
        name: string;
        stored: number;
        computed: number;
    }[];
    /** How many entry CRCs were checked. */
    entriesChecked: number;
}
/**
 * Check a POD2's stored CRCs against the whole archive's bytes. Parsing never does this, so a
 * damaged archive still opens; call this when integrity matters.
 *
 * @throws TypeError for an archive that is not POD2 (only POD2 stores CRCs).
 * @throws RangeError when `bytes` is not the whole archive.
 */
export declare function verifyPodChecksums(bytes: Uint8Array, archive: PodArchive): PodChecksumReport;
/** What an audit record says happened to an entry. Codes outside 0..2 have not been seen. */
export type Pod2AuditAction = "add" | "remove" | "change";
/** One POD2 audit-trail record: a packer's log of an edit to the archive. */
export interface Pod2AuditRecord {
    index: number;
    /** Absolute file offset of the record. */
    offset: number;
    /** Who made the change, as the packer recorded it. */
    user: string;
    /** When the change was made, Unix seconds. */
    timestamp: number;
    /** The stored action code. */
    actionCode: number;
    /** `add` (0), `remove` (1), `change` (2), or `null` for a code not seen in any archive. */
    action: Pod2AuditAction | null;
    /** The entry path the change applied to. */
    path: string;
    /** The entry's timestamp and size before the change; zero for an add. */
    oldTimestamp: number;
    oldSize: number;
    /** The entry's timestamp and size after the change; zero for a remove. */
    newTimestamp: number;
    newSize: number;
}
/**
 * Decode a POD2's audit trail.
 *
 * @throws TypeError for an archive that is not POD2.
 * @throws RangeError when `bytes` is not the whole archive.
 * @throws PodFormatError (ENTRY_OUT_OF_BOUNDS) when the trail would overlap the payloads.
 */
export declare function readPod2AuditTrail(bytes: Uint8Array, archive: PodArchive): Pod2AuditRecord[];
