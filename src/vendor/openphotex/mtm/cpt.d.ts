export interface CptPart {
    model: string;
    pivot: [number, number, number];
    axis: [number, number, number];
    values: number[];
}
export interface Cpt {
    version: number | null;
    cab: string | null;
    eye: [number, number, number] | null;
    speedo: CptPart | null;
    tach: CptPart | null;
    wheel: CptPart | null;
    shifter: CptPart | null;
    /** Gear lamp models by gear letter: P, R, N, 1, 2, 3. */
    gearLamps: Record<string, string>;
    shiftLight: {
        model: string;
        values: number[];
    } | null;
    mirror: number[] | null;
    /** Every KEY = value line, upper-cased keys, in file order. */
    entries: Array<{
        key: string;
        values: string[];
    }>;
}
export declare function parseCpt(input: Uint8Array | string): Cpt;
