export declare const TRN_MAX_EVENTS = 16;
export declare const TRN_MAX_LAPS = 20;
export interface MtmTrnEvent {
    /** The track's SIT, as written (upper or lower case). */
    file: string;
    /** Laps for a circuit; 0 for a drag strip or a rally. */
    laps: number;
}
export interface MtmTrn {
    name: string;
    /** The description's text file, beside the tournament; "" when none. */
    descriptionFile: string;
    hasDrag: boolean;
    events: MtmTrnEvent[];
    warnings: string[];
}
/** Read a .TRN; null when it has no tournament name label. */
export declare function parseTrn(input: Uint8Array | string): MtmTrn | null;
/** Write a .TRN as the game does: CRLF lines, no closing Ctrl+Z. */
export declare function writeTrn(trn: Pick<MtmTrn, "name" | "descriptionFile" | "hasDrag" | "events">): string;
