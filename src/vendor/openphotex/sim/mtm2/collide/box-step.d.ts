import type { Mtm2Ground } from "../world/ground.ts";
import type { SimBox } from "./box.ts";
/** The inertias I1, I2, I3 (about z, x, y) from the full sizes (§14.16). */
export declare function boxInertia(box: SimBox): [number, number, number];
/** One step of a box (§14.16). Immovable boxes, and boxes at rest with nothing on them, stay. */
export declare function stepBox(box: SimBox, ground: Mtm2Ground, dt: number): void;
/** The box post-step (§14.16): each corner against the terrain, pushed out past the skin. */
export declare function postStepBox(box: SimBox, ground: Mtm2Ground): void;
