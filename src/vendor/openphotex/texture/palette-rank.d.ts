import type { PodArchive, PodEntry } from "../pod/types.ts";
import type { BundledPaletteId } from "./bundled-palettes.ts";
/** The game a texture belongs to, as the level files name it. */
export type PaletteOrigin = "MTM1" | "MTM2" | "CPR" | "TV/F3" | "TV" | "F3" | "HB";
/** Which ranking a texture follows when the origin is known; see above. */
export type PaletteTextureKind = "model" | "terrain";
export type PaletteCandidate = 
/** Rule 1. */
{
    source: "same-stem";
    entry: PodEntry;
}
/** Rule 2. `entry` null with `bundled` set is METALCR2 named but not packed; neither set is unresolved. */
 | {
    source: "pod-metadata";
    name: string;
    entry: PodEntry | null;
    bundled: BundledPaletteId | null;
}
/** Rule 3. */
 | {
    source: "archive";
    entry: PodEntry;
}
/** The level's own palette; only with a known origin and `trackPalette: true`. */
 | {
    source: "track";
}
/** Rule 4. */
 | {
    source: "bundled";
    bundled: BundledPaletteId;
}
/** Rule 5; never in an automatic chain. */
 | {
    source: "same-folder";
    entry: PodEntry;
};
export interface PaletteCandidateOptions {
    /**
     * The texture's game. Without it the result is a ranked picker list; with it, an automatic
     * chain. Another game's name still gives a chain: MTM1's bundled METALCR2, flight ranking.
     */
    origin?: PaletteOrigin | (string & {});
    /** An automatic chain even without an origin; defaults to whether `origin` is given. */
    automatic?: boolean;
    kind?: PaletteTextureKind;
    /** Whether the caller holds the level's own palette; adds a "track" candidate. */
    trackPalette?: boolean;
}
/** Where a texture's sibling files are looked for, in order, before any folder by name. */
export declare const TEXTURE_SIBLING_DIRS: readonly string[];
/** The bundled palette each game's art is authored against. */
export declare const BUNDLED_PALETTE_BY_ORIGIN: Readonly<Record<PaletteOrigin, BundledPaletteId>>;
/** A texture's name without folder or extension, upper-cased: `art\\Rd4a.raw` is `RD4A`. */
export declare function textureStem(name: string | null | undefined): string;
/**
 * `<stem><ext>` for a texture: first in the usual art folders, in TEXTURE_SIBLING_DIRS order,
 * then anywhere by file name. `ext` includes the dot.
 */
export declare function findTextureSibling(archive: PodArchive, name: string, ext: string): PodEntry | null;
/**
 * The palettes a .RAW texture could be drawn with, best first.
 *
 * `texture` is the name the texture is referred to by, and its archive entry when the caller
 * has it (rule 2 lives in the entry). Candidates name entries and bundled palettes rather than
 * holding bytes: the caller reads them, and should skip one that is shorter than 768 bytes and
 * move on to the next.
 *
 * Without `origin` the list is for a person to choose from: every rule, all four bundled
 * palettes and the same-folder palettes, with no entry listed twice. With `origin` it is an
 * automatic chain: one bundled palette, the track palette when there is one, and no
 * same-folder guesses.
 */
export declare function paletteCandidates(archive: PodArchive, texture: {
    name: string;
    entry?: PodEntry | null;
}, options?: PaletteCandidateOptions): PaletteCandidate[];
