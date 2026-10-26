/** One tag, its value lines and the blocks that belong to it. */
export interface FlyTag {
    /** The four characters between the brackets, trailing spaces removed: `<id  >` is "id". */
    tag: string;
    values: string[];
    blocks: FlyTag[][];
}
/** Reads Fly! tagged text into its tags, unwrapping the block the whole file sits in. */
export declare function parseFlyTagged(input: Uint8Array | string, sourceName?: string): FlyTag[];
/** The first tag named `tag`, or null. */
export declare function flyTag(tags: readonly FlyTag[], tag: string): FlyTag | null;
/** Every tag named `tag`, in file order. */
export declare function flyTags(tags: readonly FlyTag[], tag: string): FlyTag[];
export declare function parseFlyAngle(text: string): number | null;
