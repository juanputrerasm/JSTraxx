import type { FlyBounds } from "./globe.ts";
/** A parsed .SCF scenery manifest. */
export interface FlySceneryManifest {
    name: string;
    /** The area the set's detailed scenery covers (<call>, <caur>). */
    coverage: FlyBounds | null;
    /** The area within which the game loads the set (<ldll>, <ldur>). */
    load: FlyBounds | null;
    /** The archives the set is made of, as written (lower case in the stock files). */
    files: string[];
}
export declare function parseFlyScf(input: Uint8Array | string, sourceName?: string): FlySceneryManifest;
/** One model of an object: a named part, or a model shown within a range of distances. */
export interface FlyObjectModel {
    /** The part name (<modl>: `comp`, or `pole`, `sck1`... on a windsock). */
    part: string;
    /** The file, as written: .BIN, .BSP or .ARM. */
    file: string;
    /** For a <mdst> model, the distance range it is shown in, in the file's units. Else null. */
    near: number | null;
    far: number | null;
}
/** `<flag>` bit 0: relocate the model vertically so its lowest point rests on the terrain. */
export declare const FLY_OBJECT_SNAP_TO_GROUND = 1;
/** One placed object from a SCENERY.Sxx file. */
export interface FlySceneryObject {
    /** The <wobj> kind: `mobj` (model), `becn` (beacon) or `wdsk` (windsock) in the stock files. */
    kind: string;
    /** <type>: `mobj` or `becn`. */
    type: string;
    id: string;
    /** <name>; `NO-NAME` for most objects. */
    name: string;
    /** <flag>, preserved as the signed 32-bit word written in the file. */
    flag: number | null;
    /** Whether `<flag>` bit 0 requests that the model's lowest point rest on the terrain. */
    snapToGround: boolean;
    /** <detl>, the detail level. */
    detail: number | null;
    latitude: number;
    longitude: number;
    /** The third <geop> value: presumably feet above sea level. */
    altitude: number;
    /** <iang>, three angles, presumably radians, with the heading in the middle one. */
    orientation: [number, number, number];
    /** The models in the object's <mmgr> (and <nmgr>) blocks, in file order. */
    models: FlyObjectModel[];
    /** <lens>, on beacons. */
    lens: number | null;
}
export declare function parseFlySceneryObjects(input: Uint8Array | string, sourceName?: string): {
    objects: FlySceneryObject[];
    warnings: string[];
};
