import { type BinModel } from "../model/bin.ts";
/** A .BSP read as one model. */
export interface FlyBsp {
    /** Every node's faces over the shared vertex list, exactly as parseBin returns a .BIN. */
    model: BinModel;
    /** How many BSP nodes (splitting planes) the file has. */
    nodeCount: number;
}
export declare function parseFlyBsp(bytes: Uint8Array, sourceName?: string): FlyBsp;
