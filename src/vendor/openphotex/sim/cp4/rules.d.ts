import { type Mtm2Rules, type TriangleCollisionRules } from "../mtm2/constants.ts";
/** The [Collision] defaults (11.1). */
export declare const CP4_TRIANGLES: TriangleCollisionRules;
/** CP4's rules with triangle collision (`collisionMode` 1, the default). */
export declare const CP4_RULES: Mtm2Rules;
/** CP4's rules with classic box collision (`collisionMode` 0): the clamps above still apply (11.10). */
export declare const CP4_CLASSIC_RULES: Mtm2Rules;
export declare function isCp4Rules(id: string | null | undefined): id is "cp4";
/** CP4's rules for a collision mode: "classic" (or 0) for box faces, anything else for triangles. */
export declare function cp4Rules(collision?: string | number | null): Mtm2Rules;
/**
 * The substeps of one tick (10.2): `n` steps of `dt` each. CP4 splits a tick only online or when asked
 * (`simSubstepOffline`), into round(tick / substep) clamped 2..8, and only when the tick is more than
 * 1.25 substeps long.
 */
export declare function cp4Substeps(rules: Mtm2Rules, split: boolean): {
    n: number;
    dt: number;
};
