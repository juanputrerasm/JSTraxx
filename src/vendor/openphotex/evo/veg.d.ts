/**
 * One tree placement, in Evo world units. `value` is the tree's yaw in 1/256 turns
 * (`evoTreeYaw`); `sector` the 512 ft sector of its treeGrid block (x `sector % 16`, z
 * `sector >> 4`) and `index` its place in that block, whose low two bits pick the model slot
 * (`evoTreeSlot`).
 */
export interface EvoTree {
    x: number;
    y: number;
    z: number;
    value: number;
    sector: number;
    index: number;
}
/** Trees per sector side, the most trees one sector holds, and a sector's side in feet. */
export declare const EVO_TREE_SECTORS = 16;
export declare const EVO_TREES_PER_SECTOR = 100;
export declare const EVO_TREE_SECTOR_FT = 512;
/** A tree's yaw about the vertical axis, radians, from its stored byte (0x468910: byte * pi / 128). */
export declare function evoTreeYaw(value: number): number;
/** A tree's model slot (0..3): its index in its sector's list, low two bits (0x4660b0). */
export declare function evoTreeSlot(index: number): number;
/** A parsed Evo 2 .VEG vegetation record. */
export interface EvoVeg {
    sourceName: string;
    version: number;
    maxTrees: number;
    treeModels: string[];
    treeTexture: string | null;
    treeLine: number;
    minDistanceSquared: {
        dense: number;
        medium: number;
        sparse: number;
    };
    treeSizes: {
        sizeX: number;
        sizeY: number;
        biasY: number;
    }[];
    /** Read and never used by the game (0x466af0). */
    whackTrees: number;
    grassTexture: string | null;
    vegSizes: {
        min: number;
        max: number;
        bias: number;
    }[];
    color: {
        min: number;
        max: number;
        scrub: number;
    } | null;
    trees: EvoTree[];
    gridCount: number;
    warnings: string[];
}
export declare function parseEvoVeg(bytes: Uint8Array, sourceName: string): EvoVeg;
