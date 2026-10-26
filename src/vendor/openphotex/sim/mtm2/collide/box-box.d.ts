import type { SimBox } from "./box.ts";
/**
 * The pair test of two boxes, `first` listed before `second` (§14.21). The mover is `second` when
 * it is dynamic, else `first`; nothing happens when neither is.
 */
export declare function collideBoxes(first: SimBox, second: SimBox, dt: number): void;
