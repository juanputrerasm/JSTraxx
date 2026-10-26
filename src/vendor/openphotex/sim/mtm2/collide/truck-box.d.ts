import type { Mtm2TruckParams } from "../truck/params.ts";
import type { Mtm2TruckState } from "../truck/state.ts";
import type { SimBox } from "./box.ts";
/** The sphere and separating-axis early out (§14.14 step 1). */
export declare function truckBoxSeparated(s: Mtm2TruckState, p: Mtm2TruckParams, box: SimBox, dt: number): boolean;
/**
 * A contact of the truck with the box, as MONSTER.EXE plays the box's sound for one (`0x428bc0`, MONSTER_EXE_ANALYSIS.md
 * "Object sounds"): a hull point that goes deeper into it, a wheel or tire contact point inside it, or one of its
 * corners against a wheel. `speed` is the hardest closing speed of those contacts, ft/s (0 when none closes).
 */
export interface BoxTouch {
    speed: number;
}
/**
 * A truck against a box (§14.14, §14.17): hull points, wheels and tire contact points, then the
 * box's corners against the wheels. An immovable box becomes ground for the truck; a pushable one
 * is pushed out and gets the inelastic force law, the truck the opposite force. Pair forces go to
 * `s.extForce` / `s.extMoment` (truck body axes) and `box.force` / `box.moment` (box axes).
 * `s.prevPos` and `s.prevMatrix` are the truck's pose before this step's move.
 */
export declare function collideTruckBox(s: Mtm2TruckState, p: Mtm2TruckParams, box: SimBox, dt: number): BoxTouch | null;
/** The immovable case only, whatever the box's mass (ground boxes have none). Returns the contact, as `collideTruckBox`. */
export declare function collideTruckImmovableBox(s: Mtm2TruckState, p: Mtm2TruckParams, box: SimBox, dt: number): BoxTouch | null;
