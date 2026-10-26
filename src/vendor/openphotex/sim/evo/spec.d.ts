import type { EvoTrk } from "../../evo/trk.ts";
import type { EvoPart } from "../../evo/parts.ts";
import { type Triplet } from "../mtm2/truck/params.ts";
export interface EvoVehicleSpec {
    /** 1 or 2 for an Evo vehicle, 0 for one translated from MTM2's model. */
    game: 0 | 1 | 2;
    dryWeightLb: number;
    fuelWeightLb: number;
    /** Front, rear axle weight (the .TRK has none: the constructor's 500 each). */
    axleWeightLb: [number, number];
    /** Roll, pitch, yaw inertia, slug ft² (the .TRK's `ixx,iyy,izz`). */
    inertia: Triplet;
    /** Side, top and front reference areas, ft². */
    refArea: Triplet;
    /** Drag coefficients facing x (CY), y (CL) and z (CD). */
    cy: number;
    cl: number;
    cd: number;
    /** Damping derivatives: roll, pitch, yaw. */
    clp: number;
    cmq: number;
    cnr: number;
    cgModifier: Triplet;
    /** When set, the CG itself (translated vehicles keep MTM2's); otherwise the rules' default plus `cgModifier`. */
    cgOffset: Triplet | null;
    maxBrakePct: number;
    /** 0..1, 0.5 when the garage leaves it (the constructor's; every stock .TRK says 0). */
    brakeBalance: number;
    /** 0 two-wheel drive, 1 four-wheel drive, 2 four-wheel drive with an adaptive centre split. */
    driveType: number;
    torquePct: [number, number];
    axleBias: [number, number];
    slipDiffType: [number, number];
    /** Spring per wheel, lb/ft, and damper, lb s/ft (3.5 * sqrt(k) when the .TRK has none). */
    springRate: [number, number];
    damping: [number, number];
    maxCompr: [number, number];
    maxAngle: [number, number];
    springArmFt: number;
    /** CF per tire: FR, FL, RR, RL. */
    tireCF: [number, number, number, number];
    /** Ratio of gear g at index g - 1. */
    gearRatios: number[];
    gearInertia: number[];
    maxGear: number;
    finalDrive: number;
    axleRatio: number;
    xfrLowRatio: number;
    redline: number;
    upshiftRpm: number;
    dnshiftRpm: number;
    /** Torque at 0, 500, 1000 ... rpm, lb ft. */
    torqueTable: number[];
    /** The rear wheels steer (MTM2's monster trucks); Evo vehicles do not. */
    rearSteer: boolean;
    /** Wheel centres FR, FL, RR, RL and the 12 hull points, body feet. */
    wheelAnchors: Triplet[];
    scrapePoints: Triplet[];
}
/** The figures of an Evo 1 or Evo 2 .TRK (`parseEvoTrk`). */
export declare function evoSpecFromTrk(trk: EvoTrk): EvoVehicleSpec;
/**
 * The garage's settings for an Evo vehicle (OpenMTM2 EVO2_PHYSICS.md 2.2), each 0..1 as the game's sliders give them
 * (its "Default Settings" are 0.5 each); `null` or absent leaves the vehicle's own figure.
 */
export interface EvoGarage {
    /** Suspension, soft 0 to hard 1: the springs from the sag (`0x5ecba0`). */
    springs?: number | null;
    /** Axle ratio: the final drive times `(1 - s) * 1.5 + 0.25` (`0x5eca90`), 0.5 the vehicle's own. */
    axleRatio?: number | null;
    /** Brake balance, front 0 to rear 1 (`0x5ecf90`). */
    brakeBalance?: number | null;
    /** Torque split, the rear axle's share (`0x5ed020`). */
    torqueSplit?: number | null;
    /** Handling balance: the front tires' CF times `1 + 0.75 s` (`0x5ecdd0`). */
    handling?: number | null;
}
/** The springs `CVehicle::setSprings` (`0x5ecba0`) gives for setting `s`: per axle rate and damping (EVO2_PHYSICS.md 2). */
export declare function evoSprings(spec: EvoVehicleSpec, s: number, defaultCgZ: number): {
    springRate: [number, number];
    damping: [number, number];
};
/** A vehicle's figures with the garage's settings applied, as the game's setters change them (EVO2_PHYSICS.md 2.2). */
export declare function applyEvoGarage(spec: EvoVehicleSpec, garage: EvoGarage | null | undefined, defaultCgZ: number): EvoVehicleSpec;
export interface EvoPartsResult {
    spec: EvoVehicleSpec;
    /** How far the wheels' anchors were lowered (the body raised), feet: 0 without a lift or drop kit. */
    liftFt: number;
    /** The tire models' base name a tire part asks for, or null. */
    tireModelBase: string | null;
}
/**
 * A vehicle's figures with parts fitted, as `0x5eaa40` fits them (§2.1): `codes` are the part codes (a
 * .TRK's `stockParts`), `parts` the parts list (`parseEvoParts`). Codes not in the list are left out.
 */
export declare function applyEvoParts(spec: EvoVehicleSpec, codes: readonly string[], parts: readonly EvoPart[]): EvoPartsResult;
export interface Mtm2SpecInput {
    wheelAnchors?: readonly Triplet[] | null;
    scrapePoints?: readonly Triplet[] | null;
    /** The Garage's suspension (0 soft, 1 medium, 2 hard), transfer slider and the difficulty. */
    suspension?: number;
    transferSetting?: number;
    difficulty?: number;
    /** The grip factor K the MTM2 model would give this truck (1.75, or 2.0 for a Sonic professional). */
    gripK?: number;
}
/** MTM2's monster truck, as the Evo model's figures (the port's rule for a non-Evo vehicle). */
export declare function evoSpecFromMtm2(input?: Mtm2SpecInput): EvoVehicleSpec;
