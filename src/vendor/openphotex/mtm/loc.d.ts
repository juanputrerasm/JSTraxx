export interface LocMessage {
    tag: string;
    text: string;
}
/** Read a .LOC; null when its header is not the TRI Message System's. */
export declare function parseLoc(input: Uint8Array | string): LocMessage[] | null;
