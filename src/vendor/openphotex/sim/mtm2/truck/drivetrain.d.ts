/** Torque curve at full throttle, lb ft. */
export declare function engineTorque(rpm: number): number;
/** The overall ratio of a gear number (0 in Park and Neutral). */
export declare function gearRatio(gear: number): number;
/** The rpm a tire on the ground asks of the engine. */
export declare function groundTargetRpm(transfer: number, gear: number, forwardSpeed: number, tireRadius: number, throttle: number): number;
/**
 * The rpm a tire in the air asks of the engine: the wheel's spin, at least throttle × limit, no
 * more than the limit, then wound towards 0 by (16000 · brake + 3200) · dt.
 */
export declare function airTargetRpm(transfer: number, gear: number, wheelSpin: number, throttle: number, brake: number, dt: number): number;
/** The wheel spin (rad/s) a free wheel takes from the engine rpm, or null in Park and Neutral. */
export declare function wheelSpinFromRpm(rpm: number, transfer: number, gear: number): number | null;
/** One tire's pull on the rpm: a first-order lag with rate 1/s. Capped at the limit on the ground. */
export declare function chaseRpm(rpm: number, target: number, dt: number, capAtLimit: boolean): number;
export interface TorqueDriver {
    human: boolean;
    autoShift: boolean;
    difficulty: number;
    sonicTrack: boolean;
}
/** Engine torque delivered at this rpm and throttle, with the driver gains, lb ft. */
export declare function deliveredTorque(rpm: number, throttle: number, driver: TorqueDriver): number;
/** Drive force at one tire, lbf: half of its axle's share of the torque at the contact. */
export declare function driveForce(transfer: number, gear: number, torque: number, tireRadius: number, axleSplit: number): number;
export interface GearboxState {
    gear: number;
    /** Manual request, +1 or -1, cleared by the gearbox. */
    shiftRequest: number;
    brakeFront: number;
    brakeRear: number;
}
export interface GearboxContext {
    rpm: number;
    autoShift: boolean;
    /** Body forward speed, ft/s. */
    forwardSpeed: number;
    /** A drag race whose truck has passed fewer than 3 course segments: P and N are adjacent. */
    dragStaging: boolean;
}
/**
 * The gearbox step (0x477520). Automatic: up above 7000 rpm from first or second, down below
 * 3500 rpm from second or third; requests are ignored. Manual: up to third, down from second or
 * third at any speed, down from Neutral or Reverse only when not rolling forward. Park holds both
 * brakes on.
 */
export declare function stepGearbox(box: GearboxState, ctx: GearboxContext): void;
/** Below this speed a tire holds the truck still (static hold, §5.2). */
export declare const STATIC_HOLD_SPEED = 14.67;
