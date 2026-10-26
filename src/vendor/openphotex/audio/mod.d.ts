export interface ModSample {
    name: string;
    /** Frames. */
    length: number;
    /** -8..7 */
    finetune: number;
    volume: number;
    loopStart: number;
    loopLength: number;
    data: Int8Array;
}
export interface ModSong {
    title: string;
    channels: number;
    songLength: number;
    orders: number[];
    /** Per pattern, rows * channels cells of `{ sample, period, effect, param }`. */
    patterns: {
        sample: number;
        period: number;
        effect: number;
        param: number;
    }[][];
    samples: ModSample[];
}
export interface RenderedMod {
    sampleRate: number;
    left: Float32Array;
    right: Float32Array;
    /** The frame the song loops back to, when it ran into a row it had already played. */
    loopStartFrame: number;
}
/** The channel count a signature means, or 0. */
export declare function modChannels(signature: string): number;
/** Read a 31-sample module; null when it is not one. */
export declare function parseMod(bytes: Uint8Array): ModSong | null;
/** The mix level of one channel at full volume, before the square root of the channel count (see `renderMod`). */
export declare const MOD_MIX_GAIN = 1.35;
/**
 * Play a module into a stereo buffer. Stops where the song ends, or runs into a row it has
 * already played (the loop point), or after `maxSeconds`.
 */
export declare function renderMod(song: ModSong, options?: {
    sampleRate?: number;
    separation?: number;
    maxSeconds?: number;
}): RenderedMod;
