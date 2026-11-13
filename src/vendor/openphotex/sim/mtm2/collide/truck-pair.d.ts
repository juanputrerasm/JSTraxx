import type { Mtm2TruckParams } from "../truck/params.ts";
import type { Mtm2TruckState } from "../truck/state.ts";
import type { SimBox } from "./box.ts";
export type V3 = [number, number, number];
export declare const toWorld: (m: ArrayLike<number>, x: number, y: number, z: number) => V3;
export declare const toBody: (m: ArrayLike<number>, x: number, y: number, z: number) => V3;
/** The truck's mass in slugs. */
export declare function truckMass(p: Mtm2TruckParams): number;
/**
 * A contact of the truck with the box, as MONSTER.EXE plays the box's sound for one (`0x428bc0`, MONSTER_EXE_ANALYSIS.md
 * "Object sounds"): a hull point that goes deeper into it, a wheel or tire contact point inside it, or one of its
 * corners against a wheel. `speed` is the hardest closing speed of those contacts, ft/s (0 when none closes).
 */
export interface BoxTouch {
    speed: number;
}
export type Touch = {
    hit: BoxTouch | null;
};
/** Records a contact along `normalWorld` (outward from the box), at the truck's speed against the box. */
export declare function touched(touch: Touch, s: Mtm2TruckState, box: SimBox, normalWorld: ArrayLike<number>): void;
/**
 * How the pair works (§14.17): pushable when the box has a mass below the truck's (the box's mass
 * is then the effective mass), else immovable with the truck's mass.
 */
export interface Pair {
    pushable: boolean;
    /** The contact this pair test found, for the object's sound (null: none). */
    touch: Touch;
    mEff: number;
    /**
     * The pair's force and moment on the box (box axes) and on the truck (body axes). Every
     * contact replaces them; they are applied once, after the whole pair test (§14.17).
     */
    box: {
        f: V3;
        m: V3;
    } | null;
    truck: {
        f: V3;
        m: V3;
    } | null;
}
/**
 * The pushable force law (§14.17) at a truck point `body` (truck axes) that is `depth` inside the
 * face with outward normal `n`, at `cur` (both box axes). Returns whether the box was pushed.
 */
export declare function pushPoint(s: Mtm2TruckState, box: SimBox, body: V3, cur: V3, n: V3, depth: number, pair: Pair, dt: number): boolean;
export declare const crossV: (a: V3, b: V3) => V3;
/** The pair's force on the box, `f` at `at` (box axes), replacing the last one. */
export declare function setBoxForce(pair: Pair, at: V3, f: V3): void;
/** The pair's force on the truck, `f` at `at` (body axes), replacing the last one. */
export declare function setTruckForce(pair: Pair, at: V3, f: V3): void;
export declare function unit(v: V3): V3;
/**
 * Where tire `i`'s hub was last step, world feet (tire +0x24, §14.14 step 3): the truck's last position and rotation,
 * and the hub as the step began. The wheels' rays start here, not at the truck's centre.
 */
export declare function lastHub(s: Mtm2TruckState, i: number): V3;
