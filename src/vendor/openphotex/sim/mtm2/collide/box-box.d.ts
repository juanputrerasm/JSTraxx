import type { SimBox } from "./box.ts";
import type { Mtm2Rules } from "../constants.ts";
/**
 * The pair test of two boxes, `first` listed before `second` (§14.21). The mover is `second` when
 * it is dynamic, else `first`; nothing happens when neither is.
 */
export declare function collideBoxes(first: SimBox, second: SimBox, dt: number, rules?: Mtm2Rules): void;
