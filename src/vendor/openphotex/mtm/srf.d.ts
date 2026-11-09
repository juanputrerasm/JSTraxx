export declare const SRF_TYPE_CODES: {
    readonly default: 0;
    readonly cement: 100;
    readonly dirt: 200;
    readonly mud: 400;
    readonly sand: 500;
    readonly grass: 600;
    readonly gravel: 700;
    readonly ice: 800;
    readonly snow: 900;
    readonly metal: 1000;
    readonly wood: 1100;
    readonly rocks: 1200;
};
export type SrfType = keyof typeof SRF_TYPE_CODES;
export declare const SRF_TYPES: SrfType[];
export declare const SRF_MAX_LINES = 64;
export interface Srf {
    /** Material name (as written, compared without case by lookups) to surface type. */
    materials: Record<string, SrfType>;
    /** The '*' default, or null. */
    fallback: SrfType | null;
    /** Lines the engine would reject, with the reason, 1-based line numbers. */
    rejected: Array<{
        line: number;
        text: string;
        reason: string;
    }>;
}
export declare function parseSrf(input: Uint8Array | string): Srf;
/** The surface type of a model texture, or null (not a surface): exact name, stem, 15-character prefix, then '*'. */
export declare function srfTypeOf(srf: Srf, texture: string): SrfType | null;
/** The engine's type code (id x 100) of a surface type. */
export declare function srfTypeCode(type: SrfType): number;
