export interface EvoPart {
    name: string;
    code: string;
    type: string;
    cost: number;
    aeroMod: number;
    brakeMod: number;
    cgMod: number;
    tireCfMod: number;
    torqueMod: number;
    /** Between -1 and 1 a share of the weight, otherwise pounds (§2.1). */
    weightMod: number;
    models: string;
    /** Every field as written, by label. */
    fields: Record<string, string>;
}
/** The parts of a PARTS.TXT, in file order. */
export declare function parseEvoParts(input: Uint8Array | string): EvoPart[];
