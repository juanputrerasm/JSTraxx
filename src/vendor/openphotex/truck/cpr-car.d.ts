import type { Vec3 } from "./common.ts";
export interface CprCar {
    /** "truckName" or "gtruckName", as written. */
    headerLabel: string;
    truckName: string;
    /** The body model: "truckModelName". */
    truckModelName: string | null;
    /** The four wheel models, in file order (front left, front right, rear left, rear right). */
    tireModelNames: string[];
    /** The same models keyed by wheel anchor key. */
    wheelModelNames: Record<string, string>;
    helmetModelName: string | null;
    helmetPosition: Vec3 | null;
    paceCarFlag: number | null;
    paceCarTireRadius: number | null;
    wheelAnchors: Record<string, Vec3>;
    scrapePoints: Vec3[];
    instrumentCluster: string | null;
    waveFiles: string[];
    unknownFields: Record<string, string>;
}
/** The order a CAR lists its four wheel models in. */
export declare const CPR_WHEEL_KEYS_IN_FILE_ORDER: readonly ["faxle.ltire.static_bpos", "faxle.rtire.static_bpos", "raxle.ltire.static_bpos", "raxle.rtire.static_bpos"];
/** True when these manifest lines are a CPR car rather than an MTM1 truck. */
export declare function isCprCarLines(lines: readonly string[]): boolean;
/**
 * Parse a CPR CAR already split by `truckManifestLines`.
 *
 * @throws Error when the first line is not "truckName" or "gtruckName".
 */
export declare function parseCprCarLines(lines: readonly string[]): CprCar;
