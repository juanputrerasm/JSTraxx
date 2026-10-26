export declare const ANIMATION_BASE_FPS = 8;
/**
 * Parses a .ANI file into animation records.
 *
 * Returns [] rather than throwing on malformed input.
 */
/** One animated texture: its base slot, frames and rate (16.16), and the viewer-rate fps. */
export interface TextureAnimation {
    baseName: string;
    frames: string[];
    rate: number;
    fps: number;
}
export declare function parseAnimations(bytes: Uint8Array | null | undefined): TextureAnimation[];
/**
 * A .ANI: the count, then for each animation its base texture, `frameCount,rate` and the frame
 * names, CRLF. The same layout MTM2 levels use (`DATA\\<stem>.ANI`).
 */
export declare function writeAnimations(animations: readonly Pick<TextureAnimation, "baseName" | "frames" | "rate">[]): Uint8Array;
