import { type CprCar } from "./cpr-car.ts";
import { type MtmTrk } from "./mtm-trk.ts";
import { type EvoTrk } from "../evo/trk.ts";
export type TruckManifestKind = "evo" | "cpr-car" | "mtm";
export type TruckManifest = {
    kind: "mtm";
    manifest: MtmTrk;
} | {
    kind: "cpr-car";
    manifest: CprCar;
} | {
    kind: "evo";
    manifest: EvoTrk;
};
/** Which dialect these manifest lines are. Anything not Evo or CPR is read as MTM. */
export declare function detectTruckManifest(lines: readonly string[]): TruckManifestKind;
/** Parse any truck or car manifest, whichever dialect it is. */
export declare function parseTruckManifest(input: Uint8Array | string, sourceName?: string): TruckManifest;
