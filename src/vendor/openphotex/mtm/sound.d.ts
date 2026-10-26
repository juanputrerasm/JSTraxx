export interface KlpLoop {
    /** First sample of the loop. */
    start: number;
    /** Last sample of the loop as the game keeps it, or null for "to the end". */
    end: number | null;
}
export interface MtmKlp {
    type: number;
    /** 1 or 2 (0 when there are no loops); its meaning is not traced yet. */
    mode: number;
    /** Set by types 4 and 6. */
    flag: boolean;
    loops: KlpLoop[];
}
/** Read a .KLP; null when the game would ignore it. Sample-length checks need the WAV. */
export declare function parseKlp(input: Uint8Array | string): MtmKlp | null;
/**
 * The inverse of parseKlp: the tokens of a .KLP, space-separated, CRLF. Types 1 and 2 hold one
 * loop as `start end+1`; types 3 to 6 a count and `end start` pairs; an open end is 0.
 */
export declare function writeKlp(klp: Pick<MtmKlp, "type" | "loops">): Uint8Array;
export interface MtmOneShotSound {
    wav: string;
    volume: number;
    /** Seconds between plays, chosen between these. */
    timerMin: number;
    timerMax: number;
    weatherMask: number;
}
export interface MtmLoopedSound {
    wav: string;
    volume: number;
    weatherMask: number;
}
export interface MtmAmbientSounds {
    checkpointWav: string;
    finishLapWav: string;
    oneShots: MtmOneShotSound[];
    loops: MtmLoopedSound[];
}
/** Read a SOUNDnnn.TXT. */
export declare function parseMtmAmbientSounds(input: Uint8Array | string): MtmAmbientSounds;
/** Whether a weather-masked sound plays in a weather state (0..8). */
export declare function weatherMaskIncludes(mask: number, weather: number): boolean;
