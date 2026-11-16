import type { Mtm2TruckParams } from "../truck/params.ts";
import type { Mtm2TruckState } from "../truck/state.ts";
import type { SimBox } from "./box.ts";
import type { Mtm2Rules } from "../constants.ts";
import { type BoxTouch } from "./truck-pair.ts";
export type { BoxTouch } from "./truck-pair.ts";
/**
 * The sphere and separating-axis early out (§14.14 step 1). A box that takes Community Patch 4's triangle path
 * (`rules`, `triangleBox`) is separated only past both its own faces and its model's triangles: CP4 widens each slab to
 * the shape's bounds in the box frame (OpenMTM2 docs/CP4_EXE_ANALYSIS.md 11.2, `FUN_1403af350` with `FUN_1401815f0`),
 * so a model that stands above its origin (a deck 16 ft tall on a box centred on its base, which reaches 8 ft up) is
 * still met above the box's top. Its pair sphere is CP4's too: twice the truck's radius and the box's (`FUN_1403767f0`).
 */
export declare function truckBoxSeparated(s: Mtm2TruckState, p: Mtm2TruckParams, box: SimBox, dt: number, rules?: Mtm2Rules): boolean;
/**
 * A truck against a box (§14.14, §14.17): hull points, wheels and tire contact points, then the
 * box's corners against the wheels. An immovable box becomes ground for the truck; a pushable one
 * is pushed out and gets the inelastic force law, the truck the opposite force. Pair forces go to
 * `s.extForce` / `s.extMoment` (truck body axes) and `box.force` / `box.moment` (box axes).
 * `s.prevPos` and `s.prevMatrix` are the truck's pose before this step's move.
 */
export declare function collideTruckBox(s: Mtm2TruckState, p: Mtm2TruckParams, box: SimBox, dt: number, rules?: Mtm2Rules): BoxTouch | null;
/** The immovable case only, whatever the box's mass (ground boxes have none). Returns the contact, as `collideTruckBox`. */
export declare function collideTruckImmovableBox(s: Mtm2TruckState, p: Mtm2TruckParams, box: SimBox, dt: number, rules?: Mtm2Rules): BoxTouch | null;
