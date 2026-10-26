import type { SimBox } from "../collide/box.ts";
/** Points per rule, and the knock-off cooldown in seconds. */
export declare const SUMMIT_ZONE_POINTS = 10, SUMMIT_KNOCK_OFF = 50, SUMMIT_OFF_POINTS = 1, SUMMIT_COOLDOWN_S = 2;
export interface SummitTruck {
    score: number;
    /** 0 outside, 1 on the summit, 2 in the zone; and last tick's. */
    state: number;
    previous: number;
    /** Seconds until a knock-off can cost points again. */
    cooldown: number;
    /** Time since the last whole second. */
    second: number;
}
export interface Summit {
    zone: SimBox;
    summit: SimBox;
    trucks: SummitTruck[];
}
export declare function createSummit(count: number, zone: SimBox, summit: SimBox): Summit;
/** One tick for every truck, given each truck's position in the same order. */
export declare function summitTick(summit: Summit, positions: readonly ArrayLike<number>[], dt: number): void;
