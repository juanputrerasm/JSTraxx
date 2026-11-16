import type { BuiltFall } from "./falls.ts";
/** The emitter's constants (16.5). */
export declare const FALL_DROPLETS: {
    /** Bursts banked per second, and at most. */
    readonly budgetPerSec: 500;
    readonly budgetMax: 80;
    /** Bursts a stream may throw in one frame. */
    readonly perStreamFrame: 6;
    /** A stream throws only within this horizontal distance of the player, ft. */
    readonly rangeFt: 150;
    /** Streams a fall has at most. */
    readonly streams: 4;
    /** `[Graphics] waterfallDroplets` (percent): default, range; 0 is off. */
    readonly defaultPct: 100;
    readonly maxPct: 400;
    /** The interval: (0.4 + 1.2 u) * 0.02 / kS s. */
    readonly intervalBase: 0.4;
    readonly intervalSpread: 1.2;
    readonly intervalScale: 0.02;
};
/** The DLL's spray model the bursts are drawn with (16.5), for the host's renderer. Units: ft, s. */
export declare const FALL_SPRAY: {
    /** Records kept, and how long one is drawn. */
    readonly ring: 4096;
    readonly retentionSec: 2.4;
    readonly drops: 80;
    readonly blobs: 3;
    /** Life of a drop (times 0.65 + 0.35 h6) and of a blob. */
    readonly lifeSec: 2;
    /** Drag, 1/s, and gravity, ft/s^2 (8192 units of 1/256 ft). */
    readonly drag: 0.5;
    readonly gravity: 32;
    /** The slowest a burst's spread is figured from, ft/s (768 units / s). */
    readonly minSpeed: 3;
    /** The speed that thins the drops: saturate((|v| - 1500 / 256) / (6200 / 256)). */
    readonly thinFrom: number;
    readonly thinOver: number;
};
/** The droplet hash (16.5). */
export declare function fallDropletHash(x: number): number;
/** The DLL's sprite hash (16.5). */
export declare function fallSprayHash(x: number): number;
/** One burst, as the engine hands it to gpuSprayBurst (16.5), in feet and feet a second. */
export interface FallDropletBurst {
    fall: number;
    stream: number;
    /** Where it starts, ft (x, z the copy of the world nearest the player, as given). */
    position: [number, number, number];
    velocity: [number, number, number];
    /** 0..1: the share of its sprites drawn. */
    intensity: number;
    /** The landing's height: the drops die below it. */
    waterY: number;
    /** Half the width the sprites spread across, ft. */
    halfWidth: number;
    /** The sprites' size scale (1.5 + 1.5 u) * clamp(k, 0.3, 4). */
    sizeScale: number;
    /** The burst's 32-bit seed for its sprites. */
    seed: number;
}
export interface FallDropletState {
    /** Banked bursts. */
    budget: number;
    /** Per fall slot and stream (slot * 4 + stream): the timer and the current interval, s. */
    timers: Float64Array;
    intervals: Float64Array;
    /** Per fall slot: the RNG state (the fall's rngSeed at the start). */
    rng: Uint32Array;
}
/** A fresh emitter for the built falls. */
export declare function createFallDroplets(falls: readonly Pick<BuiltFall, "slot" | "rngSeed">[]): FallDropletState;
export interface FallDropletStep {
    /** Seconds since the last step (the engine's ticks / 65536). */
    dt: number;
    /** The player's view position, ft (x, z). */
    player: [number, number];
    /** Whether the droplets may show at all (the engine: water look 1 or 2, a player view, the spray options). */
    enabled: boolean;
    weather?: number;
    /** `[Graphics] waterfallDroplets` percent (100). */
    dropletsPct?: number;
}
/**
 * One frame of the emitter (16.5): the bursts it throws, in order. With `enabled` false every timer is cleared and
 * nothing is thrown. The state is changed in place.
 */
export declare function stepFallDroplets(state: FallDropletState, falls: readonly BuiltFall[], step: FallDropletStep): FallDropletBurst[];
