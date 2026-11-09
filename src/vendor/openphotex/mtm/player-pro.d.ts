/** The version MTM2 2.00.42 writes; the reader takes 100 to this. */
export declare const PLAYER_PRO_VERSION = 103;
export interface MtmDriver {
    name: string;
    /** Version 103's integer (`+0x88`). */
    extra: number;
    /** Version 102's integer (`+0xa0`, kept as a byte). */
    flag: number;
    /** Version 102's seven text lines. */
    texts: string[];
    /** Version 101's pairs. */
    pairs: {
        text: string;
        value: number;
    }[];
    /** The three integers before the truck (`+0x40`, `+0x30`, `+0x44`). */
    numbers: [number, number, number];
    truck: string;
    track: string;
    /** The last four integers (`+0x78`, `+0x7c`, `+0x80`, `+0x84`). */
    settings: [number, number, number, number];
}
export interface MtmPlayerPro {
    version: number;
    /** 1-based, as the file keeps it. */
    selected: number;
    drivers: MtmDriver[];
}
/** A driver as the game makes a new one (`0x4da110`). */
export declare function newMtmDriver(name: string, truck?: string, track?: string): MtmDriver;
/** Read `player.pro`; null when the file is not one (no version line, or a version the game would refuse). */
export declare function parseMtmPlayerPro(input: Uint8Array | string): MtmPlayerPro | null;
/** The file's text, version 103, as the game writes it (CR LF lines). */
export declare function writeMtmPlayerPro(pro: {
    selected?: number;
    drivers: MtmDriver[];
}): string;
