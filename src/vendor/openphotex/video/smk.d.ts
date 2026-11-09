export interface SmkAudioTrack {
    /** The track's index, 0 to 6. */
    track: number;
    rate: number;
    channels: 1 | 2;
    bits: 8 | 16;
    /** Huffman-packed DPCM (else raw PCM). */
    packed: boolean;
}
export interface SmkInfo {
    version: "SMK2" | "SMK4";
    width: number;
    height: number;
    /** Frames to show (the ring frame, when there is one, is not counted). */
    frames: number;
    /** Milliseconds a frame. */
    frameMs: number;
    /** Lines are doubled (or interlaced) when shown: the picture is `height * 2` high. */
    doubled: boolean;
    interlaced: boolean;
    ringFrame: boolean;
    audio: SmkAudioTrack[];
}
export interface SmkFrame {
    index: number;
    /** One palette index a pixel, `width * height`, row by row; the decoder's own buffer, valid until the next frame. */
    pixels: Uint8Array;
    /** 256 RGB triples. */
    palette: Uint8Array;
    /** Whether this frame changed the palette. */
    paletteChanged: boolean;
    /** Per audio track in this frame: interleaved samples scaled to -1..1. */
    audio: {
        track: number;
        samples: Float32Array;
    }[];
}
export declare class SmkError extends Error {
}
/** The header and tables of a `.SMK`, and a decoder for its frames in order. */
export declare function openSmk(bytes: Uint8Array): {
    info: SmkInfo;
    /** The next frame, or null after the last shown one (the ring frame is not shown). */
    next(): SmkFrame | null;
    /** Back to the first frame (the picture and palette start again from black). */
    rewind(): void;
};
/** The header of a `.SMK` alone. */
export declare function smkInfo(bytes: Uint8Array): SmkInfo;
