import type { EvoVehicleSpec } from "./spec.ts";
/** Ratio of a gear number (0 in Park and Neutral and past the table). */
export declare function evoGearRatio(spec: EvoVehicleSpec, gear: number): number;
/**
 * Torque at an rpm at full throttle: the table every 500 rpm, linear between entries (0x559cb0,
 * at most 23 entries). Past the table's last entry the game reads on into the next fields; the
 * port holds the last entry (stock tables reach past the redline, so this only matters for a
 * short table).
 */
export declare function evoTorqueAt(table: readonly number[], rpm: number): number;
/** The drivetrain's inertia in a gear (0x55a6b0). */
export declare function evoDriveInertia(spec: EvoVehicleSpec, gear: number, finalRatio: number): number;
export interface EvoGearbox {
    gear: number;
    shiftRequest: number;
    brakeFront: number;
    brakeRear: number;
}
/**
 * The gearbox step (0x553fb0). Automatic: up one gear from first upwards when the rpm reaches the
 * upshift rpm and the speed is past the upshift speed of the gear; down one from second upwards
 * when the rpm falls under the downshift rpm and the speed under the downshift speed. Manual: one
 * gear per request, down to Park. Park holds both brakes.
 */
export declare function stepEvoGearbox(box: EvoGearbox, spec: EvoVehicleSpec, rpm: number, forwardSpeed: number, finalRatio: number, tireRadius: number, autoShift: boolean): void;
/**
 * Wheelspin (0x559af0): a tire's slip value against its drive force. `gripCoef` is the tire's
 * CF * mu * weather * tread and `fmax` its friction capacity (0 in the air).
 */
export declare function evoStepSlip(slip: number, drive: number, speed: number, gripCoef: number, fmax: number, onGround: boolean, inertia: number, dt: number): number;
/**
 * The centre split (0x5589a0): each axle's torque_pct, or with drive type 2 an offset moving 0.1 a
 * step from the axle whose tires slip more to the other, while that one still has some.
 */
export declare function evoCentreSplit(spec: EvoVehicleSpec, offsets: number[], split: number[], slip: readonly number[]): void;
/**
 * One axle's differential (0x5587c0), shares as [left, right]. Type 1 compares the two tires'
 * longitudinal forces this step and takes share from the one pulling more than 1% harder (either
 * not pulling resets to 50/50); type 2 takes share from the tire whose slip exceeds the other's by
 * more than 5 (otherwise 50/50); type 0 is open, 50/50.
 */
export declare function evoDifferential(type: number, shares: number[], forceLeft: number, forceRight: number, slipLeft: number, slipRight: number): void;
